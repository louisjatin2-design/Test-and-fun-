"""Python-Engine gegen Browser-Engine.

Reducer und Validator gibt es zweimal: in Python für den Server, in
JavaScript für die Offline-Datei, die ohne Server auf einem Telefon läuft.
Diese Doppelung ist der Preis dafür, dass die Offline-Variante überhaupt
validieren kann — PLAN.md §6.5 warnt zu Recht davor.

Der Test macht sie überprüfbar: Dieselben zufälligen Aktionsfolgen laufen
durch beide Implementierungen, verglichen werden Punkte, Legalität und
**jeder Befund samt Meldungstext**. Läuft eine Seite weg, schlägt er fehl.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from app import models
from app.rules import ruleset
from app.rules.builderlist import ActionError, BuilderList, apply_all
from app.rules.validator import RulesContext, validate

DRIVER = Path(__file__).parent / "parity_driver.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node wird für den Parity-Test gebraucht"
)


def browser_cards(session) -> list[dict]:
    """Karten in der Form, die die Offline-Datei ausliefert."""
    cards = []
    for card in session.scalars(select(models.DatasheetCard)):
        payload = json.loads(card.payload)
        cards.append({
            "id": card.datasheet_id,
            "name": card.name,
            "faction_id": card.faction_id,
            "role": card.role,
            "is_character": card.is_character,
            "is_epic_hero": card.is_epic_hero,
            "transport_capacity": card.transport_capacity,
            "points": payload["points"],
            "can_lead": payload["can_lead"],
            "enhancement_ids": payload["enhancement_ids"],
        })
    return cards


def browser_enhancements(session) -> dict:
    return {
        enh.id: {
            "id": enh.id,
            "name": enh.name,
            "cost": int(enh.cost) if enh.cost.strip().isdigit() else 0,
            "detachment": enh.detachment,
            "detachment_id": enh.detachment_id,
        }
        for enh in session.scalars(select(models.Enhancement))
    }


def run_browser(session, liste: dict, patch: list[dict]) -> dict:
    payload = {
        "ruleset": ruleset.as_dict() | {"ruleset_version": "wh40k11ed"},
        "cards": browser_cards(session),
        "enhancements": browser_enhancements(session),
        "list": liste,
        "patch": patch,
    }
    result = subprocess.run(
        ["node", str(DRIVER)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def run_python(session, liste: dict, patch: list[dict]) -> dict:
    state = BuilderList.from_dict(liste)
    try:
        state = apply_all(state, patch)
    except ActionError as exc:
        return {"error": str(exc)}
    return {
        "list": state.to_dict(),
        "validation": validate(state, session).to_dict(),
    }


def assert_gleich(python: dict, js: dict, kontext: str = "") -> None:
    if "error" in python or "error" in js:
        assert python.get("error") == js.get("error"), kontext
        return

    pv, jv = python["validation"], js["validation"]
    assert pv["points_used"] == jv["points_used"], f"Punkte {kontext}"
    assert pv["legal"] == jv["legal"], f"Legalität {kontext}"
    assert pv["per_entry_points"] == jv["per_entry_points"], f"Kosten {kontext}"

    key = lambda f: (f["rule"], f["severity"], f["uid"] or "", f["message"])  # noqa: E731
    pf = sorted(pv["findings"], key=key)
    jf = sorted(jv["findings"], key=key)
    assert [key(f) for f in pf] == [key(f) for f in jf], f"Befunde {kontext}"
    assert [f["basis"] for f in pf] == [f["basis"] for f in jf], f"Herkunft {kontext}"

    # Der Listenzustand selbst muss ebenfalls übereinstimmen.
    assert python["list"]["entries"] == js["list"]["entries"], f"Liste {kontext}"


def leere_liste(**kwargs) -> dict:
    return {
        "faction_id": "TT", "detachment_id": "D1", "points_limit": 2000,
        "ruleset_version": "wh40k11ed", "name": "Parity", "entries": [],
        **kwargs,
    }


# ---------------------------------------------------------------------------
# Feste Fälle: jede Regel einmal
# ---------------------------------------------------------------------------

FAELLE: dict[str, list[dict]] = {
    "leer": [],
    "eine_einheit": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"},
    ],
    "truppgroesse": [
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "a"},
        {"type": "SET_MODEL_COUNT", "uid": "a", "model_count": 10},
    ],
    "punktelimit": [
        {"type": "SET_POINTS_LIMIT", "points_limit": 100},
        {"type": "ADD_UNIT", "datasheet_id": "DS003", "uid": "a"},
    ],
    "fremde_fraktion": [
        {"type": "ADD_UNIT", "datasheet_id": "DS900", "uid": "a"},
    ],
    "rule_of_three": [
        {"type": "ADD_UNIT", "datasheet_id": "DS005", "uid": f"u{i}"}
        for i in range(4)
    ],
    "battleline_sechs_ok": [
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": f"u{i}"}
        for i in range(6)
    ],
    "epic_hero_doppelt": [
        {"type": "ADD_UNIT", "datasheet_id": "DS004", "uid": "a"},
        {"type": "ADD_UNIT", "datasheet_id": "DS004", "uid": "b"},
    ],
    "leader_erlaubt": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "l"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "t"},
        {"type": "ATTACH_LEADER", "uid": "l", "target_uid": "t"},
    ],
    "leader_verboten": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "l"},
        {"type": "ADD_UNIT", "datasheet_id": "DS005", "uid": "k"},
        {"type": "ATTACH_LEADER", "uid": "l", "target_uid": "k"},
    ],
    "zwei_leader": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "l1"},
        {"type": "ADD_UNIT", "datasheet_id": "DS004", "uid": "l2"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "t"},
        {"type": "ATTACH_LEADER", "uid": "l1", "target_uid": "t"},
        {"type": "ATTACH_LEADER", "uid": "l2", "target_uid": "t"},
    ],
    "transport_zu_voll": [
        {"type": "ADD_UNIT", "datasheet_id": "DS003", "uid": "p"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "t", "model_count": 10},
        {"type": "EMBARK", "uid": "t", "transport_uid": "p"},
    ],
    "transport_ohne_kapazitaet": [
        {"type": "ADD_UNIT", "datasheet_id": "DS005", "uid": "k"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "t"},
        {"type": "EMBARK", "uid": "t", "transport_uid": "k"},
    ],
    "enhancement_ok": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "c"},
        {"type": "SET_ENHANCEMENT", "uid": "c", "enhancement_id": "ENH1"},
    ],
    "enhancement_an_epic_hero": [
        {"type": "ADD_UNIT", "datasheet_id": "DS004", "uid": "h"},
        {"type": "SET_ENHANCEMENT", "uid": "h", "enhancement_id": "ENH1"},
    ],
    "enhancement_falsches_detachment": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "c"},
        {"type": "SET_ENHANCEMENT", "uid": "c", "enhancement_id": "ENH3"},
    ],
    "enhancement_doppelt": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"},
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "b"},
        {"type": "SET_ENHANCEMENT", "uid": "a", "enhancement_id": "ENH1"},
        {"type": "SET_ENHANCEMENT", "uid": "b", "enhancement_id": "ENH1"},
    ],
    "warlord_kein_charakter": [
        {"type": "ADD_UNIT", "datasheet_id": "DS005", "uid": "a"},
        {"type": "SET_WARLORD", "uid": "a"},
    ],
    "warlord_ok": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"},
        {"type": "SET_WARLORD", "uid": "a"},
    ],
    "entfernen_loest_verweise": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "l"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "t"},
        {"type": "ATTACH_LEADER", "uid": "l", "target_uid": "t"},
        {"type": "REMOVE_UNIT", "uid": "t"},
    ],
    "detachmentwechsel": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "c"},
        {"type": "SET_ENHANCEMENT", "uid": "c", "enhancement_id": "ENH1"},
        {"type": "SET_DETACHMENT", "detachment_id": "D2"},
    ],
    "unbekannte_uid": [
        {"type": "REMOVE_UNIT", "uid": "gibtesnicht"},
    ],
    "model_count_null": [
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "a"},
        {"type": "SET_MODEL_COUNT", "uid": "a", "model_count": 0},
    ],
    "selbstanschluss": [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"},
        {"type": "ATTACH_LEADER", "uid": "a", "target_uid": "a"},
    ],
}


@pytest.mark.parametrize("name", sorted(FAELLE))
def test_beide_engines_stimmen_ueberein(session, name):
    patch = FAELLE[name]
    liste = leere_liste()
    assert_gleich(
        run_python(session, liste, patch),
        run_browser(session, liste, patch),
        kontext=f"bei '{name}'",
    )


# ---------------------------------------------------------------------------
# Zufällige Folgen
# ---------------------------------------------------------------------------

DATASHEETS = ["DS001", "DS002", "DS003", "DS004", "DS005", "DS900"]
ENHANCEMENTS = ["ENH1", "ENH2", "ENH3"]


def zufallsaktion(rng: random.Random, uids: list[str]) -> dict:
    wahl = rng.randrange(9)
    uid = rng.choice(uids) if uids else None
    if wahl == 0 or uid is None:
        neu = f"u{rng.randrange(10**6)}"
        uids.append(neu)
        return {"type": "ADD_UNIT", "datasheet_id": rng.choice(DATASHEETS),
                "uid": neu, "model_count": rng.choice([1, 5, 10])}
    if wahl == 1:
        uids.remove(uid)
        return {"type": "REMOVE_UNIT", "uid": uid}
    if wahl == 2:
        return {"type": "SET_MODEL_COUNT", "uid": uid,
                "model_count": rng.choice([1, 5, 10])}
    if wahl == 3:
        return {"type": "ATTACH_LEADER", "uid": uid, "target_uid": rng.choice(uids)}
    if wahl == 4:
        return {"type": "EMBARK", "uid": uid, "transport_uid": rng.choice(uids)}
    if wahl == 5:
        return {"type": "SET_ENHANCEMENT", "uid": uid,
                "enhancement_id": rng.choice(ENHANCEMENTS)}
    if wahl == 6:
        return {"type": "SET_WARLORD", "uid": uid}
    if wahl == 7:
        return {"type": "SET_POINTS_LIMIT", "points_limit": rng.choice([500, 2000])}
    return {"type": "DETACH_LEADER", "uid": uid}


@pytest.mark.parametrize("seed", range(12))
def test_zufallsfolgen_stimmen_ueberein(session, seed):
    """Auch Folgen, die niemand von Hand aufschreiben würde."""
    rng = random.Random(seed)
    uids: list[str] = []
    patch = []
    for _ in range(25):
        aktion = zufallsaktion(rng, uids)
        patch.append(aktion)
        if aktion["type"] in ("ATTACH_LEADER", "EMBARK") and (
            aktion["uid"] == aktion.get("target_uid")
            or aktion["uid"] == aktion.get("transport_uid")
        ):
            break  # beide Seiten werfen hier; danach ist die Folge zu Ende

    liste = leere_liste()
    assert_gleich(
        run_python(session, liste, patch),
        run_browser(session, liste, patch),
        kontext=f"seed={seed}, patch={json.dumps(patch)}",
    )


def test_konstanten_kommen_aus_einer_quelle():
    """Die Zahlen dürfen im Browser nicht neu erfunden werden."""
    daten = ruleset.as_dict()
    assert daten["max_same_datasheet"] == ruleset.MAX_SAME_DATASHEET
    assert daten["max_enhancements"] == ruleset.MAX_ENHANCEMENTS
    assert set(daten["specs"]) == set(ruleset.SPECS)

    quelle = (Path(__file__).parent.parent / "app" / "static" / "rules.js").read_text()
    for zahl in ("max_same_datasheet", "max_enhancements", "max_leaders_per_unit"):
        assert f"ruleset.{zahl}" in quelle, f"{zahl} wird nicht aus ruleset gelesen"
    # Keine hartkodierte 3 als Obergrenze im Browser-Code.
    assert "= 3;" not in quelle
