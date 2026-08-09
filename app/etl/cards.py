"""Baut das ``datasheet_card``-Read-Model — PLAN.md §6.4.

Die zwölf Abschnitte aus §6.2 werden hier einmalig zu einem JSON-Dokument je
Datasheet zusammengesetzt, damit das Panel zur Laufzeit ohne Joins auskommt.
Abschnitt 11 (Meta/Synergie) ist bewusst nicht enthalten: Er hängt am
Listenkontext und wird asynchron nachgeladen.
"""

from __future__ import annotations

import json
from collections import defaultdict

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import config, derive, models


def build_cards(session: Session, ruleset_version: str | None = None) -> int:
    """Erzeugt alle Karten neu. Gibt die Anzahl zurück."""
    version = ruleset_version or config.RULESET_VERSION

    datasheets = list(session.scalars(select(models.Datasheet)))
    if not datasheets:
        return 0

    profiles = _group(session, models.ModelProfile, "datasheet_id")
    weapons = _group(session, models.Weapon, "datasheet_id")
    keywords = _group(session, models.DatasheetKeyword, "datasheet_id")
    abilities = _group(session, models.DatasheetAbility, "datasheet_id")
    compositions = _group(session, models.UnitComposition, "datasheet_id")
    options = _group(session, models.DatasheetOption, "datasheet_id")
    costs = _group(session, models.Points, "datasheet_id")
    ds_enhancements = _group(session, models.DatasheetEnhancement, "datasheet_id")
    ds_detach = _group(session, models.DatasheetDetachmentAbility, "datasheet_id")

    enhancements = {e.id: e for e in session.scalars(select(models.Enhancement))}
    detach_abilities = {
        d.id: d for d in session.scalars(select(models.DetachmentAbility))
    }
    sources = {s.id: s for s in session.scalars(select(models.Source))}
    shared_abilities = {a.id: a for a in session.scalars(select(models.Ability))}
    names = {d.id: d.name for d in datasheets}

    leaders_of: dict[str, list[str]] = defaultdict(list)
    attaches_to: dict[str, list[str]] = defaultdict(list)
    for pair in session.scalars(select(models.LeaderAttach)):
        leaders_of[pair.attached_id].append(pair.leader_id)
        attaches_to[pair.leader_id].append(pair.attached_id)

    session.execute(
        delete(models.DatasheetCard).where(
            models.DatasheetCard.ruleset_version == version
        )
    )

    built = 0
    for sheet in datasheets:
        sheet_keywords = keywords.get(sheet.id, [])
        keyword_names = [k.keyword for k in sheet_keywords]
        upper = {k.upper() for k in keyword_names}

        cost_rows = sorted(
            costs.get(sheet.id, []), key=lambda c: derive.model_count(c.description)
        )
        min_cost = min(
            (derive.to_int(c.cost) for c in cost_rows if derive.to_int(c.cost) > 0),
            default=0,
        )

        detachment_ids = sorted(
            {
                detach_abilities[link.detachment_ability_id].detachment_id
                for link in ds_detach.get(sheet.id, [])
                if link.detachment_ability_id in detach_abilities
            }
        )

        allowed_enhancements = sorted(
            {
                link.enhancement_id
                for link in ds_enhancements.get(sheet.id, [])
                if link.enhancement_id in enhancements
            }
        )

        payload = {
            # 1 — Kopf
            "id": sheet.id,
            "name": sheet.name,
            "faction_id": sheet.faction_id,
            "role": sheet.role,
            "legend": sheet.legend,
            "loadout": sheet.loadout,
            "link": sheet.link,
            "keywords": [k for k in keyword_names if k],
            "faction_keywords": [
                k.keyword for k in sheet_keywords if k.is_faction_keyword == "true"
            ],
            "points": [
                {
                    "models": derive.model_count(c.description),
                    "description": c.description,
                    "cost": derive.to_int(c.cost),
                }
                for c in cost_rows
            ],
            # 2 — Profilwerte
            "profiles": [
                {
                    "line": p.line,
                    "name": p.name,
                    "M": p.M,
                    "T": p.T,
                    "Sv": p.Sv,
                    "inv_sv": p.inv_sv,
                    "inv_sv_descr": p.inv_sv_descr,
                    "W": p.W,
                    "Ld": p.Ld,
                    "OC": p.OC,
                    "base_size": p.base_size,
                }
                for p in sorted(
                    profiles.get(sheet.id, []), key=lambda p: derive.to_int(p.line)
                )
            ],
            # 3 — Waffen
            "weapons": _weapons(weapons.get(sheet.id, [])),
            # 4 — Fähigkeiten
            "abilities": _abilities(abilities.get(sheet.id, []), shared_abilities),
            # 5 — Schadensprofil
            "damaged": (
                {
                    "threshold": sheet.damaged_w,
                    "description": derive.sanitize_html(sheet.damaged_description),
                }
                if sheet.damaged_w or sheet.damaged_description
                else None
            ),
            # 6 — Anschluss
            "leader_note": {
                "head": derive.sanitize_html(sheet.leader_head),
                "footer": derive.sanitize_html(sheet.leader_footer),
            },
            "can_lead": [
                {"id": target, "name": names.get(target, target)}
                for target in sorted(
                    attaches_to.get(sheet.id, []), key=lambda i: names.get(i, i)
                )
            ],
            "led_by": [
                {"id": leader, "name": names.get(leader, leader)}
                for leader in sorted(
                    leaders_of.get(sheet.id, []), key=lambda i: names.get(i, i)
                )
            ],
            # 7 — Transport
            "transport": {
                "text": derive.sanitize_html(sheet.transport),
                "capacity": derive.transport_capacity(sheet.transport),
            }
            if sheet.transport
            else None,
            # 8 und 9 — nur Verweise, keine Kopien.
            #
            # Enhancements und Stratagems gehören zum *Detachment*, nicht zum
            # Datasheet. Sie in jede Karte zu kopieren hat den Prefetch der
            # Space Marines (298 Datasheets, 44 Detachments) auf 43 MB
            # aufgebläht — dieselben Texte hundertfach. Die Objekte kommen
            # einmal je Fraktion mit; die Karte trägt nur die IDs.
            "enhancement_ids": allowed_enhancements,
            "detachment_ids": detachment_ids,
            # 10 — Truppstärken und Optionen
            "composition": [
                derive.sanitize_html(c.description)
                for c in sorted(
                    compositions.get(sheet.id, []), key=lambda c: derive.to_int(c.line)
                )
            ],
            "options": [
                {
                    "button": o.button,
                    "description": derive.sanitize_html(o.description),
                }
                for o in sorted(
                    options.get(sheet.id, []), key=lambda o: derive.to_int(o.line)
                )
            ],
            # 12 — Quelle und Errata-Stand
            "source": _source(sources.get(sheet.source_id)),
        }

        session.add(
            models.DatasheetCard(
                datasheet_id=sheet.id,
                ruleset_version=version,
                faction_id=sheet.faction_id,
                name=sheet.name,
                role=sheet.role,
                min_cost=min_cost,
                is_epic_hero="EPIC HERO" in upper,
                is_character="CHARACTER" in upper,
                transport_capacity=derive.transport_capacity(sheet.transport),
                payload=json.dumps(payload, ensure_ascii=False),
            )
        )
        built += 1

    session.flush()
    return built


def _weapons(rows: list[models.Weapon]) -> dict[str, list[dict]]:
    ranged: list[dict] = []
    melee: list[dict] = []
    for weapon in sorted(rows, key=lambda w: (derive.to_int(w.line), w.line_in_wargear)):
        entry = {
            "name": weapon.name,
            "range": weapon.range,
            "type": weapon.type,
            "A": weapon.A,
            "BS_WS": weapon.BS_WS,
            "S": weapon.S,
            "AP": weapon.AP,
            "D": weapon.D,
            "description": derive.sanitize_html(weapon.description),
            "keywords": _weapon_keywords(weapon.description),
        }
        # "Melee" steht im Range-Feld; alles andere ist eine Fernkampfwaffe.
        if (weapon.range or "").strip().lower() == "melee":
            melee.append(entry)
        else:
            ranged.append(entry)
    return {"ranged": ranged, "melee": melee}


def _weapon_keywords(description: str) -> list[str]:
    """Waffen-Keywords stehen im Beschreibungsfeld in eckigen Klammern."""
    import re

    plain = derive.strip_html(description or "")
    found = re.findall(r"\[([^\]]+)\]", plain)
    return [k.strip() for k in found if k.strip()]


def _abilities(
    rows: list[models.DatasheetAbility], shared: dict[str, models.Ability]
) -> list[dict]:
    """Fähigkeiten einer Einheit, inklusive der geteilten Core-/Faction-Regeln.

    Core- und Faction-Fähigkeiten stehen nicht am Datasheet: Dort steht nur
    eine ``ability_id``, Name und Text liegen in ``Abilities.csv``. Ohne diese
    Auflösung zeigt der Inspektor bei jeder Einheit ein leeres „Core" — also
    genau bei Deep Strike, Leader oder Lone Operative nichts.
    """
    grouped: list[dict] = []
    for ability in sorted(rows, key=lambda a: (a.type or "", derive.to_int(a.line))):
        name = ability.name
        description = ability.description

        if ability.ability_id and (source := shared.get(ability.ability_id)):
            name = name or source.name
            description = description or source.description

        grouped.append(
            {
                "name": name or ability.type,
                "type": ability.type,
                "model": ability.model,
                "parameter": ability.parameter,
                "description": derive.sanitize_html(description),
                "tags": derive.effect_tags(description),
                # Auch nach der Auflösung kann der Text fehlen — dann sagt das
                # Panel das, statt eine leere Fläche zu zeigen.
                "resolved": bool(description),
            }
        )
    return grouped


def _source(source: models.Source | None) -> dict | None:
    if source is None:
        return None
    return {
        "name": source.name,
        "type": source.type,
        "edition": source.edition,
        "version": source.version,
        "errata_date": source.errata_date,
        "errata_link": source.errata_link,
    }


def _group(session: Session, model: type, attribute: str) -> dict[str, list]:
    bucket: dict[str, list] = defaultdict(list)
    for row in session.scalars(select(model)):
        bucket[getattr(row, attribute)].append(row)
    return bucket
