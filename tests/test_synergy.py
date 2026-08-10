"""Regelbasierte Synergie — PLAN.md §4.1.

Der Plan trennt deduktive und induktive Signale ausdrücklich. Diese Tests
prüfen die deduktive Hälfte auf drei Dinge: dass sie das findet, was in den
Daten steht; dass sie *nicht* findet, was nicht drinsteht; und dass sie
sagt, welche Hälfte fehlt.

Der zweite Punkt ist der wichtigere. Der erste Entwurf zählte jede
Fähigkeit mit „Wiederholungswurf" als Angebot an andere — auch wenn sie nur
die eigene Einheit betraf. Für einen einzigen Trupp kamen dadurch knapp
tausend „Synergien" heraus, und keine davon war eine Auskunft.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app import models
from app.rules import synergy


def karten(session) -> list[dict]:
    out = []
    for row in session.scalars(select(models.DatasheetCard)):
        payload = json.loads(row.payload)
        payload.update(id=row.datasheet_id, name=row.name,
                       faction_id=row.faction_id,
                       transport_capacity=row.transport_capacity)
        out.append(payload)
    return out


@pytest.fixture
def index(session) -> synergy.SynergyIndex:
    return synergy.SynergyIndex.build(karten(session))


def _by_name(index: synergy.SynergyIndex, name: str) -> synergy.UnitEffects:
    treffer = next((u for u in index.units.values() if u.name == name), None)
    assert treffer is not None, f"{name} fehlt in der Testfraktion"
    return treffer


# ------------------------------------------------------------------- Belegt

def test_anschluss_kommt_aus_den_daten(index):
    """Datasheets_leader nennt die Paare wörtlich — das ist DATA, nicht Ableitung."""
    kommandant = _by_name(index, "Testkommandant")
    treffer = synergy.synergies_for(kommandant.datasheet_id, index)

    anschluss = [s for s in treffer if s.kind == "leader_attach"]
    assert anschluss, "Der Kommandant kann laut Fixture jemanden anführen"
    assert all(s.basis == "DATA" for s in anschluss)
    assert any(s.partner_name == "Testtrupp" for s in anschluss)


def test_transport_traegt_kapazitaet_und_keyword(index):
    """Der Testpanzer hat laut Fixture Kapazität 6 für Test-Infanterie."""
    panzer = _by_name(index, "Testpanzer")
    angebot = [e for e in panzer.provides if e.kind == "transport"]

    assert angebot, "Die Transportkapazität wurde nicht erkannt"
    assert angebot[0].capacity == 6
    assert angebot[0].basis == "DATA"


def test_zu_kleiner_transport_ist_keine_synergie(session):
    """Sechs Plätze für zehn Modelle sind keine Synergie, sondern eine Enttäuschung."""
    zu_gross = synergy.UnitEffects(
        datasheet_id="X", name="Zehnertrupp", faction_id="TT",
        keywords=frozenset({"infantry"}), model_count=10,
    )
    angebot = synergy.Effect("transport", "sechs Plätze", capacity=6,
                             keywords=("infantry",))
    assert synergy._fits(zu_gross, angebot) is False

    passend = synergy.UnitEffects(
        datasheet_id="Y", name="Fünfertrupp", faction_id="TT",
        keywords=frozenset({"infantry"}), model_count=5,
    )
    assert synergy._fits(passend, angebot) is True


def test_falsches_keyword_passt_nicht(session):
    """Steht im Transport-Text ein Keyword, muss die Einheit es tragen."""
    reiter = synergy.UnitEffects(
        datasheet_id="Z", name="Kavallerie", faction_id="TT",
        keywords=frozenset({"cavalry"}), model_count=3,
    )
    nur_infanterie = synergy.Effect("transport", "Platz", capacity=10,
                                    keywords=("infantry",))
    assert synergy._fits(reiter, nur_infanterie) is False


# ---------------------------------------------------- Was *nicht* gefunden wird

def test_eigene_faehigkeiten_sind_kein_angebot_an_andere(session):
    """Der Fehler, der tausend Synergien je Einheit erzeugte.

    Eine Einheit, die ihre *eigenen* Trefferwürfe wiederholt, hilft
    niemandem sonst. Gezählt wird nur, was eine Reichweite hat.
    """
    ohne_aura = {
        "id": "A", "name": "Selbstversorger", "faction_id": "TT",
        "keywords": ["Infantry"], "points": [{"models": 1, "cost": 50}],
        "abilities": [{
            "name": "Zielsicher",
            "description": "This model can re-roll the hit roll for its attacks.",
        }],
    }
    mit_aura = {
        **ohne_aura, "id": "B", "name": "Anführer",
        "abilities": [{
            "name": "Befehl",
            "description": "Units within 6\" of this model can re-roll the hit roll.",
        }],
    }

    assert not [e for e in synergy.effects_for(ohne_aura).provides
                if e.kind == "hit_support"]
    assert [e for e in synergy.effects_for(mit_aura).provides
            if e.kind == "hit_support"]


def test_synergien_bleiben_in_zweistelliger_groessenordnung(index):
    """Eine Wand aus Treffern ist keine Auskunft.

    Die Fixture ist klein; die Zusicherung zielt auf das Verhältnis. Wenn
    hier plötzlich jede Einheit mit jeder anderen synergiert, ist wieder ein
    Filter weggefallen.
    """
    einheiten = len(index.units)
    for unit in index.units.values():
        treffer = synergy.synergies_for(unit.datasheet_id, index)
        assert len(treffer) <= einheiten * 2, (
            f"{unit.name}: {len(treffer)} Synergien bei {einheiten} Einheiten")


def test_keine_synergie_mit_sich_selbst(index):
    for unit in index.units.values():
        for eintrag in synergy.synergies_for(unit.datasheet_id, index):
            assert eintrag.partner_id != unit.datasheet_id


def test_reihenfolge_ist_stabil(index):
    """Zwei Aufrufe müssen dasselbe liefern — sonst springt das Panel."""
    unit = _by_name(index, "Testtrupp")
    erst = [s.to_dict() for s in synergy.synergies_for(unit.datasheet_id, index)]
    nochmal = [s.to_dict() for s in synergy.synergies_for(unit.datasheet_id, index)]
    assert erst == nochmal
    assert erst == sorted(erst, key=lambda s: (s["basis"] != "DATA", s["kind"],
                                               s["partner_name"]))


# -------------------------------------------------------------- Ehrlichkeit

def test_jede_synergie_traegt_ihre_herkunft(index):
    for unit in index.units.values():
        for eintrag in synergy.synergies_for(unit.datasheet_id, index):
            daten = eintrag.to_dict()
            assert daten["basis"] in {"DATA", "ASSUMPTION"}
            assert daten["note"], f"{daten['kind']} ohne Begründung der Herkunft"
            assert daten["explanation"].strip()


def test_die_fehlende_haelfte_wird_benannt():
    """§4.2 braucht Turnierlisten — das darf nicht unter den Tisch fallen."""
    daten = synergy.as_dict()
    assert "empirisch" in daten["missing"]
    assert "§4.2" in daten["missing"]["empirisch"]
    assert daten["specs"]["leader_attach"]["basis"] == "DATA"
    assert daten["specs"]["hit_support"]["basis"] == "ASSUMPTION"
