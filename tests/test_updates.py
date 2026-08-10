"""Live-Updates: Erkennung, Übernahme und Cache-Invalidierung."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app import live, models
from app.etl.updates import check, refresh, sync_from_db
from app.etl.wahapedia import LocalDirSource


@pytest.fixture(autouse=True)
def _fresh_live_state():
    live.reset_for_tests()
    yield
    live.reset_for_tests()


def set_last_update(csv_dir, value):
    (csv_dir / "Last_update.csv").write_text(
        "﻿last_update|\n" + value + "|\n", encoding="utf-8"
    )


class FlakySource(LocalDirSource):
    """Quelle, die beim Abruf scheitert — der Offline-Fall."""

    def fetch(self, name):
        raise RuntimeError("Netzwerk weg")


# ---------------------------------------------------------------------------
# Erkennung
# ---------------------------------------------------------------------------


def test_unveraenderter_stand_wird_erkannt(session, csv_dir):
    result = check(LocalDirSource(csv_dir), session)
    assert result.current == result.remote == "2026-05-09 23:42:21"
    assert result.changed is False


def test_neuer_stand_wird_erkannt(session, csv_dir):
    set_last_update(csv_dir, "2026-08-01 10:00:00")
    result = check(LocalDirSource(csv_dir), session)
    assert result.changed is True
    assert result.remote == "2026-08-01 10:00:00"


def test_netzwerkfehler_ist_kein_absturz(session, csv_dir):
    """Offline heißt "unbekannt", nicht "geändert"."""
    result = check(FlakySource(csv_dir), session)
    assert result.changed is False
    assert "Netzwerk weg" in result.error
    assert live.snapshot()["error"]
    assert live.snapshot()["checking"] is False


def test_leerer_remote_wert_gilt_nicht_als_aenderung(session, csv_dir):
    (csv_dir / "Last_update.csv").write_text("﻿last_update|\n", encoding="utf-8")
    assert check(LocalDirSource(csv_dir), session).changed is False


# ---------------------------------------------------------------------------
# Übernahme
# ---------------------------------------------------------------------------


def test_ohne_aenderung_wird_nicht_geladen(session, csv_dir):
    before = live.data_version()
    result = refresh(LocalDirSource(csv_dir))
    assert result.applied is False
    assert "unverändert" in result.reason
    assert live.data_version() == before


def test_aenderung_wird_uebernommen_und_erhoeht_den_datenstand(session, csv_dir):
    sync_from_db(session)
    before = live.data_version()

    set_last_update(csv_dir, "2026-08-01 10:00:00")
    result = refresh(LocalDirSource(csv_dir))

    assert result.applied is True
    assert result.cards == 6
    assert result.current == "2026-08-01 10:00:00"
    assert live.data_version() > before
    assert live.snapshot()["last_update"] == "2026-08-01 10:00:00"


def test_force_laedt_auch_ohne_aenderung(session, csv_dir):
    result = refresh(LocalDirSource(csv_dir), force=True)
    assert result.applied is True
    assert "erzwungen" in result.reason


def test_geaenderte_punkte_kommen_wirklich_an(session, csv_dir):
    """Der Sinn der Übung: nach dem Update gelten die neuen Werte."""
    from app.rules.builderlist import BuilderList, apply_all
    from app.rules.validator import validate

    liste = apply_all(
        BuilderList(faction_id="TT", detachment_id="D1"),
        [{"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"}],
    )
    assert validate(liste, session).points_used == 80

    kosten = (csv_dir / "Datasheets_models_cost.csv").read_text(encoding="utf-8")
    (csv_dir / "Datasheets_models_cost.csv").write_text(
        kosten.replace("DS001|1|1 model|80|", "DS001|1|1 model|999|"), encoding="utf-8"
    )
    set_last_update(csv_dir, "2026-08-01 10:00:00")
    refresh(LocalDirSource(csv_dir))

    from app import db

    with db.session() as fresh:
        assert validate(liste, fresh).points_used == 999


def test_fehlgeschlagener_ingest_laesst_den_stand_stehen(session, csv_dir):
    sync_from_db(session)
    before = live.data_version()
    with pytest.raises(RuntimeError):
        refresh(FlakySource(csv_dir), force=True)
    assert live.data_version() == before


# ---------------------------------------------------------------------------
# Erkennung eines Ingests aus einem anderen Prozess
# ---------------------------------------------------------------------------


def test_externer_ingest_wird_bemerkt(session, csv_dir):
    """`python -m app.etl.wahapedia` neben dem laufenden Server."""
    sync_from_db(session)
    before = live.data_version()

    # Ein anderer Prozess schreibt einen neuen ingested_at-Stempel.
    stamp = session.get(models.Meta, "ingested_at")
    stamp.value = "2026-08-09T12:00:00+00:00"
    session.flush()

    assert sync_from_db(session) > before


def test_gleicher_stempel_erhoeht_nichts(session):
    sync_from_db(session)
    version = live.data_version()
    for _ in range(3):
        assert sync_from_db(session) == version


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def test_sse_bemerkt_einen_externen_ingest(session, csv_dir):
    """Der Fall, der den Banner überhaupt erst auslöst.

    Ein Ingest in einem anderen Prozess erhöht keinen Zähler in diesem hier.
    Der Stream muss deshalb selbst in der Datenbank nachsehen — sonst bleibt
    die offene Seite still auf altem Stand.
    """
    import asyncio

    from app.api.main import event_stream, sync_data_version

    async def drive():
        stream = event_stream(_never_disconnected(2), tick=0.01,
                              sync=sync_data_version)
        first = await anext(stream)
        # Nur die Datenbank ändert sich, nichts im Prozesszustand.
        refresh(LocalDirSource(csv_dir), force=True)
        second = await anext(stream)
        await stream.aclose()
        return first, second

    set_last_update(csv_dir, "2026-08-09 15:00:00")
    _, second = asyncio.run(asyncio.wait_for(drive(), timeout=10))
    assert second.startswith("event: ruleset-changed")


def test_status_endpunkt(client):
    data = client.get("/api/updates/status").json()
    assert "data_version" in data
    assert "update_available" in data
    assert data["checking"] is False


def test_meta_liefert_den_datenstand(client):
    data = client.get("/api/meta").json()
    assert data["data_version"] >= 1
    assert "update_interval_hours" in data


def test_kontext_cache_folgt_dem_datenstand(client, session, csv_dir):
    """Der eigentliche Zweck: kein Bedienen alter Karten nach einem Update."""
    liste = {
        "faction_id": "TT", "detachment_id": "D1", "points_limit": 2000,
        "entries": [{"uid": "a", "datasheet_id": "DS001", "model_count": 1}],
    }
    assert client.post("/api/lists/validate", json={"list": liste}).json()[
        "points_used"
    ] == 80

    kosten = (csv_dir / "Datasheets_models_cost.csv").read_text(encoding="utf-8")
    (csv_dir / "Datasheets_models_cost.csv").write_text(
        kosten.replace("DS001|1|1 model|80|", "DS001|1|1 model|123|"), encoding="utf-8"
    )
    set_last_update(csv_dir, "2026-08-01 10:00:00")
    refresh(LocalDirSource(csv_dir))

    assert client.post("/api/lists/validate", json={"list": liste}).json()[
        "points_used"
    ] == 123


def test_karten_endpunkt_folgt_dem_datenstand(client, session, csv_dir):
    assert client.get("/api/datasheets/DS001/card").json()["name"] == "Testkommandant"

    sheets = (csv_dir / "Datasheets.csv").read_text(encoding="utf-8")
    (csv_dir / "Datasheets.csv").write_text(
        sheets.replace("Testkommandant", "Umbenannt"), encoding="utf-8"
    )
    set_last_update(csv_dir, "2026-08-01 10:00:00")
    refresh(LocalDirSource(csv_dir))

    assert client.get("/api/datasheets/DS001/card").json()["name"] == "Umbenannt"


def test_sse_begruesst_mit_dem_aktuellen_stand(session):
    """Der Stream wird direkt getrieben — kein offener Socket im Test."""
    import asyncio

    from app.api.main import event_stream

    async def drive():
        stream = event_stream(
            _never_disconnected(1), tick=0.01, sync=live.data_version
        )
        first = await anext(stream)
        # Datenstand von außen erhöhen, wie es ein Ingest täte.
        live.observe("2026-08-09T13:00:00+00:00", "2026-08-09 13:00:00")
        second = await anext(stream)
        await stream.aclose()
        return first, second

    first, second = asyncio.run(drive())
    assert first.startswith("event: hello")
    assert "data_version" in json.loads(first.split("data: ", 1)[1])
    assert second.startswith("event: ruleset-changed")
    assert json.loads(second.split("data: ", 1)[1])["last_update"] == (
        "2026-08-09 13:00:00"
    )


def test_sse_endet_wenn_der_browser_geht(session):
    """Ohne Abbruch bliebe pro geschlossenem Tab ein Task für immer stehen."""
    import asyncio

    from app.api.main import event_stream

    async def drive():
        stream = event_stream(
            _never_disconnected(0), tick=0.01, sync=live.data_version
        )
        chunks = [chunk async for chunk in stream]
        return chunks

    chunks = asyncio.run(asyncio.wait_for(drive(), timeout=5))
    assert len(chunks) == 1  # nur das hello, dann Schluss


def _never_disconnected(rounds: int):
    """Meldet nach ``rounds`` Abfragen einen getrennten Client."""
    remaining = {"n": rounds}

    async def is_disconnected():
        if remaining["n"] <= 0:
            return True
        remaining["n"] -= 1
        return False

    return is_disconnected


def test_datasheet_card_count_bleibt_stabil(session, csv_dir):
    """Zwei Updates hintereinander dürfen keine Karten verdoppeln."""
    for stand in ("2026-08-01 10:00:00", "2026-08-02 10:00:00"):
        set_last_update(csv_dir, stand)
        refresh(LocalDirSource(csv_dir))

    from app import db

    with db.session() as fresh:
        assert fresh.scalar(
            select(models.Meta).where(models.Meta.key == "last_update")
        ).value == "2026-08-02 10:00:00"
        assert len(fresh.scalars(select(models.DatasheetCard)).all()) == 6


# ---------------------------------------------------------------------------
# HTTP-Quelle
# ---------------------------------------------------------------------------


def test_user_agent_ist_header_tauglich():
    """HTTP-Header müssen ASCII sein.

    Ein Umlaut im User-Agent lässt httpx bei *jedem* Abruf scheitern — der
    komplette Netzpfad wäre tot, ohne dass ein lokaler Test das merkt.
    """
    from app.etl.wahapedia import USER_AGENT

    USER_AGENT.encode("ascii")
    assert "warhammer-meta" in USER_AGENT


def test_http_quelle_setzt_nur_zulaessige_header(monkeypatch):
    """Prüft den echten Header-Bau, ohne ins Netz zu gehen."""
    import httpx

    from app.etl.wahapedia import HttpSource

    gesehen = {}

    class FakeResponse:
        content = "﻿last_update|\n2026-01-01 00:00:00|\n".encode("utf-8-sig")

        def raise_for_status(self):
            return None

    def fake_get(url, **kwargs):
        gesehen.update(kwargs.get("headers") or {})
        # Baut den echten Header-Container — schlägt bei Nicht-ASCII fehl.
        httpx.Headers(kwargs["headers"])
        return FakeResponse()

    monkeypatch.setattr(httpx, "get", fake_get)
    source = HttpSource(delay_seconds=0, cache_dir=None)
    assert "last_update" in source.fetch("Last_update")
    assert gesehen["User-Agent"].isascii()
