"""Ingestion der Regeldaten — Phase 0 aus PLAN.md §9.

Der Zugang liegt hinter :class:`SourceAdapter` (PLAN.md §1.4): Der Weg zu den
Daten ist eine austauschbare Komponente, keine Architekturentscheidung. Für
Tests und den Offline-Betrieb genügt :class:`LocalDirSource`.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app import config, db, models
from app.etl import csvreader

#: CSV-Datei -> Modellklasse. Die Reihenfolge ist die Ladereihenfolge.
FILES: list[tuple[str, type]] = [
    ("Source", models.Source),
    ("Factions", models.Faction),
    ("Datasheets", models.Datasheet),
    ("Datasheets_models", models.ModelProfile),
    ("Datasheets_wargear", models.Weapon),
    ("Datasheets_keywords", models.DatasheetKeyword),
    ("Datasheets_abilities", models.DatasheetAbility),
    ("Abilities", models.Ability),
    ("Datasheets_leader", models.LeaderAttach),
    ("Enhancements", models.Enhancement),
    ("Datasheets_enhancements", models.DatasheetEnhancement),
    ("Detachment_abilities", models.DetachmentAbility),
    ("Datasheets_detachment_abilities", models.DatasheetDetachmentAbility),
    ("Datasheets_unit_composition", models.UnitComposition),
    ("Datasheets_options", models.DatasheetOption),
    ("Datasheets_models_cost", models.Points),
    ("Stratagems", models.Stratagem),
]

USER_AGENT = (
    "warhammer-meta/0.1 (privates, self-gehostetes Werkzeug; "
    "Kontakt über das GitHub-Repository)"
)


class SourceAdapter(Protocol):
    """Liefert den Rohinhalt einer Exportdatei."""

    def fetch(self, name: str) -> str: ...


@dataclass
class LocalDirSource:
    """Liest die CSVs aus einem lokalen Verzeichnis."""

    directory: Path

    def fetch(self, name: str) -> str:
        path = self.directory / f"{name}.csv"
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")


@dataclass
class HttpSource:
    """Holt die CSVs von Wahapedia.

    Höflichkeitsregeln nach PLAN.md §1.4: aussagekräftiger User-Agent statt
    Tarnung als Browser, Pause zwischen den Abrufen, Backoff bei Fehlern.
    """

    base_url: str = config.WAHAPEDIA_BASE_URL
    delay_seconds: float = 1.0
    attempts: int = 4
    cache_dir: Path | None = None

    def fetch(self, name: str) -> str:
        import httpx

        if self.cache_dir is not None:
            cached = self.cache_dir / f"{name}.csv"
            if cached.exists():
                return cached.read_text(encoding="utf-8")

        url = f"{self.base_url}/{name}.csv"
        last_error: Exception | None = None
        for attempt in range(self.attempts):
            if attempt:
                time.sleep(2**attempt)
            try:
                response = httpx.get(
                    url,
                    timeout=60.0,
                    follow_redirects=True,
                    headers={"User-Agent": USER_AGENT},
                )
                response.raise_for_status()
            except Exception as exc:  # noqa: BLE001 - Netzwerkfehler sind erwartbar
                last_error = exc
                continue

            text = response.content.decode("utf-8-sig", errors="replace")
            if self.cache_dir is not None:
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                (self.cache_dir / f"{name}.csv").write_text(text, encoding="utf-8")
            time.sleep(self.delay_seconds)
            return text

        raise RuntimeError(f"{url} nicht abrufbar: {last_error}")


@dataclass
class IngestReport:
    counts: dict[str, int]
    notes: list[str]
    last_update: str = ""

    def as_text(self) -> str:
        lines = [f"  {name:34} {count:6}" for name, count in self.counts.items()]
        if self.last_update:
            lines.append(f"  {'Last_update':34} {self.last_update}")
        lines.extend(f"  ! {note}" for note in self.notes)
        return "\n".join(lines)


def ingest(source: SourceAdapter, session: Session) -> IngestReport:
    """Lädt alle Exportdateien in die Silver-Schicht.

    Vollständiges Neuladen statt Delta: Der ganze Export ist wenige MB groß,
    und ein reproduzierbarer Stand ist mehr wert als eine gesparte Sekunde.
    """
    counts: dict[str, int] = {}
    notes: list[str] = []

    for filename, model in FILES:
        text = source.fetch(filename)
        if not text.strip():
            notes.append(f"{filename}: leer oder nicht verfügbar")
            counts[filename] = 0
            continue

        rows, report = csvreader.parse(text)
        if report.rejoined:
            notes.append(
                f"{filename}: {report.rejoined} Datensatz/Datensätze über "
                "Zeilengrenzen zusammengesetzt"
            )
        if report.overlong:
            notes.append(
                f"{filename}: {len(report.overlong)} Datensätze mit zu vielen "
                "Feldern (Trennzeichen im Text?)"
            )

        session.execute(delete(model))
        session.bulk_save_objects(list(_to_objects(model, rows)))
        counts[filename] = len(rows)

    last_update = ""
    update_rows, _ = csvreader.parse(source.fetch("Last_update"))
    if update_rows:
        last_update = update_rows[0].get("last_update", "")

    _set_meta(session, "last_update", last_update)
    _set_meta(session, "ingested_at", datetime.now(timezone.utc).isoformat())
    _set_meta(session, "ruleset_version", config.RULESET_VERSION)
    session.flush()

    return IngestReport(counts=counts, notes=notes, last_update=last_update)


def _to_objects(model: type, rows: Iterable[dict[str, str]]):
    columns = {c.name for c in model.__table__.columns}
    seen: set[tuple] = set()
    primary = [c.name for c in model.__table__.primary_key.columns]
    autoincrement = len(primary) == 1 and primary[0] not in columns - {"id"} and (
        primary[0] == "id" and model.__table__.c["id"].autoincrement is True
    )

    for row in rows:
        data = {key: (value or "") for key, value in row.items() if key in columns}
        if not data:
            continue
        if not autoincrement and primary:
            key = tuple(data.get(name, "") for name in primary)
            if key in seen:
                # Doppelte Primärschlüssel kommen im Export vereinzelt vor;
                # der erste Treffer gewinnt, statt den Import zu sprengen.
                continue
            seen.add(key)
        yield model(**data)


def _set_meta(session: Session, key: str, value: str) -> None:
    existing = session.get(models.Meta, key)
    if existing is None:
        session.add(models.Meta(key=key, value=value))
    else:
        existing.value = value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Lädt den Wahapedia-Export in die lokale Regel-Datenbank."
    )
    parser.add_argument(
        "--from-dir",
        type=Path,
        help="CSVs aus einem lokalen Verzeichnis statt über das Netz laden.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=config.DATA_DIR / "wahapedia",
        help="Ablage für heruntergeladene CSVs (Default: data/wahapedia).",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Cache ignorieren und neu herunterladen.",
    )
    args = parser.parse_args(argv)

    if args.from_dir:
        source: SourceAdapter = LocalDirSource(args.from_dir)
        print(f"Quelle: {args.from_dir}")
    else:
        cache = None if args.refresh else args.cache_dir
        source = HttpSource(cache_dir=cache)
        print(f"Quelle: {config.WAHAPEDIA_BASE_URL}")

    db.create_all()
    with db.session() as session:
        report = ingest(source, session)
        print("Geladen:")
        print(report.as_text())

        from app.etl.cards import build_cards

        built = build_cards(session)
        print(f"  {'datasheet_card (Read-Model)':34} {built:6}")

    print(f"\nDatenbank: {config.database_url()}")
    print(config.ATTRIBUTION.text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
