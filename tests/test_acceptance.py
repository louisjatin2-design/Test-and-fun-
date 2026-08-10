"""Die Abnahmekriterien aus PLAN.md §6.7.

Nicht "fühlt sich gut an", sondern nachprüfbar. Kriterium 3 (100 ms im
Browser) braucht Playwright und steht noch aus; hier wird stattdessen die
Server-Seite dieses Budgets gemessen — der Anteil, der überhaupt in
Serverhand liegt.
"""

from __future__ import annotations

import json
import random
import time

import pytest
from sqlalchemy import select

from app import models
from app.rules.builderlist import BuilderList, apply_all
from app.rules.validator import RulesContext, validate

# Abschnitte, die eine Karte immer mitbringen muss. Fehlt einer, landet beim
# Nutzer eine leere Fläche statt einer Regel.
PFLICHTFELDER = (
    "id", "name", "faction_id", "role", "keywords", "points", "profiles",
    "weapons", "abilities", "can_lead", "led_by", "enhancement_ids",
    "detachment_ids", "composition", "options", "source",
)


def test_kriterium_1_jede_karte_ist_vollstaendig(session):
    """Contract-Test über *alle* Datasheets der Regel-DB."""
    cards = session.scalars(select(models.DatasheetCard)).all()
    assert cards

    for card in cards:
        payload = json.loads(card.payload)
        fehlend = [feld for feld in PFLICHTFELDER if feld not in payload]
        assert not fehlend, f"{card.name}: fehlende Abschnitte {fehlend}"
        assert payload["weapons"].keys() == {"ranged", "melee"}
        assert isinstance(payload["profiles"], list)


def test_kriterium_1_fehlende_quelldaten_sind_explizit(session):
    """Kein Datensatz heißt ``None``, nicht ein leeres Feld ohne Aussage."""
    cards = session.scalars(select(models.DatasheetCard)).all()
    ohne_transport = [
        json.loads(c.payload) for c in cards if c.transport_capacity == 0
    ]
    assert ohne_transport
    for payload in ohne_transport:
        # transport ist None (= "gibt es nicht"), nicht {} (= "wissen wir nicht")
        assert payload["transport"] is None or payload["transport"]["capacity"] == 0


# ---------------------------------------------------------------------------
# Kriterium 2 — Konsistenz Builder ↔ Validator
# ---------------------------------------------------------------------------
# "Eine Folge zufälliger, vom UI angebotener Aktionen darf nie zu einer Liste
# führen, die der Validator als hart illegal ablehnt."
#
# Präzisierung: Das gilt für die Regeln, bei denen das UI die Auswahl
# *filtert* — Anschlussziele, Enhancement-Träger, Detachment-Zuordnung,
# Fraktion. Punktelimit, Rule of Three und Kapazität filtert das UI bewusst
# nicht: Sie sollen als Befund sichtbar werden, statt die Eingabe zu
# blockieren (PLAN.md §6.1, "ein Builder, der bevormundet, wird umgangen").
GEFILTERTE_REGELN = {
    "leader_attach",
    "enhancement_allowed",
    "enhancement_bearer",
    "enhancement_detachment",
    "faction_match",
}


def _ui_angebotene_aktion(state, cards, enhancements, rng):
    """Bildet nach, was die Oberfläche tatsächlich anbietet (app.js)."""
    optionen = []

    # Katalog: jede Einheit der Fraktion.
    optionen.append(
        lambda: {
            "type": "ADD_UNIT",
            "datasheet_id": rng.choice(list(cards)),
            "uid": f"u{rng.randrange(10**6)}",
        }
    )

    if state.entries:
        eintrag = rng.choice(state.entries)
        karte = cards[eintrag.datasheet_id]

        # Anschluss: nur Ziele aus can_lead, die in der Liste stehen.
        erlaubt = {t["id"] for t in karte["can_lead"]}
        ziele = [
            e for e in state.entries
            if e.uid != eintrag.uid and e.datasheet_id in erlaubt
        ]
        if ziele:
            ziel = rng.choice(ziele)
            optionen.append(lambda: {
                "type": "ATTACH_LEADER", "uid": eintrag.uid,
                "target_uid": ziel.uid,
            })

        # Transport: nur Einheiten mit erkannter Kapazität.
        transporte = [
            e for e in state.entries
            if e.uid != eintrag.uid and cards[e.datasheet_id]["transport_capacity"] > 0
        ]
        if transporte and karte["transport_capacity"] == 0:
            transport = rng.choice(transporte)
            optionen.append(lambda: {
                "type": "EMBARK", "uid": eintrag.uid,
                "transport_uid": transport.uid,
            })

        # Enhancement: nur zulässige Träger, nur passendes Detachment.
        if karte["is_character"] and not karte["is_epic_hero"]:
            passend = [
                enh_id for enh_id in karte["enhancement_ids"]
                if enhancements[enh_id].detachment_id == state.detachment_id
            ]
            if passend:
                gewaehlt = rng.choice(passend)
                optionen.append(lambda: {
                    "type": "SET_ENHANCEMENT", "uid": eintrag.uid,
                    "enhancement_id": gewaehlt,
                })

        # Truppgröße: nur angebotene Staffeln.
        if len(karte["points"]) > 1:
            staffel = rng.choice(karte["points"])
            optionen.append(lambda: {
                "type": "SET_MODEL_COUNT", "uid": eintrag.uid,
                "model_count": staffel["models"],
            })

        optionen.append(lambda: {"type": "SET_WARLORD", "uid": eintrag.uid}
                        if karte["is_character"]
                        else {"type": "REMOVE_UNIT", "uid": eintrag.uid})
        optionen.append(lambda: {"type": "REMOVE_UNIT", "uid": eintrag.uid})

    return rng.choice(optionen)()


@pytest.mark.parametrize("seed", range(25))
def test_kriterium_2_ui_bietet_nichts_an_was_der_validator_ablehnt(session, seed):
    rng = random.Random(seed)
    cards = {
        card.datasheet_id: json.loads(card.payload) | {
            "is_character": card.is_character,
            "is_epic_hero": card.is_epic_hero,
            "transport_capacity": card.transport_capacity,
        }
        for card in session.scalars(select(models.DatasheetCard))
        if card.faction_id == "TT"
    }
    context = RulesContext(session, "wh40k11ed")
    state = BuilderList(faction_id="TT", detachment_id="D1", points_limit=100_000)

    for _ in range(30):
        aktion = _ui_angebotene_aktion(state, cards, context.enhancements, rng)
        state = apply_all(state, [aktion])
        result = validate(state, session, context)
        verletzt = {
            f.rule for f in result.findings if f.severity == "error"
        } & GEFILTERTE_REGELN
        assert not verletzt, (
            f"seed={seed}: Aktion {aktion} führte zu {verletzt}\n"
            f"Liste: {state.to_dict()}"
        )


def test_kriterium_3_validierung_bleibt_im_budget(session):
    """Der Serveranteil des 100-ms-Budgets aus §6.4."""
    context = RulesContext(session, "wh40k11ed")
    state = BuilderList(faction_id="TT", detachment_id="D1")
    state = apply_all(state, [
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": f"u{i}"}
        for i in range(6)
    ])

    start = time.perf_counter()
    for _ in range(50):
        validate(state, session, context)
    je_aufruf = (time.perf_counter() - start) / 50 * 1000

    assert je_aufruf < 20, f"Validierung braucht {je_aufruf:.1f} ms"


def test_kriterium_4_export_roundtrip(session):
    """Builder-Export → Reimport → identische Liste."""
    state = apply_all(
        BuilderList(faction_id="TT", detachment_id="D1"),
        [
            {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "chef"},
            {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "trupp"},
            {"type": "ATTACH_LEADER", "uid": "chef", "target_uid": "trupp"},
            {"type": "SET_ENHANCEMENT", "uid": "chef", "enhancement_id": "ENH1"},
            {"type": "SET_WARLORD", "uid": "chef"},
            {"type": "SET_MODEL_COUNT", "uid": "trupp", "model_count": 10},
        ],
    )
    wieder = BuilderList.from_dict(json.loads(json.dumps(state.to_dict())))
    assert wieder == state
    assert validate(wieder, session).points_used == validate(state, session).points_used
