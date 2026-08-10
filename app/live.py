"""Laufzeitzustand für Live-Updates.

Der Regelstand kann sich zur Laufzeit ändern — Wahapedia veröffentlicht
Dataslates und Errata, und PLAN.md §9 sieht für Phase 0 eine „per Cron
aktuelle" Regel-DB vor. Sobald das passiert, müssen drei Dinge nachziehen:

1. die Caches im Serverprozess (sonst bedient er alte Karten weiter),
2. die offenen Browser (sonst zeigt das Panel Werte von gestern),
3. die Validierung offener Listen (Punkte ändern sich mit dem MFM).

Dieses Modul hält dafür einen **Datenstand-Zähler**. Er wird nach jedem
erfolgreichen Ingest erhöht; alles andere hängt sich daran.

Bewusst ohne asyncio-Primitive: Der Ingest läuft in einem Worker-Thread,
der SSE-Stream in der Event-Loop. Ein schlichter Zähler, den beide lesen,
ist über diese Grenze hinweg korrekt, ohne Locks oder
``run_coroutine_threadsafe``.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

_lock = threading.Lock()

_state: dict[str, object] = {
    # Wird bei jedem erkannten Ingest erhöht. Der Cache-Schlüssel des
    # Regelkontexts hängt daran, der SSE-Stream beobachtet ihn.
    "data_version": 0,
    "db_stamp": "",          # meta.ingested_at des geladenen Standes
    "last_update": "",       # Regelstand laut Quelle
    "remote_last_update": "",  # zuletzt gesehener Stand an der Quelle
    "checked_at": "",        # wann zuletzt nachgesehen wurde
    "applied_at": "",        # wann zuletzt tatsächlich geladen wurde
    "checking": False,
    "error": "",
}

_listeners: list[callable] = []


def snapshot() -> dict:
    with _lock:
        state = dict(_state)
    state["update_available"] = bool(
        state["remote_last_update"]
        and state["remote_last_update"] != state["last_update"]
    )
    return state


def data_version() -> int:
    with _lock:
        return int(_state["data_version"])


def observe(db_stamp: str, last_update: str) -> int:
    """Meldet den in der Datenbank gefundenen Ingest-Zeitstempel.

    Ändert er sich, gilt der Datenstand als neu — **egal ob der Ingest in
    diesem Prozess lief oder über die Kommandozeile**. Die Datenbank ist
    damit die Wahrheit darüber, welche Regeln geladen sind, nicht der
    Prozesszustand. Wer `python -m app.etl.wahapedia` neben dem laufenden
    Server ausführt, bekommt das Update trotzdem mit.
    """
    changed = False
    with _lock:
        if db_stamp and db_stamp != _state["db_stamp"]:
            _state["db_stamp"] = db_stamp
            _state["data_version"] = int(_state["data_version"]) + 1
            _state["applied_at"] = _now()
            changed = True
        if last_update:
            _state["last_update"] = last_update
            if not _state["remote_last_update"]:
                _state["remote_last_update"] = last_update
        version = int(_state["data_version"])

    if changed:
        for listener in list(_listeners):
            try:
                listener()
            except Exception:  # noqa: BLE001 - ein kaputter Listener kippt nichts
                pass
    return version


def mark_checked(remote: str, error: str = "") -> None:
    with _lock:
        _state["checked_at"] = _now()
        _state["error"] = error
        if remote:
            _state["remote_last_update"] = remote


def set_checking(value: bool) -> None:
    with _lock:
        _state["checking"] = value


def on_change(listener) -> None:
    """Registriert einen Rückruf, der nach jedem Ingest feuert."""
    _listeners.append(listener)


def reset_for_tests() -> None:
    with _lock:
        _state.update(
            data_version=0, db_stamp="", last_update="",
            remote_last_update="", checked_at="", applied_at="",
            checking=False, error="",
        )
    _listeners.clear()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
