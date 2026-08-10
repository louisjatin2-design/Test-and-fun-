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

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import config, db, derive, live, models
from app.rules import generator, ruleset, synergy
from app.rules.builderlist import ActionError, BuilderList, apply_all
from app.rules.validator import RulesContext, validate

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    _warn_on_public_exposure()

    from app.etl.updates import load_current_state

    load_current_state()

    task = None
    if config.UPDATE_INTERVAL_HOURS > 0:
        task = asyncio.create_task(_update_loop())
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


async def _update_loop() -> None:
    """Prüft in festem Abstand, ob es einen neueren Regelstand gibt.

    Der Ingest ist blockierend und dauert rund 30 Sekunden — er läuft
    deshalb in einem Worker-Thread, damit die Event-Loop frei bleibt und
    das UI währenddessen bedienbar ist.
    """
    from app.etl.updates import refresh
    from app.etl.wahapedia import HttpSource

    await asyncio.sleep(config.UPDATE_INITIAL_DELAY_SECONDS)
    while True:
        try:
            source = HttpSource(cache_dir=None)
            if config.UPDATE_AUTO_APPLY:
                result = await asyncio.to_thread(refresh, source)
                if result.applied:
                    print(
                        f"  ↻ Neuer Regelstand {result.current} geladen "
                        f"({result.cards} Karten)"
                    )
            else:
                with db.session() as session:
                    await asyncio.to_thread(_check_only, source, session)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - eine Prüfung darf nie killen
            live.mark_checked("", error=str(exc))

        await asyncio.sleep(config.UPDATE_INTERVAL_HOURS * 3600)


def _check_only(source, session):
    from app.etl.updates import check

    return check(source, session)


app = FastAPI(
    title="warhammer-meta",
    description=(
        "Self-gehosteter Listenbuilder mit Regel-Inspektor. "
        f"{config.ATTRIBUTION.text}."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

_context_cache: dict[tuple[str, int], RulesContext] = {}


def _context(session, version: str) -> RulesContext:
    """Regelkontext je Regelstand einmal aufbauen und halten.

    Der Schlüssel enthält den **Datenstand** aus :mod:`app.live`. Ohne ihn
    würde ein Update zur Laufzeit nie ankommen: Der Prozess bediente
    weiterhin die Karten, die beim ersten Request geladen wurden.
    """
    from app.etl.updates import sync_from_db

    # Gleicht zuerst mit der DB ab — so wird auch ein Ingest bemerkt, der
    # außerhalb dieses Prozesses lief (CLI, Cron).
    key = (version, sync_from_db(session))
    if key not in _context_cache:
        # Alte Stände wegwerfen, statt sie mitzuschleppen.
        _context_cache.clear()
        _context_cache[key] = RulesContext(session, version)
    return _context_cache[key]


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


class GenerateRequest(BaseModel):
    list: dict[str, Any]
    #: ``fill`` behält die vorhandenen Einträge (PLAN §5.3 v1, Assistent),
    #: ``auto`` beginnt bei null (v2, Vollautomatik).
    mode: str = "fill"


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
        "data_version": live.data_version(),
        "update_interval_hours": config.UPDATE_INTERVAL_HOURS,
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


@app.post("/api/lists/generate")
def generate_list(request: GenerateRequest) -> dict:
    """Listenvorschlag — PLAN.md §8, Generator aus §5.

    Zwei Betriebsarten hinter einem Endpunkt, wie in §5.3 vorgesehen:
    ``fill`` füllt die mitgeschickte Liste auf, ``auto`` baut von null.

    Die Antwort enthält neben der fertigen Liste den ``patch`` — dieselben
    Aktionen, die auch der Builder schickt. Damit ist der Vorschlag im UI
    ein übernehmbarer Diff und kein Moduswechsel (§6.1).
    """
    if request.mode not in {"fill", "auto"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unbekannter Modus {request.mode!r}. Erlaubt: fill, auto.",
        )

    state = BuilderList.from_dict(request.list)
    with db.session() as session:
        result = generator.generate(
            session,
            state,
            _context(session, state.ruleset_version),
            keep_existing=request.mode == "fill",
        )
    return result.to_dict()


#: So viele Partner je Synergieart gehen ans UI. Ein Trupp, den 29
#: Charaktere anführen dürfen, hat 29 belegte Synergien — als Liste im Panel
#: ist das keine Hilfe mehr, sondern eine Wand.
SYNERGY_LIMIT = 8

_synergy_cache: dict[tuple[str, int], synergy.SynergyIndex] = {}


def _synergy_index(session, faction_id: str, version: str) -> synergy.SynergyIndex:
    """Effekt-Graph je Fraktion, einmal gebaut und gehalten.

    Derselbe Schlüssel wie beim Regelkontext: Ohne den Datenstand würde ein
    Update zur Laufzeit nie ankommen.
    """
    from app.etl.updates import sync_from_db

    key = (faction_id, sync_from_db(session))
    if key not in _synergy_cache:
        _synergy_cache.clear()
        rows = session.scalars(
            select(models.DatasheetCard).where(
                models.DatasheetCard.ruleset_version == version,
                models.DatasheetCard.faction_id == faction_id,
            )
        )
        cards = []
        for row in rows:
            payload = json.loads(row.payload)
            payload.update(
                id=row.datasheet_id, name=row.name, faction_id=row.faction_id,
                transport_capacity=row.transport_capacity,
            )
            cards.append(payload)
        _synergy_cache[key] = synergy.SynergyIndex.build(cards)
    return _synergy_cache[key]


def _synergy_payload(session, datasheet_id: str, version: str) -> dict:
    card = session.get(models.DatasheetCard, (datasheet_id, version))
    if card is None:
        raise HTTPException(status_code=404, detail="Unbekanntes Datasheet")

    index = _synergy_index(session, card.faction_id, version)
    alle = synergy.synergies_for(datasheet_id, index)

    # Je Art nur die ersten paar, aber die Gesamtzahl ehrlich dazu.
    gezeigt: dict[str, list[dict]] = {}
    gesamt: dict[str, int] = {}
    for eintrag in alle:
        gesamt[eintrag.kind] = gesamt.get(eintrag.kind, 0) + 1
        gruppe = gezeigt.setdefault(eintrag.kind, [])
        if len(gruppe) < SYNERGY_LIMIT:
            gruppe.append(eintrag.to_dict())

    einheit = index.units.get(datasheet_id)
    return {
        "datasheet_id": datasheet_id,
        "available": bool(alle),
        "synergies": [s for gruppe in gezeigt.values() for s in gruppe],
        "counts": gesamt,
        "provides": [e.to_dict() for e in einheit.provides] if einheit else [],
        "requires": [n.to_dict() for n in einheit.requires] if einheit else [],
        **synergy.as_dict(),
    }


@app.get("/api/datasheets/{datasheet_id}/synergies")
def datasheet_synergies(
    datasheet_id: str, ruleset: str = Query(default=config.RULESET_VERSION)
) -> dict:
    """Regelbasierte Synergien — PLAN.md §4.1, §8.

    Angebot und Nachfrage je Einheit, gematcht innerhalb der Fraktion. Die
    empirische Hälfte (§4.2) fehlt weiterhin und steht als solche in der
    Antwort.
    """
    with db.session() as session:
        return _synergy_payload(session, datasheet_id, ruleset)


@app.get("/api/datasheets/{datasheet_id}/context")
def datasheet_context(datasheet_id: str) -> dict:
    """Abschnitt 11 des Panels — Meta und Synergie zum Listenkontext.

    Die **regelbasierte** Hälfte aus §4.1 steht jetzt darin: Sie braucht nur
    Regeldaten. Die **empirische** aus §4.2 und die Meta-Zahlen aus §3
    brauchen Turnierlisten und fehlen weiterhin — getrennt ausgewiesen, weil
    §4 genau diese Trennung verlangt: Sonst lässt sich nie sagen, *warum*
    etwas empfohlen wurde.
    """
    with db.session() as session:
        rules_based = _synergy_payload(session, datasheet_id, config.RULESET_VERSION)

    return {
        "datasheet_id": datasheet_id,
        "rules_based": rules_based,
        "empirical": {
            "available": False,
            "reason": (
                "Meta-Zahlen (§3) und empirische Synergie (§4.2) brauchen "
                "die Turnierauswertung aus den Phasen 1–3."
            ),
            "inclusion_rate": None,
        },
    }


# ---------------------------------------------------------------------------
# Live-Updates
# ---------------------------------------------------------------------------


@app.get("/api/updates/status")
def update_status() -> dict:
    return live.snapshot()


@app.post("/api/updates/check")
async def update_check(apply: bool = Query(default=True)) -> dict:
    """Prüft von Hand auf einen neueren Regelstand.

    Das Warten auf die Quelle blockiert die Event-Loop nicht — sonst stünde
    das UI während eines Ingests von rund 30 Sekunden.
    """
    from app.etl.updates import check, refresh
    from app.etl.wahapedia import HttpSource

    source = HttpSource(cache_dir=None)
    if apply:
        result = await asyncio.to_thread(refresh, source)
        return {
            "applied": result.applied,
            "reason": result.reason,
            "cards": result.cards,
            **live.snapshot(),
        }

    with db.session() as session:
        outcome = await asyncio.to_thread(check, source, session)
    return {"applied": False, "changed": outcome.changed, **live.snapshot()}


def sync_data_version() -> int:
    """Fragt die Datenbank, welcher Regelstand geladen ist.

    Ein Primärschlüssel-Lookup auf einer Tabelle mit drei Zeilen. Billig
    genug, um ihn regelmäßig zu machen, und die einzige Stelle, an der ein
    Ingest aus einem *anderen* Prozess überhaupt auffallen kann.
    """
    from app.etl.updates import sync_from_db

    try:
        with db.session() as session:
            return sync_from_db(session)
    except Exception:  # noqa: BLE001 - eine kaputte DB killt den Stream nicht
        return live.data_version()


async def event_stream(is_disconnected, tick: float = 1.0, sync=sync_data_version):
    """Server-Sent Events: meldet offenen Browsern einen neuen Regelstand.

    Der Stream beobachtet den Datenstand-Zähler aus :mod:`app.live`, statt
    sich in den Ingest einzuklinken. Das kommt ohne Kopplung zwischen
    Worker-Thread und Event-Loop aus und verpasst nichts: Der Zähler steigt
    monoton, ein Client mit kleinerem Wert ist schlicht veraltet.

    ``is_disconnected`` wird bei jeder Runde gefragt. Ohne diese Abfrage
    liefe der Stream ewig weiter, auch wenn der Browser längst zu ist — bei
    jedem Reload ein zusätzlicher Task, der nie endet.
    """
    seen = sync()
    yield _sse("hello", live.snapshot())

    heartbeat = 0
    while not await is_disconnected():
        await asyncio.sleep(tick)
        # Bewusst hier und nicht nur im Anfrage-Pfad: Ohne eigene Abfrage
        # bliebe ein Ingest aus einem anderen Prozess unbemerkt, solange
        # niemand klickt — also genau dann, wenn die Meldung nötig wäre.
        current = sync()
        if current != seen:
            seen = current
            yield _sse("ruleset-changed", live.snapshot())
        heartbeat += 1
        if heartbeat >= 25:
            # Kommentarzeile hält Proxies und Browser bei Laune.
            heartbeat = 0
            yield ": ping\n\n"


@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    return StreamingResponse(
        event_stream(request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


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
