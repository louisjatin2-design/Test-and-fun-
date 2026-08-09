"""Der Reader muss die Eigenheiten des echten Exports aushalten."""

from app.etl import csvreader

BOM = "﻿"


def test_bom_und_trailing_pipe():
    text = BOM + "id|name|\n1|Alpha|\n2|Beta|\n"
    rows, report = csvreader.parse(text)
    assert [r["id"] for r in rows] == ["1", "2"]
    assert rows[0]["name"] == "Alpha"
    # Die abschließende Pipe darf keine Geisterspalte erzeugen.
    assert set(rows[0]) == {"id", "name"}
    assert report.rows == 2


def test_roher_zeilenumbruch_im_feld_wird_zusammengesetzt():
    """Der Fall aus Stratagems.csv: ein \\n mitten im Textfeld, ohne Quoting."""
    text = BOM + "id|legend|phase|\n" "1|Ein Text der\nüber zwei Zeilen geht|Movement|\n"
    rows, report = csvreader.parse(text)
    assert len(rows) == 1
    assert rows[0]["legend"] == "Ein Text der\nüber zwei Zeilen geht"
    assert rows[0]["phase"] == "Movement"
    assert report.rejoined == 1


def test_mehrere_umbrueche_hintereinander():
    text = BOM + "id|t|\n1|a\nb\nc|\n2|d|\n"
    rows, report = csvreader.parse(text)
    assert [r["t"] for r in rows] == ["a\nb\nc", "d"]
    assert report.rejoined == 1


def test_leere_zeilen_werden_uebersprungen():
    text = BOM + "id|name|\n1|Alpha|\n\n2|Beta|\n"
    rows, _ = csvreader.parse(text)
    assert len(rows) == 2


def test_crlf():
    text = BOM + "id|name|\r\n1|Alpha|\r\n"
    rows, _ = csvreader.parse(text)
    assert rows[0]["name"] == "Alpha"


def test_zu_viele_felder_werden_gemeldet_nicht_verschluckt():
    text = BOM + "id|name|\n1|Al|pha|\n"
    rows, report = csvreader.parse(text)
    assert report.overlong
    # Der Datensatz geht trotzdem nicht verloren.
    assert rows[0]["id"] == "1"


def test_leerer_input():
    rows, report = csvreader.parse("")
    assert rows == []
    assert report.rows == 0
