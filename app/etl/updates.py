"""Prüfen, ob es einen neueren Regelstand gibt — und ihn übernehmen.

``Last_update.csv`` ist eine Datei mit einer einzigen Zeitangabe (rund 30
Bytes). Sie zu holen kostet praktisch nichts, der komplette Export dagegen
rund 30 Sekunden. Die Prüfung fragt deshalb nur diese eine Datei ab und lädt
den Rest ausschließlich, wenn sich der Stand geändert hat.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import db, live, models
from app.etl import csvreader
from app.etl.cards import build_cards
from app.etl.wahapedia import SourceAdapter, ingest


@dataclass
class CheckResult:
    current: str
    remote: str
    changed: bool
    error: str = ""


@dataclass
class RefreshResult:
    applied: bool
    current: str
    remote: str
    data_version: int
    cards: int = 0
    reason: str = ""


def stored_last_update(session: Session) -> str:
    row = session.get(models.Meta, "last_update")
    return row.value if row else ""


def db_stamp(session: Session) -> str:
    """Zeitpunkt des letzten Ingests laut Datenbank."""
    row = session.get(models.Meta, "ingested_at")
    return row.value if row else ""


def sync_from_db(session: Session) -> int:
    """Gleicht den Laufzeitzustand mit der Datenbank ab.

    Wird bei jedem Regelkontext-Aufruf gemacht: ein Primärschlüssel-Lookup
    auf einer Zwei-Zeilen-Tabelle, dafür merkt der Server auch einen Ingest,
    der außerhalb seines Prozesses gelaufen ist.
    """
    return live.observe(db_stamp(session), stored_last_update(session))


def remote_last_update(source: SourceAdapter) -> str:
    rows, _ = csvreader.parse(source.fetch("Last_update"))
    return rows[0].get("last_update", "") if rows else ""


def check(source: SourceAdapter, session: Session) -> CheckResult:
    """Fragt nur ``Last_update.csv`` ab. Netzwerkfehler sind kein Absturz."""
    current = stored_last_update(session)
    live.set_checking(True)
    try:
        remote = remote_last_update(source)
    except Exception as exc:  # noqa: BLE001 - offline ist ein Normalfall
        live.mark_checked("", error=str(exc))
        return CheckResult(current=current, remote="", changed=False, error=str(exc))
    finally:
        live.set_checking(False)

    live.mark_checked(remote)
    return CheckResult(
        current=current,
        remote=remote,
        # Ein leerer Remote-Wert heißt "unbekannt", nicht "geändert".
        changed=bool(remote) and remote != current,
    )


def refresh(source: SourceAdapter, *, force: bool = False) -> RefreshResult:
    """Prüft und lädt bei Bedarf neu.

    Ingest und Kartenbau laufen in **einer** Transaktion. Sonst sähen
    parallele Leser einen Zwischenstand, in dem die Silver-Tabellen schon
    neu sind, die Karten aber noch alt — also Regeln aus zwei Ständen.
    """
    with db.session() as session:
        result = check(source, session)

    if not force and not result.changed:
        reason = (
            f"Prüfung fehlgeschlagen: {result.error}" if result.error
            else "Regelstand unverändert"
        )
        return RefreshResult(
            applied=False,
            current=result.current,
            remote=result.remote,
            data_version=live.data_version(),
            reason=reason,
        )

    with db.session() as session:
        report = ingest(source, session)
        cards = build_cards(session)

    with db.session() as session:
        version = sync_from_db(session)
    return RefreshResult(
        applied=True,
        current=report.last_update,
        remote=report.last_update,
        data_version=version,
        cards=cards,
        reason="Neuer Regelstand geladen" if not force else "Neuladen erzwungen",
    )


def load_current_state() -> None:
    """Beim Start den gespeicherten Regelstand in den Laufzeitzustand holen."""
    try:
        with db.session() as session:
            if session.scalar(select(models.Meta).limit(1)) is not None:
                sync_from_db(session)
    except Exception:  # noqa: BLE001 - ohne DB startet die App trotzdem
        pass
