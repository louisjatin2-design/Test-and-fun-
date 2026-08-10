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
import re
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
            # Waffen und Profile braucht der Generator für das Rollenprofil
            # (§5.2). Die Offline-Datei liefert ohnehin die ganze Karte aus.
            "weapons": payload["weapons"],
            "profiles": payload["profiles"],
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

    # Keine hartkodierte Obergrenze für gleiche Datasheets.
    #
    # Dieser Test suchte früher pauschal nach "= 3;". Seit die Datei auch
    # das Rollenprofil enthält, steht dort die Verwundungstabelle des
    # Kernregelwerks — "S größer als T, also braucht es eine 3+". Das ist
    # keine Listenbau-Konstante, die sich mit einem Dataslate ändert,
    # sondern die Rechenregel selbst. Der Wächter zielt deshalb jetzt auf
    # die Zeilen, um die es ihm ging.
    hartkodiert = [
        zeile.strip() for zeile in quelle.splitlines()
        if ("copies" in zeile.lower() or "enhancement" in zeile.lower())
        and re.search(r"[=<>]\s*\d+\s*;", zeile)
    ]
    assert not hartkodiert, f"Obergrenze hartkodiert: {hartkodiert}"


# ---------------------------------------------------------------------------
# Der Generator gibt es ebenfalls zweimal
# ---------------------------------------------------------------------------
#
# Ohne Server soll auf dem iPad nicht nur validiert, sondern auch gebaut
# werden können. Damit steht neben Reducer und Validator jetzt auch der
# Generator doppelt da — und muss denselben Nachweis erbringen: Beide Seiten
# bauen aus derselben Ausgangslage dieselbe Liste.
#
# Verglichen wird *strukturell*, nicht über uids: Die vergibt jede Seite
# selbst (uuid4 hier, Math.random dort), sie können gar nicht gleich sein.
# Verglichen werden Reihenfolge und Inhalt der Einträge, wer an wem hängt,
# Punkte, Legalität, Abdeckung und jeder Begründungstext.


def generator_config() -> dict:
    from app.rules import generator

    return generator.as_dict()


def run_browser_generator(session, liste: dict, keep_existing: bool) -> dict:
    payload = {
        "ruleset": ruleset.as_dict() | {"ruleset_version": "wh40k11ed"},
        "cards": browser_cards(session),
        "enhancements": browser_enhancements(session),
        "list": liste,
        "generate": {"config": generator_config(), "keep_existing": keep_existing},
    }
    result = subprocess.run(
        ["node", str(DRIVER)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def run_python_generator(session, liste: dict, keep_existing: bool) -> dict:
    from app.rules import generator

    state = BuilderList.from_dict(liste)
    ctx = RulesContext(session, state.ruleset_version)
    return generator.generate(session, state, ctx, keep_existing).to_dict()


def struktur(ergebnis: dict) -> dict:
    """Alles, was beide Seiten gleich haben müssen — ohne die uids."""
    entries = ergebnis["list"]["entries"]
    index = {entry["uid"]: position for position, entry in enumerate(entries)}
    return {
        "einheiten": [
            (e["datasheet_id"], e["model_count"], e["is_warlord"],
             e["enhancement_id"])
            for e in entries
        ],
        "anschluesse": [
            (position, index.get(e["attached_to_uid"]))
            for position, e in enumerate(entries) if e["attached_to_uid"]
        ],
        "transporte": [
            (position, index.get(e["transported_in_uid"]))
            for position, e in enumerate(entries) if e["transported_in_uid"]
        ],
        "punkte": ergebnis["validation"]["points_used"],
        "legal": ergebnis["validation"]["legal"],
        "meldungen": [f["message"] for f in ergebnis["validation"]["findings"]],
        "begruendungen": [p["reason"] for p in ergebnis["picks"]],
        "luecken": ergebnis["gaps"],
    }


@pytest.mark.parametrize("limit", [500, 1000, 2000])
def test_generator_baut_beidseitig_dieselbe_liste(session, limit):
    liste = leere_liste() | {"points_limit": limit}

    python = run_python_generator(session, liste, keep_existing=False)
    browser = run_browser_generator(session, liste, keep_existing=False)

    assert struktur(python) == struktur(browser), f"points_limit={limit}"
    # Python rundet die Abdeckung in to_dict() auf drei Stellen für die
    # Anzeige; der Browser gibt sie roh heraus. Verglichen wird deshalb auf
    # derselben Stelle — nicht die Rundung ist die Zusicherung, die Zahl.
    for key, wert in python["coverage"].items():
        assert round(browser["coverage"][key], 3) == pytest.approx(wert), key


def test_generator_fuellt_beidseitig_gleich_auf(session):
    """Der Assistenten-Modus — mit gesperrtem Kern aus einem ersten Lauf."""
    leer = leere_liste()
    kern = run_python_generator(session, leer, keep_existing=False)
    vorbelegt = leer | {"entries": kern["list"]["entries"][:1]}

    python = run_python_generator(session, vorbelegt, keep_existing=True)
    browser = run_browser_generator(session, vorbelegt, keep_existing=True)

    assert struktur(python) == struktur(browser)


def test_generator_rechnet_beidseitig_dasselbe_rollenprofil(session):
    """Die Schadensrechnung selbst, Karte für Karte.

    Läuft sie auseinander, weichen die Listen erst weiter oben ab — und die
    Ursache wäre dann mühsam zu finden. Hier fällt es sofort auf.
    """
    from app.rules import roleprofile

    karten = browser_cards(session)
    payload = {
        "ruleset": ruleset.as_dict() | {"ruleset_version": "wh40k11ed"},
        "cards": karten,
        "enhancements": browser_enhancements(session),
        "list": leere_liste(),
        "generate": {"config": generator_config(), "keep_existing": False},
    }
    # Der Treiber liefert die Kandidatenbewertung über die fertige Liste
    # zurück; für den direkten Vergleich reicht der Vektor je Karte.
    skript = (
        "const R = globalThis.WHRules;"
        "const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));"
        "const out = {};"
        "for (const card of input.cards) {"
        "  for (const option of card.points || []) {"
        "    out[card.id + ' ' + option.models] ="
        "      R.unitVector(card, option.models, input.generate.config.roles);"
        "  }"
        "}"
        "process.stdout.write(JSON.stringify(out));"
    )
    quelle = (Path(__file__).parent.parent / "app" / "static" / "rules.js").read_text()
    result = subprocess.run(
        ["node", "-e", f"new Function({json.dumps(quelle)}).call(globalThis);{skript}"],
        input=json.dumps(payload), capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    browser = json.loads(result.stdout)

    assert browser, "Der Browser hat kein einziges Rollenprofil gerechnet"
    for card in karten:
        for option in card["points"]:
            erwartet = roleprofile.unit_vector(card, option["models"])
            gemessen = browser[f"{card['id']} {option['models']}"]
            for feld in ("anti_tank", "anti_elite", "anti_horde",
                         "durability", "control", "reach"):
                assert gemessen[feld] == pytest.approx(
                    getattr(erwartet, feld), rel=1e-9, abs=1e-12), \
                    f"{card['name']} ({option['models']} Modelle), {feld}"


def test_generator_konstanten_kommen_aus_einer_quelle():
    """Auch der Generator erfindet im Browser keine eigenen Zahlen."""
    from app.rules import generator

    daten = generator.as_dict()
    assert daten["spend_weight"] == generator.SPEND_WEIGHT
    assert daten["weights"] == generator.WEIGHTS
    assert daten["roles"]["targets"]["anti_tank"]["toughness"] == 10

    quelle = (Path(__file__).parent.parent / "app" / "static" / "rules.js").read_text()
    for feld in ("spend_weight", "overshoot_credit", "leader_bonus",
                 "duplicate_penalty", "lone_character_penalty",
                 "max_character_share", "validate_top_k"):
        assert f"cfg.{feld}" in quelle, f"{feld} wird nicht aus der Config gelesen"
