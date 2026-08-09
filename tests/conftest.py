"""Testdaten.

**Synthetisch, nicht echt.** Die Fixtures erfinden eine Fraktion mit fünf
Datasheets. Echte Wahapedia-Daten gehören nicht ins Repository — sie zu
committen wäre genau die Veröffentlichung, die PLAN.md §6.3 ausschließt.
Struktur und Eigenheiten des Formats sind dagegen exakt nachgebildet:
BOM, abschließende Pipe, HTML im Beschreibungstext und ein Datensatz mit
einem rohen Zeilenumbruch mitten im Feld.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

BOM = "﻿"


def _csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    lines = ["|".join(header) + "|"]
    lines += ["|".join(row) + "|" for row in rows]
    path.write_text(BOM + "\n".join(lines) + "\n", encoding="utf-8")


@pytest.fixture
def csv_dir(tmp_path: Path) -> Path:
    """Ein vollständiger, kleiner Export im echten Format."""
    directory = tmp_path / "csv"
    directory.mkdir()

    _csv(directory / "Last_update.csv", ["last_update"], [["2026-05-09 23:42:21"]])

    _csv(
        directory / "Source.csv",
        ["id", "name", "type", "edition", "version", "errata_date", "errata_link"],
        [["SRC1", "Testcodex", "Codex", "11", "1.2", "2026-04-01", "https://example.invalid"]],
    )
    _csv(
        directory / "Factions.csv",
        ["id", "name", "link"],
        [["TT", "Testfraktion", "https://example.invalid/tt"],
         ["XX", "Fremdfraktion", "https://example.invalid/xx"]],
    )

    datasheet_header = [
        "id", "name", "faction_id", "source_id", "legend", "role", "loadout",
        "transport", "virtual", "leader_head", "leader_footer", "damaged_w",
        "damaged_description", "link",
    ]
    _csv(
        directory / "Datasheets.csv",
        datasheet_header,
        [
            ["DS001", "Testkommandant", "TT", "SRC1", "Führt die Truppe.",
             "Characters", "Testpistole", "", "", "Kann sich anschließen an:",
             "", "", "", "https://example.invalid/ds001"],
            ["DS002", "Testtrupp", "TT", "SRC1", "", "Battleline",
             "Testgewehr", "", "", "", "", "", "",
             "https://example.invalid/ds002"],
            ["DS003", "Testpanzer", "TT", "SRC1", "", "Other", "Testkanone",
             "This model has a transport capacity of 6 Test Infantry models.",
             "", "", "", "5", "Beschädigt: -1 auf Trefferwürfe.",
             "https://example.invalid/ds003"],
            ["DS004", "Testheld", "TT", "SRC1", "", "Characters", "Testschwert",
             "", "", "", "", "", "", "https://example.invalid/ds004"],
            ["DS005", "Testkanone", "TT", "SRC1", "", "Other", "Grosse Kanone",
             "", "", "", "", "", "", "https://example.invalid/ds005"],
            ["DS900", "Fremdeinheit", "XX", "SRC1", "", "Other", "", "", "",
             "", "", "", "", "https://example.invalid/ds900"],
        ],
    )
    _csv(
        directory / "Datasheets_models.csv",
        ["datasheet_id", "line", "name", "M", "T", "Sv", "inv_sv", "inv_sv_descr",
         "W", "Ld", "OC", "base_size", "base_size_descr"],
        [
            ["DS001", "1", "Testkommandant", '6"', "4", "3+", "4", "", "5", "6+", "1", "32mm", ""],
            ["DS002", "1", "Testkrieger", '6"', "4", "3+", "-", "", "2", "6+", "2", "32mm", ""],
            ["DS003", "1", "Testpanzer", '10"', "9", "3+", "-", "", "11", "6+", "3", "100mm", ""],
            ["DS004", "1", "Testheld", '6"', "4", "2+", "4", "", "6", "6+", "1", "40mm", ""],
            ["DS005", "1", "Testkanone", '3"', "5", "4+", "-", "", "6", "7+", "1", "60mm", ""],
            ["DS900", "1", "Fremdmodell", '6"', "4", "4+", "-", "", "2", "7+", "1", "25mm", ""],
        ],
    )
    _csv(
        directory / "Datasheets_wargear.csv",
        ["datasheet_id", "line", "line_in_wargear", "dice", "name", "description",
         "range", "type", "A", "BS_WS", "S", "AP", "D"],
        [
            ["DS001", "1", "1", "", "Testpistole", "[PISTOL]", '12"', "Ranged",
             "1", "2+", "4", "-1", "1"],
            ["DS001", "2", "1", "", "Testklinge", "[LETHAL HITS]", "Melee",
             "Melee", "5", "2+", "6", "-2", "2"],
            ["DS002", "1", "1", "", "Testgewehr", "[RAPID FIRE 1]", '24"',
             "Ranged", "1", "3+", "4", "0", "1"],
            ["DS003", "1", "1", "", "Testkanone", "[BLAST]", '48"', "Ranged",
             "D6", "3+", "10", "-3", "3"],
            ["DS004", "1", "1", "", "Testschwert", "[DEVASTATING WOUNDS]",
             "Melee", "Melee", "6", "2+", "8", "-3", "3"],
            ["DS005", "1", "1", "", "Grosse Kanone", "[HEAVY]", '36"', "Ranged",
             "3", "4+", "9", "-2", "2"],
        ],
    )
    _csv(
        directory / "Datasheets_keywords.csv",
        ["datasheet_id", "keyword", "model", "is_faction_keyword"],
        [
            ["DS001", "Character", "", "false"],
            ["DS001", "Infantry", "", "false"],
            ["DS001", "Testfraktion", "", "true"],
            ["DS002", "Infantry", "", "false"],
            ["DS002", "Battleline", "", "false"],
            ["DS002", "Testfraktion", "", "true"],
            ["DS003", "Vehicle", "", "false"],
            ["DS003", "Transport", "", "false"],
            ["DS004", "Character", "", "false"],
            ["DS004", "Epic Hero", "", "false"],
            ["DS004", "Infantry", "", "false"],
            ["DS005", "Vehicle", "", "false"],
            ["DS900", "Infantry", "", "false"],
        ],
    )
    _csv(
        directory / "Datasheets_abilities.csv",
        ["datasheet_id", "line", "ability_id", "model", "name", "description",
         "type", "parameter"],
        [
            # HTML im Text ist der Normalfall, nicht die Ausnahme.
            ["DS001", "1", "A1", "", "Testaura",
             "<b>Testaura:</b> Verbündete Einheiten within 6\" können "
             "re-roll the hit roll.<br><ul><li>Gilt nur in der Schussphase.</li></ul>",
             "Datasheet", ""],
            # Injection-Versuch aus den Quelldaten — muss entschärft werden.
            ["DS002", "1", "A2", "", "Testfaehigkeit",
             'Ganz harmlos <script>alert("xss")</script> und weiter.',
             "Datasheet", ""],
            ["DS003", "1", "A3", "", "Deep Strike", "This unit has Deep Strike.",
             "Core", ""],
            ["DS004", "1", "A4", "", "Heldenhaft",
             "Add 1 to the wound roll for attacks made by this model.",
             "Datasheet", ""],
        ],
    )
    _csv(
        directory / "Abilities.csv",
        ["id", "name", "legend", "faction_id", "description"],
        [["A3", "Deep Strike", "", "", "Kann per Deep Strike aufgestellt werden."]],
    )
    _csv(
        directory / "Datasheets_leader.csv",
        ["leader_id", "attached_id"],
        [["DS001", "DS002"], ["DS004", "DS002"]],
    )
    _csv(
        directory / "Enhancements.csv",
        ["faction_id", "id", "name", "cost", "detachment", "detachment_id",
         "legend", "description"],
        [
            ["TT", "ENH1", "Testrelikt", "15", "Testdetachment", "D1", "",
             "Der Träger erhält <b>Lethal Hits</b>."],
            ["TT", "ENH2", "Zweitrelikt", "20", "Testdetachment", "D1", "",
             "Add 1 to the hit roll."],
            ["TT", "ENH3", "Fremdrelikt", "10", "Anderesdetachment", "D2", "",
             "Gehört zu einem anderen Detachment."],
        ],
    )
    _csv(
        directory / "Datasheets_enhancements.csv",
        ["datasheet_id", "enhancement_id"],
        [["DS001", "ENH1"], ["DS001", "ENH2"], ["DS001", "ENH3"],
         ["DS004", "ENH1"]],
    )
    _csv(
        directory / "Detachment_abilities.csv",
        ["id", "faction_id", "name", "legend", "description", "detachment",
         "detachment_id"],
        [["DA1", "TT", "Testdoktrin", "", "Einheiten erhalten Stealth.",
          "Testdetachment", "D1"],
         ["DA2", "TT", "Anderedoktrin", "", "Etwas anderes.",
          "Anderesdetachment", "D2"]],
    )
    _csv(
        directory / "Datasheets_detachment_abilities.csv",
        ["datasheet_id", "detachment_ability_id"],
        [[f"DS00{i}", "DA1"] for i in range(1, 6)],
    )
    _csv(
        directory / "Datasheets_unit_composition.csv",
        ["datasheet_id", "line", "description"],
        [["DS002", "1", "5-10 Testkrieger"], ["DS001", "1", "1 Testkommandant"]],
    )
    _csv(
        directory / "Datasheets_options.csv",
        ["datasheet_id", "line", "button", "description"],
        [["DS002", "1", "Option", "Ein Modell kann das Testgewehr ersetzen."]],
    )
    _csv(
        directory / "Datasheets_models_cost.csv",
        ["datasheet_id", "line", "description", "cost"],
        [
            ["DS001", "1", "1 model", "80"],
            ["DS002", "1", "5 models", "90"],
            ["DS002", "2", "10 models", "180"],
            ["DS003", "1", "1 model", "150"],
            ["DS004", "1", "1 model", "100"],
            ["DS005", "1", "1 model", "70"],
            ["DS900", "1", "1 model", "50"],
        ],
    )

    # Stratagems: ein Datensatz enthält absichtlich einen rohen Zeilenumbruch
    # im legend-Feld — genau wie der echte Export vom 09.08.2026.
    stratagem_header = (
        "faction_id|name|id|type|cp_cost|legend|turn|phase|detachment|"
        "detachment_id|description|"
    )
    stratagems = [
        "TT|TESTMANOEVER|ST1|Testdetachment – Strategic Ploy|1|Ein Kniff, der\n"
        "über zwei Zeilen geht. |Your turn|Movement phase|Testdetachment|D1|"
        "<b>WANN:</b> Deine Bewegungsphase.<br><b>ZIEL:</b> Eine Einheit.|",
        "TT|ZWEITMANOEVER|ST2|Testdetachment – Battle Tactic|2|Kurz.|"
        "Either player|Fight phase|Testdetachment|D1|"
        "<b>WANN:</b> Kampfphase.|",
        "TT|FREMDMANOEVER|ST3|Anderesdetachment – Epic Deed|1|Anders.|"
        "Your turn|Charge phase|Anderesdetachment|D2|<b>WANN:</b> Chargephase.|",
    ]
    (directory / "Stratagems.csv").write_text(
        BOM + stratagem_header + "\n" + "\n".join(stratagems) + "\n",
        encoding="utf-8",
    )

    return directory


@pytest.fixture
def session(tmp_path, csv_dir, monkeypatch):
    """Frische DB mit geladenen Testdaten."""
    monkeypatch.setenv("WH_DATABASE_URL", f"sqlite:///{tmp_path / 'test.sqlite3'}")
    monkeypatch.setenv("WH_RULES_TEXT_MODE", "full")

    import importlib

    from app import config, db
    importlib.reload(config)
    importlib.reload(db)

    from app.etl.cards import build_cards
    from app.etl.wahapedia import LocalDirSource, ingest

    db.create_all()
    # Erst laden und committen, dann eine frische Session herausgeben: Sonst
    # sieht die API, die eine eigene Session öffnet, nichts von den Daten.
    with db.session() as loader:
        ingest(LocalDirSource(csv_dir), loader)
        build_cards(loader)

    with db.session() as sess:
        yield sess


@pytest.fixture
def client(session, monkeypatch):
    """TestClient auf derselben DB."""
    from fastapi.testclient import TestClient

    from app.api import main

    main.invalidate_context_cache()
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for key in ("WH_RULES_TEXT_MODE", "WH_DATABASE_URL"):
        monkeypatch.delenv(key, raising=False)
    os.environ.setdefault("WH_RULESET_VERSION", "wh40k11ed")
