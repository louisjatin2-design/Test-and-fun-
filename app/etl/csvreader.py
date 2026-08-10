"""Reader für das Wahapedia-CSV-Format.

Das Format ist pipe-getrennt, UTF-8 mit BOM, und jede Zeile endet auf ein
zusätzliches ``|``. Zwei Eigenheiten machen ``csv.reader`` unbrauchbar, beide
am echten Export vom 09.08.2026 nachgewiesen:

1. **Kein Quoting.** Felder sind nicht in Anführungszeichen gefasst.
2. **Rohe Zeilenumbrüche in Textfeldern.** In ``Stratagems.csv`` enthält das
   ``legend``-Feld eines Datensatzes einen echten ``\\n``. Ohne Quoting kann
   ``csv.reader`` das nicht erkennen und zerlegt den Datensatz in zwei
   unbrauchbare Zeilen.

Der Reader setzt Datensätze deshalb über die **Feldanzahl** wieder zusammen:
Es wird so lange weitergelesen, bis genug Trennzeichen beisammen sind.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

DELIMITER = "|"
BOM = "﻿"


@dataclass
class ReadReport:
    """Was beim Lesen aufgefallen ist — gehört ins Log, nicht ins Schweigen."""

    rows: int = 0
    rejoined: int = 0
    overlong: list[int] = field(default_factory=list)

    def summary(self) -> str:
        parts = [f"{self.rows} Datensätze"]
        if self.rejoined:
            parts.append(f"{self.rejoined} über Zeilengrenzen zusammengesetzt")
        if self.overlong:
            parts.append(f"{len(self.overlong)} mit zu vielen Feldern")
        return ", ".join(parts)


def parse(text: str) -> tuple[list[dict[str, str]], ReadReport]:
    """Zerlegt den Inhalt einer Wahapedia-CSV in Dictionaries."""
    report = ReadReport()
    if not text:
        return [], report

    text = text.lstrip(BOM).replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    header_line = lines[0]
    columns = _split(header_line)
    # Die abschließende Pipe erzeugt ein leeres Restfeld, das keine Spalte ist.
    if columns and columns[-1] == "":
        columns = columns[:-1]
    if not columns:
        return [], report

    expected = len(columns)
    rows: list[dict[str, str]] = []
    buffer = ""
    buffered_lines = 0

    for raw in lines[1:]:
        candidate = raw if not buffer else f"{buffer}\n{raw}"
        if candidate.strip() == "":
            continue
        fields = _split(candidate)
        # Trailing-Pipe: ein vollständiger Datensatz hat expected + 1 Felder.
        if len(fields) <= expected:
            # Noch unvollständig — der Datensatz läuft über die Zeilengrenze.
            buffer = candidate
            buffered_lines += 1
            continue

        if buffered_lines:
            report.rejoined += 1
        if len(fields) > expected + 1:
            report.overlong.append(len(rows) + 2)

        rows.append(dict(zip(columns, fields[:expected], strict=False)))
        report.rows += 1
        buffer = ""
        buffered_lines = 0

    if buffer.strip():
        # Rest am Dateiende: lieber unvollständig übernehmen als verlieren.
        fields = _split(buffer)
        padded = (fields + [""] * expected)[:expected]
        rows.append(dict(zip(columns, padded, strict=False)))
        report.rows += 1
        report.rejoined += 1

    return rows, report


def iter_rows(text: str) -> Iterator[dict[str, str]]:
    rows, _ = parse(text)
    yield from rows


def _split(line: str) -> list[str]:
    return line.split(DELIMITER)
