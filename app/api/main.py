"""FastAPI-App — die Endpunkte aus PLAN.md §6.4 und §8.

Nicht implementiert sind bewusst alle Endpunkte, die Turnierdaten brauchen
(``/api/factions/rankings``, ``/api/units/{id}/stats``, ``/api/lists/generate``).
Sie gehören zu den Phasen 1–3 und 6 und stehen noch aus.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import config, db, derive, models
from app.rules import ruleset
from app.rules.builderlist import ActionError, BuilderList, apply_all
from app.rules.validator import RulesContext, validate

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    _warn_on_public_exposure()
    yield


app = FastAPI(
    title="warhammer-meta",
    description=(
        "Self-gehosteter Listenbuilder mit Regel-Inspektor. "
        f"{config.ATTRIBUTION.text}."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

_context_cache: dict[str, RulesContext] = {}


def _context(session, version: str) -> RulesContext:
    """Regelkontext je Regelstand einmal aufbauen und halten.

    Zulässig, weil sich die Regeldaten nur beim ETL-Lauf ändern und die
    Instanz einen einzelnen Nutzer bedient.
    """
    if version not in _context_cache:
        _context_cache[version] = RulesContext(session, version)
    return _context_cache[version]


def invalidate_context_cache() -> None:
    _context_cache.clear()


# ---------------------------------------------------------------------------
# Schemata
# ---------------------------------------------------------------------------


class ValidateRequest(BaseModel):
    list: dict[str, Any]


class IncrementalRequest(BaseModel):
    list: dict[str, Any]
    patch: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Stammdaten
# ---------------------------------------------------------------------------


@app.get("/api/meta")
def get_meta() -> dict:
    """Regelstand, Anzeigemodus und Auflagen — was das UI im Kopf braucht."""
    with db.session() as session:
        meta = {row.key: row.value for row in session.scalars(select(models.Meta))}
        cards = session.scalar(
            select(models.DatasheetCard)
            .where(models.DatasheetCard.ruleset_version == config.RULESET_VERSION)
            .limit(1)
        )
    return {
        "ruleset_version": config.RULESET_VERSION,
        "rules_text_mode": config.text_mode(),
        "last_update": meta.get("last_update", ""),
        "ingested_at": meta.get("ingested_at", ""),
        "has_data": cards is not None,
        "attribution": {
            "text": config.ATTRIBUTION.text,
            "url": config.ATTRIBUTION.url,
            "notice": config.ATTRIBUTION.notice,
        },
        "points_limits": list(ruleset.POINTS_LIMITS),
        "rules": [
            {
                "key": spec.key,
                "title": spec.title,
                "basis": spec.basis,
                "note": spec.note,
            }
            for spec in ruleset.SPECS.values()
        ],
    }


@app.get("/api/factions")
def list_factions() -> list[dict]:
    with db.session() as session:
        rows = session.execute(
            select(
                models.DatasheetCard.faction_id,
                models.Faction.name,
            )
            .join(
                models.Faction,
                models.Faction.id == models.DatasheetCard.faction_id,
                isouter=True,
            )
            .where(models.DatasheetCard.ruleset_version == config.RULESET_VERSION)
            .distinct()
        ).all()
    return sorted(
        ({"id": fid, "name": name or fid} for fid, name in rows if fid),
        key=lambda f: f["name"],
    )


@app.get("/api/factions/{faction_id}/detachments")
def list_detachments(faction_id: str) -> list[dict]:
    """Detachments werden aus den Detachment-Fähigkeiten abgeleitet.

    Der Export hat keine eigene Detachments-Datei; ``detachment_id`` und
    ``detachment`` stehen an den Fähigkeiten.
    """
    seen: dict[str, str] = {}
    with db.session() as session:
        rows = session.scalars(
            select(models.DetachmentAbility).where(
                models.DetachmentAbility.faction_id == faction_id
            )
        ).all()
        # Innerhalb der Session auslesen — nach dem Commit sind die Objekte
        # abgelöst und jeder Attributzugriff schlägt fehl.
        for row in rows:
            if row.detachment_id and row.detachment_id not in seen:
                seen[row.detachment_id] = row.detachment or row.detachment_id
    return sorted(
        ({"id": did, "name": name} for did, name in seen.items()),
        key=lambda d: d["name"],
    )


# ---------------------------------------------------------------------------
# Karten für den Regel-Inspektor — PLAN.md §6.4
# ---------------------------------------------------------------------------


@app.get("/api/factions/{faction_id}/cards")
def faction_cards(
    faction_id: str,
    mode: str | None = Query(default=None, pattern="^(full|derived)$"),
) -> JSONResponse:
    """Bulk-Prefetch: Kartensatz und Detachment-Regeln einer Fraktion.

    Enhancements und Stratagems kommen als Nachschlagetabellen *neben* den
    Karten, nicht in jeder Karte. Sie gehören zum Detachment, und die
    Kopie-in-jede-Karte-Variante hat den Space-Marines-Prefetch auf 43 MB
    getrieben. Ein Request bleibt es trotzdem.
    """
    text_mode = mode or config.text_mode()
    with db.session() as session:
        cards = session.scalars(
            select(models.DatasheetCard)
            .where(models.DatasheetCard.faction_id == faction_id)
            .where(models.DatasheetCard.ruleset_version == config.RULESET_VERSION)
        ).all()
        payloads = [_render(card, text_mode) for card in cards]
        rules = _faction_rules(session, faction_id, text_mode)

    payloads.sort(key=lambda c: c["name"])
    return JSONResponse(
        {
            "faction_id": faction_id,
            "ruleset_version": config.RULESET_VERSION,
            "rules_text_mode": text_mode,
            "count": len(payloads),
            "cards": payloads,
            **rules,
        }
    )


def _faction_rules(session, faction_id: str, mode: str) -> dict:
    """Enhancements, Stratagems und Detachments einer Fraktion — je einmal."""
    enhancements = {
        enh.id: {
            "id": enh.id,
            "name": enh.name,
            "cost": int(enh.cost) if enh.cost.isdigit() else 0,
            "detachment": enh.detachment,
            "detachment_id": enh.detachment_id,
            "description": ""
            if mode == "derived"
            else derive.sanitize_html(enh.description),
            "tags": derive.effect_tags(enh.description),
        }
        for enh in session.scalars(
            select(models.Enhancement).where(
                models.Enhancement.faction_id == faction_id
            )
        )
    }
    stratagems = {
        strat.id: {
            "id": strat.id,
            "name": strat.name,
            "type": strat.type,
            "cp_cost": strat.cp_cost,
            "turn": strat.turn,
            "phase": strat.phase,
            "detachment": strat.detachment,
            "detachment_id": strat.detachment_id,
            "description": ""
            if mode == "derived"
            else derive.sanitize_html(strat.description),
            "tags": derive.effect_tags(strat.description),
        }
        for strat in session.scalars(
            select(models.Stratagem).where(
                models.Stratagem.faction_id == faction_id
            )
        )
    }
    by_detachment: dict[str, list[str]] = {}
    for strat in stratagems.values():
        by_detachment.setdefault(strat["detachment_id"], []).append(strat["id"])

    return {
        "enhancements": enhancements,
        "stratagems": stratagems,
        "stratagems_by_detachment": by_detachment,
    }


@app.get("/api/datasheets/{datasheet_id}/card")
def datasheet_card(
    datasheet_id: str,
    mode: str | None = Query(default=None, pattern="^(full|derived)$"),
) -> dict:
    text_mode = mode or config.text_mode()
    with db.session() as session:
        card = session.get(
            models.DatasheetCard, (datasheet_id, config.RULESET_VERSION)
        )
        if card is None:
            raise HTTPException(status_code=404, detail="Datasheet unbekannt")
        payload = _render(card, text_mode)
        # Einzelabruf: Die Verweise werden gleich aufgelöst, damit der
        # Endpunkt für sich allein benutzbar ist.
        rules = _faction_rules(session, card.faction_id, text_mode)

    payload["enhancements"] = [
        rules["enhancements"][enh_id]
        for enh_id in payload.get("enhancement_ids", [])
        if enh_id in rules["enhancements"]
    ]
    payload["stratagems"] = [
        rules["stratagems"][strat_id]
        for det_id in payload.get("detachment_ids", [])
        for strat_id in rules["stratagems_by_detachment"].get(det_id, [])
    ]
    return payload


# ---------------------------------------------------------------------------
# Validierung — PLAN.md §5.1
# ---------------------------------------------------------------------------


@app.post("/api/lists/validate")
def validate_list(request: ValidateRequest) -> dict:
    state = BuilderList.from_dict(request.list)
    with db.session() as session:
        result = validate(state, session, _context(session, state.ruleset_version))
    return result.to_dict()


@app.post("/api/lists/validate/incremental")
def validate_incremental(request: IncrementalRequest) -> dict:
    """Aktionen anwenden und das Ergebnis prüfen — ein Roundtrip statt zwei.

    Der Builder ruft das nach jeder Änderung auf; Reducer und Validator sind
    hier dieselben, die auch der Generator später benutzen wird.
    """
    state = BuilderList.from_dict(request.list)
    try:
        state = apply_all(state, request.patch)
    except ActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with db.session() as session:
        result = validate(state, session, _context(session, state.ruleset_version))
    return {"list": state.to_dict(), "validation": result.to_dict()}


@app.get("/api/datasheets/{datasheet_id}/context")
def datasheet_context(datasheet_id: str) -> dict:
    """Abschnitt 11 des Panels — Meta und Synergie zum Listenkontext.

    Noch ohne Inhalt: Er braucht die Turnierdaten aus den Phasen 1–3 und die
    Synergie-Engine aus Phase 5. Der Endpunkt existiert, damit das Panel den
    Abschnitt schon jetzt asynchron nachlädt und beim Ausbau nichts am
    Frontend zu ändern ist.
    """
    return {
        "datasheet_id": datasheet_id,
        "available": False,
        "reason": (
            "Meta- und Synergiedaten brauchen die Turnierauswertung "
            "(Phasen 1–3) und die Synergie-Engine (Phase 5)."
        ),
        "inclusion_rate": None,
        "synergies": [],
    }


# ---------------------------------------------------------------------------
# Anzeigemodus
# ---------------------------------------------------------------------------


def _render(card: models.DatasheetCard, mode: str) -> dict:
    """Bringt eine Karte in die für den Modus zulässige Form — PLAN.md §6.3."""
    payload = json.loads(card.payload)
    payload["min_cost"] = card.min_cost
    payload["is_epic_hero"] = card.is_epic_hero
    payload["is_character"] = card.is_character
    payload["transport_capacity"] = card.transport_capacity
    payload["rules_text_mode"] = mode

    if mode == "full":
        return payload

    # derived: Werte und Namen bleiben, Fließtext wird durch Tags ersetzt.
    for ability in payload.get("abilities", []):
        ability["description"] = ""
        ability["derived_only"] = True
    for group in ("ranged", "melee"):
        for weapon in payload.get("weapons", {}).get(group, []):
            weapon["description"] = ""
    for key in ("legend", "loadout"):
        payload[key] = ""
    if payload.get("damaged"):
        payload["damaged"]["description"] = ""
    if payload.get("transport"):
        payload["transport"]["text"] = ""
    payload["leader_note"] = {"head": "", "footer": ""}
    payload["composition"] = []
    for option in payload.get("options", []):
        option["description"] = ""
    return payload


# ---------------------------------------------------------------------------
# Statisches Frontend
# ---------------------------------------------------------------------------


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _warn_on_public_exposure() -> None:
    import os

    host = os.environ.get("WH_BIND_HOST", "127.0.0.1")
    if message := config.check_public_exposure(host):
        warnings.warn(message, stacklevel=1)
        print(f"\n  ⚠  {message}\n")
