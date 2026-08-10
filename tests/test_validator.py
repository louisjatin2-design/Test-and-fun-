"""Constraint-Validator — jede Regel aus PLAN.md §5.1 einzeln."""

import pytest

from app.rules.builderlist import BuilderList, apply_all
from app.rules.validator import validate


def build(session, *actions, **kwargs):
    state = BuilderList(
        faction_id=kwargs.pop("faction_id", "TT"),
        detachment_id=kwargs.pop("detachment_id", "D1"),
        points_limit=kwargs.pop("points_limit", 2000),
        **kwargs,
    )
    return apply_all(state, list(actions))


def add(datasheet_id, uid, **extra):
    return {"type": "ADD_UNIT", "datasheet_id": datasheet_id, "uid": uid, **extra}


def rules_hit(result, severity=None):
    return {
        f.rule for f in result.findings if severity is None or f.severity == severity
    }


def test_leere_liste_ist_legal(session):
    result = validate(build(session), session)
    assert result.legal
    assert result.points_used == 0


def test_punkte_werden_summiert(session):
    state = build(session, add("DS001", "a"), add("DS003", "b"))
    result = validate(state, session)
    assert result.points_used == 230
    assert result.per_entry_points["a"] == 80
    assert result.legal


def test_truppgroesse_aendert_die_kosten(session):
    state = build(
        session,
        add("DS002", "a"),
        {"type": "SET_MODEL_COUNT", "uid": "a", "model_count": 10},
    )
    assert validate(state, session).points_used == 180


def test_punktelimit_ist_ein_fehler(session):
    state = build(session, add("DS003", "a"), points_limit=100)
    result = validate(state, session)
    assert not result.legal
    assert "points_limit" in rules_hit(result, "error")


def test_fremde_fraktion_ist_ein_fehler(session):
    state = build(session, add("DS900", "a"))
    result = validate(state, session)
    assert "faction_match" in rules_hit(result, "error")


def test_rule_of_three(session):
    state = build(session, *[add("DS005", f"u{i}") for i in range(4)])
    result = validate(state, session)
    assert "rule_of_three" in rules_hit(result, "error")


def test_battleline_darf_sechsmal(session):
    """Battleline hat ein höheres Limit als der Rest."""
    sechs = build(session, *[add("DS002", f"u{i}") for i in range(6)])
    assert "rule_of_three" not in rules_hit(validate(sechs, session))

    sieben = build(session, *[add("DS002", f"u{i}") for i in range(7)])
    assert "rule_of_three" in rules_hit(validate(sieben, session), "error")


def test_epic_hero_nur_einmal(session):
    state = build(session, add("DS004", "a"), add("DS004", "b"))
    result = validate(state, session)
    assert "epic_hero_unique" in rules_hit(result, "error")


def test_leader_anschluss_nur_nach_datenlage(session):
    erlaubt = build(
        session,
        add("DS001", "leader"),
        add("DS002", "trupp"),
        {"type": "ATTACH_LEADER", "uid": "leader", "target_uid": "trupp"},
    )
    assert "leader_attach" not in rules_hit(validate(erlaubt, session))

    verboten = build(
        session,
        add("DS001", "leader"),
        add("DS005", "kanone"),
        {"type": "ATTACH_LEADER", "uid": "leader", "target_uid": "kanone"},
    )
    assert "leader_attach" in rules_hit(validate(verboten, session), "error")


def test_zwei_leader_an_einer_einheit_sind_eine_warnung(session):
    """Manche Datasheets erlauben das ausdrücklich — deshalb kein Fehler."""
    state = build(
        session,
        add("DS001", "l1"),
        add("DS004", "l2"),
        add("DS002", "trupp"),
        {"type": "ATTACH_LEADER", "uid": "l1", "target_uid": "trupp"},
        {"type": "ATTACH_LEADER", "uid": "l2", "target_uid": "trupp"},
    )
    result = validate(state, session)
    assert "one_leader_per_unit" in rules_hit(result, "warning")
    assert "one_leader_per_unit" not in rules_hit(result, "error")


def test_transportkapazitaet(session):
    passt = build(
        session,
        add("DS003", "panzer"),
        add("DS002", "trupp", model_count=5),
        {"type": "EMBARK", "uid": "trupp", "transport_uid": "panzer"},
    )
    assert "transport_capacity" not in rules_hit(validate(passt, session))

    zu_voll = build(
        session,
        add("DS003", "panzer"),
        add("DS002", "trupp", model_count=10),
        {"type": "EMBARK", "uid": "trupp", "transport_uid": "panzer"},
    )
    result = validate(zu_voll, session)
    assert "transport_capacity" in rules_hit(result, "error")


def test_einsteigen_in_nicht_transport(session):
    state = build(
        session,
        add("DS005", "kanone"),
        add("DS002", "trupp"),
        {"type": "EMBARK", "uid": "trupp", "transport_uid": "kanone"},
    )
    assert "transport_capacity" in rules_hit(validate(state, session), "error")


def test_enhancement_am_erlaubten_traeger(session):
    ok = build(
        session,
        add("DS001", "chef"),
        {"type": "SET_ENHANCEMENT", "uid": "chef", "enhancement_id": "ENH1"},
    )
    result = validate(ok, session)
    assert not (rules_hit(result, "error") & {
        "enhancement_allowed", "enhancement_bearer", "enhancement_detachment"
    })


def test_enhancement_nicht_an_epic_hero(session):
    state = build(
        session,
        add("DS004", "held"),
        {"type": "SET_ENHANCEMENT", "uid": "held", "enhancement_id": "ENH1"},
    )
    assert "enhancement_bearer" in rules_hit(validate(state, session), "error")


def test_enhancement_nicht_an_nicht_charakter(session):
    state = build(
        session,
        add("DS005", "kanone"),
        {"type": "SET_ENHANCEMENT", "uid": "kanone", "enhancement_id": "ENH1"},
    )
    assert "enhancement_bearer" in rules_hit(validate(state, session), "error")


def test_enhancement_aus_falschem_detachment(session):
    state = build(
        session,
        add("DS001", "chef"),
        {"type": "SET_ENHANCEMENT", "uid": "chef", "enhancement_id": "ENH3"},
    )
    assert "enhancement_detachment" in rules_hit(validate(state, session), "error")


def test_hoechstens_drei_enhancements(session):
    actions = []
    for i in range(4):
        actions.append(add("DS001", f"c{i}"))
        actions.append(
            {"type": "SET_ENHANCEMENT", "uid": f"c{i}", "enhancement_id": "ENH1"}
        )
    result = validate(build(session, *actions), session)
    assert "enhancement_count" in rules_hit(result, "error")


def test_gleiches_enhancement_nur_einmal(session):
    state = build(
        session,
        add("DS001", "a"),
        add("DS001", "b"),
        {"type": "SET_ENHANCEMENT", "uid": "a", "enhancement_id": "ENH1"},
        {"type": "SET_ENHANCEMENT", "uid": "b", "enhancement_id": "ENH1"},
    )
    assert "enhancement_count" in rules_hit(validate(state, session), "error")


def test_warlord_fehlt_ist_warnung(session):
    result = validate(build(session, add("DS001", "a")), session)
    assert "warlord" in rules_hit(result, "warning")


def test_warlord_gesetzt(session):
    state = build(
        session, add("DS001", "a"), {"type": "SET_WARLORD", "uid": "a"}
    )
    assert "warlord" not in rules_hit(validate(state, session))


def test_warlord_muss_charakter_sein(session):
    state = build(
        session, add("DS005", "a"), {"type": "SET_WARLORD", "uid": "a"}
    )
    assert "warlord" in rules_hit(validate(state, session), "error")


def test_befunde_tragen_ihre_herkunft(session):
    """PLAN.md: belegte Regel oder Annahme — der Unterschied muss sichtbar sein."""
    state = build(session, add("DS900", "a"), *[add("DS005", f"u{i}") for i in range(4)])
    result = validate(state, session)
    by_rule = {f.rule: f.basis for f in result.findings}
    assert by_rule["faction_match"] == "DATA"
    assert by_rule["rule_of_three"] == "ASSUMPTION"


def test_fehlende_punkte_werden_nicht_verschwiegen(session):
    """Eine Einheit ohne Punktkosten darf die Summe nicht still verfälschen."""
    from sqlalchemy import delete

    from app import models
    from app.etl.cards import build_cards

    session.execute(delete(models.Points).where(models.Points.datasheet_id == "DS005"))
    build_cards(session)
    session.flush()

    result = validate(build(session, add("DS005", "a")), session)
    assert "points_limit" in rules_hit(result, "warning")


@pytest.mark.parametrize("uid", ["fehlt", ""])
def test_aktion_auf_unbekannte_uid_wirft(session, uid):
    from app.rules.builderlist import ActionError

    with pytest.raises(ActionError):
        build(session, {"type": "REMOVE_UNIT", "uid": uid})


def test_enhancement_kostet_punkte(session):
    """Ein Enhancement zählt aufs Limit — sonst rechnet der Builder falsch."""
    ohne = build(session, add("DS001", "chef"))
    mit = build(
        session,
        add("DS001", "chef"),
        {"type": "SET_ENHANCEMENT", "uid": "chef", "enhancement_id": "ENH1"},
    )
    assert validate(ohne, session).points_used == 80
    assert validate(mit, session).points_used == 95  # 80 + 15
    assert validate(mit, session).per_entry_points["chef"] == 95


def test_enhancement_kann_das_limit_sprengen(session):
    state = build(
        session,
        add("DS001", "chef"),
        {"type": "SET_ENHANCEMENT", "uid": "chef", "enhancement_id": "ENH1"},
        points_limit=90,
    )
    assert "points_limit" in rules_hit(validate(state, session), "error")
