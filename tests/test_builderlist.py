"""Reducer — PLAN.md §6.5.

Der Reducer ist rein: Er gibt neue Zustände zurück, statt zu mutieren. Genau
das macht Undo/Redo zur Aktionshistorie und erlaubt, dieselbe Aktionsfolge
serverseitig im Generator abzuspielen.
"""

import pytest

from app.rules.builderlist import ActionError, BuilderList, apply, apply_all


def liste(**kwargs):
    return BuilderList(faction_id="TT", detachment_id="D1", **kwargs)


def test_reducer_mutiert_nicht():
    vorher = liste()
    nachher = apply(vorher, {"type": "ADD_UNIT", "datasheet_id": "DS001"})
    assert vorher.entries == ()
    assert len(nachher.entries) == 1


def test_add_unit_vergibt_uid():
    state = apply(liste(), {"type": "ADD_UNIT", "datasheet_id": "DS001"})
    assert state.entries[0].uid
    assert state.entries[0].datasheet_id == "DS001"


def test_unbekannte_aktion_wirft():
    with pytest.raises(ActionError):
        apply(liste(), {"type": "FLIEG_ZUM_MOND"})


def test_add_unit_ohne_datasheet_wirft():
    with pytest.raises(ActionError):
        apply(liste(), {"type": "ADD_UNIT"})


def test_remove_unit_loest_verweise_auf():
    """Sonst bleiben Anschlüsse zurück, die ins Leere zeigen."""
    state = apply_all(liste(), [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "leader"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "trupp"},
        {"type": "ATTACH_LEADER", "uid": "leader", "target_uid": "trupp"},
        {"type": "REMOVE_UNIT", "uid": "trupp"},
    ])
    assert [e.uid for e in state.entries] == ["leader"]
    assert state.entries[0].attached_to_uid is None


def test_remove_unit_loest_transport_auf():
    state = apply_all(liste(), [
        {"type": "ADD_UNIT", "datasheet_id": "DS003", "uid": "panzer"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "trupp"},
        {"type": "EMBARK", "uid": "trupp", "transport_uid": "panzer"},
        {"type": "REMOVE_UNIT", "uid": "panzer"},
    ])
    assert state.entries[0].transported_in_uid is None


def test_fraktionswechsel_leert_die_liste():
    state = apply_all(liste(), [
        {"type": "ADD_UNIT", "datasheet_id": "DS001"},
        {"type": "SET_FACTION", "faction_id": "XX"},
    ])
    assert state.entries == ()
    assert state.detachment_id == ""


def test_gleiche_fraktion_nochmal_setzen_aendert_nichts():
    state = apply_all(liste(), [
        {"type": "ADD_UNIT", "datasheet_id": "DS001"},
        {"type": "SET_FACTION", "faction_id": "TT"},
    ])
    assert len(state.entries) == 1


def test_detachmentwechsel_entfernt_enhancements():
    """Enhancements gehören zum Detachment — sonst wird die Liste still illegal."""
    state = apply_all(liste(), [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "chef"},
        {"type": "SET_ENHANCEMENT", "uid": "chef", "enhancement_id": "ENH1"},
        {"type": "SET_DETACHMENT", "detachment_id": "D2"},
    ])
    assert state.entries[0].enhancement_id is None


def test_warlord_ist_exklusiv():
    state = apply_all(liste(), [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"},
        {"type": "ADD_UNIT", "datasheet_id": "DS004", "uid": "b"},
        {"type": "SET_WARLORD", "uid": "a"},
        {"type": "SET_WARLORD", "uid": "b"},
    ])
    assert [e.is_warlord for e in state.entries] == [False, True]


def test_selbstanschluss_wirft():
    state = apply(liste(), {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"})
    with pytest.raises(ActionError):
        apply(state, {"type": "ATTACH_LEADER", "uid": "a", "target_uid": "a"})


def test_model_count_unter_eins_wirft():
    state = apply(liste(), {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "a"})
    with pytest.raises(ActionError):
        apply(state, {"type": "SET_MODEL_COUNT", "uid": "a", "model_count": 0})


def test_roundtrip_ueber_dict():
    state = apply_all(liste(), [
        {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "a"},
        {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "b"},
        {"type": "ATTACH_LEADER", "uid": "a", "target_uid": "b"},
        {"type": "SET_WARLORD", "uid": "a"},
    ])
    wieder = BuilderList.from_dict(state.to_dict())
    assert wieder == state
