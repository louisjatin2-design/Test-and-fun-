"""ETL und Read-Model."""

import json

from sqlalchemy import func, select

from app import models


def test_ingest_laedt_alle_tabellen(session):
    assert session.scalar(select(func.count()).select_from(models.Datasheet)) == 6
    assert session.scalar(select(func.count()).select_from(models.LeaderAttach)) == 2
    assert session.scalar(select(func.count()).select_from(models.Stratagem)) == 3
    assert session.scalar(select(func.count()).select_from(models.Enhancement)) == 3


def test_stratagem_mit_zeilenumbruch_kommt_vollstaendig_an(session):
    strat = session.get(models.Stratagem, "ST1")
    assert strat.name == "TESTMANOEVER"
    assert strat.phase == "Movement phase"
    assert strat.cp_cost == "1"
    assert "über zwei Zeilen" in strat.legend


def test_meta_wird_gesetzt(session):
    meta = {row.key: row.value for row in session.scalars(select(models.Meta))}
    assert meta["last_update"] == "2026-05-09 23:42:21"
    assert meta["ingested_at"]


def test_karten_fuer_jedes_datasheet(session):
    count = session.scalar(select(func.count()).select_from(models.DatasheetCard))
    assert count == 6


def _payload(session, datasheet_id):
    card = session.scalars(
        select(models.DatasheetCard).where(
            models.DatasheetCard.datasheet_id == datasheet_id
        )
    ).one()
    return card, json.loads(card.payload)


def test_karte_enthaelt_alle_panel_abschnitte(session):
    """PLAN.md §6.2: zwölf Abschnitte, jeder aus seiner Quelltabelle."""
    card, payload = _payload(session, "DS001")

    assert payload["name"] == "Testkommandant"                    # 1 Kopf
    assert payload["points"] == [
        {"models": 1, "description": "1 model", "cost": 80}
    ]
    assert "Character" in payload["keywords"]
    assert payload["faction_keywords"] == ["Testfraktion"]
    assert payload["profiles"][0]["T"] == "4"                     # 2 Profil
    assert payload["weapons"]["ranged"][0]["name"] == "Testpistole"  # 3 Waffen
    assert payload["weapons"]["melee"][0]["name"] == "Testklinge"
    assert payload["abilities"][0]["name"] == "Testaura"          # 4 Fähigkeiten
    assert payload["can_lead"][0]["id"] == "DS002"                # 6 Anschluss
    # 8 und 9: Die Karte trägt nur Verweise; die Objekte kommen einmal je
    # Fraktion mit, statt in jeder Karte kopiert zu werden.
    assert payload["enhancement_ids"] == ["ENH1", "ENH2", "ENH3"]
    assert payload["detachment_ids"] == ["D1"]
    assert payload["composition"] == ["1 Testkommandant"]         # 10
    assert payload["source"]["name"] == "Testcodex"               # 12 Quelle
    assert card.is_character and not card.is_epic_hero


def test_waffen_werden_nach_reichweite_getrennt(session):
    _, payload = _payload(session, "DS001")
    assert [w["name"] for w in payload["weapons"]["melee"]] == ["Testklinge"]
    assert [w["name"] for w in payload["weapons"]["ranged"]] == ["Testpistole"]


def test_waffen_keywords_aus_der_beschreibung(session):
    _, payload = _payload(session, "DS001")
    assert payload["weapons"]["melee"][0]["keywords"] == ["LETHAL HITS"]


def test_html_wird_entschaerft_aber_lesbar(session):
    _, payload = _payload(session, "DS001")
    body = payload["abilities"][0]["description"]
    assert "<b>Testaura:</b>" in body
    assert "<li>" in body

    _, trupp = _payload(session, "DS002")
    assert "<script>" not in trupp["abilities"][0]["description"]


def test_effekt_tags_liegen_an_der_faehigkeit(session):
    _, payload = _payload(session, "DS001")
    assert "Reroll Hits" in payload["abilities"][0]["tags"]


def test_epic_hero_und_transport_sind_indiziert(session):
    held, _ = _payload(session, "DS004")
    assert held.is_epic_hero is True

    panzer, payload = _payload(session, "DS003")
    assert panzer.transport_capacity == 6
    assert payload["transport"]["capacity"] == 6
    assert payload["damaged"]["threshold"] == "5"


def test_led_by_ist_die_umkehrung_von_can_lead(session):
    _, trupp = _payload(session, "DS002")
    assert {entry["id"] for entry in trupp["led_by"]} == {"DS001", "DS004"}


def test_erneuter_lauf_verdoppelt_nichts(session, csv_dir):
    from app.etl.cards import build_cards
    from app.etl.wahapedia import LocalDirSource, ingest

    ingest(LocalDirSource(csv_dir), session)
    build_cards(session)
    session.flush()

    assert session.scalar(select(func.count()).select_from(models.Datasheet)) == 6
    assert session.scalar(select(func.count()).select_from(models.DatasheetCard)) == 6


def test_core_faehigkeiten_werden_aufgeloest(session):
    """Core- und Faction-Regeln stehen nur als ability_id am Datasheet.

    Ohne Auflösung über Abilities.csv zeigt der Inspektor bei jeder Einheit
    ein leeres "Core" — also genau dort nichts, wo man nachschlägt.
    """
    _, payload = _payload(session, "DS003")
    core = [a for a in payload["abilities"] if a["type"] == "Core"]
    assert core, "Core-Fähigkeit fehlt"
    assert core[0]["name"] == "Deep Strike"
    assert core[0]["description"]
    assert core[0]["resolved"] is True


def test_unaufloesbare_faehigkeit_wird_markiert(session):
    """Was auch nach der Auflösung leer bleibt, sagt das ehrlich."""
    from app.etl.cards import _abilities

    row = models.DatasheetAbility(
        datasheet_id="X", line="1", ability_id="GIBTESNICHT",
        model="", name="", description="", type="Core", parameter="",
    )
    result = _abilities([row], {})
    assert result[0]["resolved"] is False
    assert result[0]["name"] == "Core"
