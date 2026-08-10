"""Die Liste als explizites Dokument plus Reducer — PLAN.md §6.5.

Jede Änderung läuft als benannte Aktion durch :func:`apply`. Daraus folgt
dreierlei fast geschenkt: Undo/Redo *ist* die Aktionshistorie, ein
Generator-Vorschlag ist eine Liste von Aktionen, und derselbe Reducer läuft
serverseitig — Builder und Generator können die Liste gar nicht
unterschiedlich interpretieren.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field, replace
from typing import Any

from app import config
from app.rules import ruleset


class ActionError(ValueError):
    """Die Aktion ist strukturell unmöglich (unbekannte uid, falscher Typ)."""


@dataclass(frozen=True)
class Entry:
    uid: str
    datasheet_id: str
    model_count: int = 1
    wargear: tuple[str, ...] = ()
    enhancement_id: str | None = None
    attached_to_uid: str | None = None
    transported_in_uid: str | None = None
    is_warlord: bool = False


@dataclass(frozen=True)
class BuilderList:
    faction_id: str = ""
    detachment_id: str = ""
    points_limit: int = ruleset.DEFAULT_POINTS_LIMIT
    ruleset_version: str = config.RULESET_VERSION
    mfm_version: str = ""
    name: str = "Neue Liste"
    entries: tuple[Entry, ...] = ()

    def entry(self, uid: str) -> Entry:
        for item in self.entries:
            if item.uid == uid:
                return item
        raise ActionError(f"Unbekannte Einheit: {uid}")

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["entries"] = [asdict(e) for e in self.entries]
        for entry in data["entries"]:
            entry["wargear"] = list(entry["wargear"])
        return data

    @staticmethod
    def from_dict(data: dict[str, Any]) -> BuilderList:
        entries = tuple(
            Entry(
                uid=str(item.get("uid") or _new_uid()),
                datasheet_id=str(item.get("datasheet_id", "")),
                model_count=int(item.get("model_count") or 1),
                wargear=tuple(item.get("wargear") or ()),
                enhancement_id=item.get("enhancement_id") or None,
                attached_to_uid=item.get("attached_to_uid") or None,
                transported_in_uid=item.get("transported_in_uid") or None,
                is_warlord=bool(item.get("is_warlord")),
            )
            for item in data.get("entries", [])
        )
        return BuilderList(
            faction_id=str(data.get("faction_id", "")),
            detachment_id=str(data.get("detachment_id", "")),
            points_limit=int(data.get("points_limit") or ruleset.DEFAULT_POINTS_LIMIT),
            ruleset_version=str(data.get("ruleset_version") or config.RULESET_VERSION),
            mfm_version=str(data.get("mfm_version", "")),
            name=str(data.get("name") or "Neue Liste"),
            entries=entries,
        )


# ---------------------------------------------------------------------------
# Reducer
# ---------------------------------------------------------------------------

ACTIONS = (
    "SET_FACTION",
    "SET_DETACHMENT",
    "SET_POINTS_LIMIT",
    "RENAME",
    "ADD_UNIT",
    "REMOVE_UNIT",
    "SET_MODEL_COUNT",
    "ATTACH_LEADER",
    "DETACH_LEADER",
    "SET_ENHANCEMENT",
    "CLEAR_ENHANCEMENT",
    "EMBARK",
    "DISEMBARK",
    "SET_WARLORD",
)


def apply(state: BuilderList, action: dict[str, Any]) -> BuilderList:
    """Wendet eine Aktion an und gibt den neuen Zustand zurück."""
    kind = action.get("type")
    if kind not in ACTIONS:
        raise ActionError(f"Unbekannte Aktion: {kind!r}")
    return _HANDLERS[kind](state, action)


def apply_all(state: BuilderList, actions: list[dict[str, Any]]) -> BuilderList:
    for action in actions:
        state = apply(state, action)
    return state


def _set_faction(state: BuilderList, action: dict) -> BuilderList:
    faction_id = str(action.get("faction_id", ""))
    if faction_id == state.faction_id:
        return state
    # Fraktionswechsel leert die Liste — alles andere hinterlässt Einheiten,
    # die nicht in die Armee gehören.
    return replace(state, faction_id=faction_id, detachment_id="", entries=())


def _set_detachment(state: BuilderList, action: dict) -> BuilderList:
    detachment_id = str(action.get("detachment_id", ""))
    if detachment_id == state.detachment_id:
        return state
    # Enhancements gehören zum Detachment; beim Wechsel werden sie entfernt,
    # damit die Liste nicht still illegal wird.
    entries = tuple(replace(e, enhancement_id=None) for e in state.entries)
    return replace(state, detachment_id=detachment_id, entries=entries)


def _set_points_limit(state: BuilderList, action: dict) -> BuilderList:
    return replace(state, points_limit=int(action.get("points_limit") or 0))


def _rename(state: BuilderList, action: dict) -> BuilderList:
    return replace(state, name=str(action.get("name") or "Neue Liste"))


def _add_unit(state: BuilderList, action: dict) -> BuilderList:
    datasheet_id = str(action.get("datasheet_id", ""))
    if not datasheet_id:
        raise ActionError("ADD_UNIT ohne datasheet_id")
    entry = Entry(
        uid=str(action.get("uid") or _new_uid()),
        datasheet_id=datasheet_id,
        model_count=int(action.get("model_count") or 1),
    )
    return replace(state, entries=state.entries + (entry,))


def _remove_unit(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    state.entry(uid)  # wirft, wenn unbekannt
    remaining = []
    for item in state.entries:
        if item.uid == uid:
            continue
        # Verweise auf die entfernte Einheit auflösen, sonst bleiben
        # verwaiste Anschlüsse zurück.
        if item.attached_to_uid == uid:
            item = replace(item, attached_to_uid=None)
        if item.transported_in_uid == uid:
            item = replace(item, transported_in_uid=None)
        remaining.append(item)
    return replace(state, entries=tuple(remaining))


def _set_model_count(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    raw = action.get("model_count")
    # Kein ``or 1``: Das würde eine explizite 0 stillschweigend in 1 drehen,
    # statt sie als Fehler sichtbar zu machen.
    count = 1 if raw is None else int(raw)
    if count < 1:
        raise ActionError("model_count muss mindestens 1 sein")
    return _map_entry(state, uid, lambda e: replace(e, model_count=count))


def _attach_leader(state: BuilderList, action: dict) -> BuilderList:
    leader_uid = str(action.get("uid", ""))
    target_uid = str(action.get("target_uid", ""))
    leader = state.entry(leader_uid)
    state.entry(target_uid)
    if leader_uid == target_uid:
        raise ActionError("Eine Einheit kann sich nicht an sich selbst anschließen")
    return _map_entry(
        state, leader_uid, lambda e: replace(e, attached_to_uid=target_uid)
    )


def _detach_leader(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    return _map_entry(state, uid, lambda e: replace(e, attached_to_uid=None))


def _set_enhancement(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    enhancement_id = str(action.get("enhancement_id", "")) or None
    return _map_entry(state, uid, lambda e: replace(e, enhancement_id=enhancement_id))


def _clear_enhancement(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    return _map_entry(state, uid, lambda e: replace(e, enhancement_id=None))


def _embark(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    transport_uid = str(action.get("transport_uid", ""))
    state.entry(uid)
    state.entry(transport_uid)
    if uid == transport_uid:
        raise ActionError("Eine Einheit kann nicht in sich selbst einsteigen")
    return _map_entry(
        state, uid, lambda e: replace(e, transported_in_uid=transport_uid)
    )


def _disembark(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    return _map_entry(state, uid, lambda e: replace(e, transported_in_uid=None))


def _set_warlord(state: BuilderList, action: dict) -> BuilderList:
    uid = str(action.get("uid", ""))
    state.entry(uid)
    entries = tuple(replace(e, is_warlord=(e.uid == uid)) for e in state.entries)
    return replace(state, entries=entries)


_HANDLERS = {
    "SET_FACTION": _set_faction,
    "SET_DETACHMENT": _set_detachment,
    "SET_POINTS_LIMIT": _set_points_limit,
    "RENAME": _rename,
    "ADD_UNIT": _add_unit,
    "REMOVE_UNIT": _remove_unit,
    "SET_MODEL_COUNT": _set_model_count,
    "ATTACH_LEADER": _attach_leader,
    "DETACH_LEADER": _detach_leader,
    "SET_ENHANCEMENT": _set_enhancement,
    "CLEAR_ENHANCEMENT": _clear_enhancement,
    "EMBARK": _embark,
    "DISEMBARK": _disembark,
    "SET_WARLORD": _set_warlord,
}


def _map_entry(state: BuilderList, uid: str, fn) -> BuilderList:
    state.entry(uid)
    entries = tuple(fn(e) if e.uid == uid else e for e in state.entries)
    return replace(state, entries=entries)


def _new_uid() -> str:
    return uuid.uuid4().hex[:12]
