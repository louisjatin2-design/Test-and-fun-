"""Engine und Session. SQLite lokal, PostgreSQL bleibt über SQLAlchemy offen."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app import config
from app.models import Base

_engine: Engine | None = None
_Session: sessionmaker[Session] | None = None


def engine() -> Engine:
    global _engine, _Session
    if _engine is None:
        url = config.database_url()
        _engine = create_engine(url, future=True)
        if url.startswith("sqlite"):

            @event.listens_for(_engine, "connect")
            def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover
                cur = dbapi_connection.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.close()

        _Session = sessionmaker(bind=_engine, future=True)
    return _engine


def create_all() -> None:
    Base.metadata.create_all(engine())


@contextmanager
def session() -> Iterator[Session]:
    engine()
    assert _Session is not None
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def reset_for_tests(url: str) -> None:
    """Bindet die Engine auf eine andere URL um (nur für Tests)."""
    global _engine, _Session
    import os

    os.environ["WH_DATABASE_URL"] = url
    _engine = None
    _Session = None
