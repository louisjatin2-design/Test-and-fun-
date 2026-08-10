"""Der Listen-Generator — PLAN.md §5.

Die Prüfungen zerfallen in drei Gruppen:

1. **Rechnen** — die Würfelmathematik des Rollenprofils gegen von Hand
   nachgerechnete Werte. Sie ist die Grundlage jeder Bewertung; stimmt sie
   nicht, ist alles darüber Zierrat.
2. **Regeln** — was der Generator vorschlägt, muss der Validator annehmen.
   Das ist dieselbe Zusicherung, die §6.7 für den Builder verlangt, und der
   Grund, warum Generator und Builder denselben Reducer benutzen.
3. **Patch** — der Vorschlag wird als Aktionsliste übernommen. Wendet man
   sie auf die Ausgangsliste an, muss exakt das Ergebnis herauskommen, das
   der Generator zurückgemeldet hat. Genau hier steckte ein Fehler: Ohne
   festgeschriebene ``uid`` würfelte der Browser beim Übernehmen neue aus,
   und jede folgende Aktion zeigte ins Leere.
"""

from __future__ import annotations

import pytest

from app import config
from app.rules import generator, roleprofile
from app.rules.builderlist import BuilderList, apply_all
from app.rules.roleprofile import COVERAGE_KEYS, TARGETS
from app.rules.validator import RulesContext, validate


# ---------------------------------------------------------------- Rechnen

@pytest.mark.parametrize("ausdruck, erwartet", [
    ("3", 3.0), ("D6", 3.5), ("D3", 2.0), ("D6+3", 6.5),
    ("2D3", 4.0), ("2D6+1", 8.0), ("D6-1", 2.5),
    ("", 0.0), ("N/A", 0.0), ("-", 0.0), ("Bolter", 0.0),
])
def test_wuerfelausdruecke(ausdruck, erwartet):
    assert roleprofile.expected_dice(ausdruck) == pytest.approx(erwartet)


@pytest.mark.parametrize("wert, erwartet", [
    ("2", 5 / 6), ("3", 4 / 6), ("4", 3 / 6), ("6", 1 / 6),
    # Eine 1 misslingt immer — auch bei einem theoretischen 1+.
    ("1", 5 / 6),
    # Torrent trifft automatisch; der Export schreibt dafür N/A.
    ("N/A", 1.0),
])
def test_trefferchance(wert, erwartet):
    assert roleprofile.hit_chance(wert) == pytest.approx(erwartet)


@pytest.mark.parametrize("staerke, zaehigkeit, erwartet", [
    (8, 4, 5 / 6),   # doppelt oder mehr -> 2+
    (5, 4, 4 / 6),   # größer            -> 3+
    (4, 4, 3 / 6),   # gleich            -> 4+
    (3, 4, 2 / 6),   # kleiner           -> 5+
    (2, 4, 1 / 6),   # halb oder weniger -> 6+
])
def test_verwundungstabelle(staerke, zaehigkeit, erwartet):
    assert roleprofile.wound_chance(staerke, zaehigkeit) == pytest.approx(erwartet)


def test_rettungswurf_nimmt_den_besseren():
    """Rüstung wird von AP verschlechtert, der Retter nicht."""
    # Sv3+ ohne AP: 1/3 kommt durch.
    assert roleprofile.save_fail_chance(3, None, 0) == pytest.approx(1 / 3)
    # Sv3+ mit AP-1 wird zu 4+.
    assert roleprofile.save_fail_chance(3, None, -1) == pytest.approx(1 / 2)
    # Sv2+ mit AP-3 wäre 5+; der Retter 4++ ist besser und greift.
    assert roleprofile.save_fail_chance(2, 4, -3) == pytest.approx(1 / 2)
    # Ohne jede Rettung kommt alles durch.
    assert roleprofile.save_fail_chance(6, None, -4) == pytest.approx(1.0)


def test_schaden_einer_lascannon_gegen_einen_panzer():
    """Von Hand nachgerechnet, Schritt für Schritt.

    1 Attacke · 2/3 Treffer (BS3+) · 2/3 Verwundung (S12 gegen T10 ist 3+,
    nicht 2+ — dafür bräuchte es S20) · 2/3 ungerettet (Sv2+ mit AP-3 wird
    5+) · 4,5 Schaden (D6+1).
    """
    lascannon = {"name": "Lascannon", "range": "48", "A": "1", "BS_WS": "3",
                 "S": "12", "AP": "-3", "D": "D6+1", "description": ""}
    erwartet = 1 * (2 / 3) * (2 / 3) * (2 / 3) * 4.5
    ergebnis = roleprofile.weapon_damage(lascannon, TARGETS["anti_tank"])
    assert ergebnis == pytest.approx(erwartet, rel=1e-6)


def test_ueberschuessiger_schaden_verfaellt():
    """Eine D6-Schaden-Waffe tötet kein ganzes Einwundenmodell mehr als eines.

    Ohne die Deckelung wäre jede schwere Waffe auch die beste Wahl gegen
    Horden — und der Generator baute Panzerabwehr gegen Infanterie.
    """
    schwer = {"A": "1", "BS_WS": "2", "S": "10", "AP": "-2", "D": "D6",
              "description": ""}
    horde = TARGETS["anti_horde"]
    # Ohne Deckelung käme rund 3,5 Schaden heraus, mit Deckelung höchstens 1
    # pro durchgekommener Verwundung.
    assert roleprofile.weapon_damage(schwer, horde) <= 1.0


def test_torrent_trifft_immer_und_hat_keine_kritischen_treffer():
    flamer = {"A": "D6", "BS_WS": "N/A", "S": "4", "AP": "0", "D": "1",
              "description": "torrent"}
    horde = TARGETS["anti_horde"]
    erwartet = 3.5 * 1.0 * (2 / 3) * (2 / 3) * 1
    assert roleprofile.weapon_damage(flamer, horde) == pytest.approx(erwartet)


def test_waffenregeln_werden_aus_dem_fliesstext_gelesen():
    """Der Export legt sie als Text ab, nicht als Feld."""
    regeln = roleprofile.weapon_rules(
        {"description": "anti-infantry 4+, devastating wounds, sustained hits 2, "
                        "twin-linked, torrent, blast"})
    assert regeln.torrent and regeln.twin_linked and regeln.devastating
    assert regeln.blast and regeln.sustained == 2
    assert ("infantry", 4) in regeln.anti


def test_waffenregeln_erhoehen_den_schaden():
    """Jede modellierte Regel muss sich auch auswirken."""
    schlicht = {"A": "4", "BS_WS": "3", "S": "4", "AP": "0", "D": "1",
                "description": ""}
    ziel = TARGETS["anti_horde"]
    basis = roleprofile.weapon_damage(schlicht, ziel)
    for regel in ("twin-linked", "sustained hits 1", "lethal hits",
                  "devastating wounds", "blast"):
        besser = roleprofile.weapon_damage({**schlicht, "description": regel}, ziel)
        assert besser > basis, f"{regel} bleibt wirkungslos"


# ----------------------------------------------------------------- Regeln

def _kontext(session):
    return RulesContext(session, config.RULESET_VERSION)


def test_generierte_liste_ist_legal(session):
    """Die Kernzusicherung: Was der Generator vorschlägt, hält der Validator.

    Generator und Builder teilen sich Reducer und Validator (§6.5). Ein
    Vorschlag, der Regeln bricht, wäre wertlos (§5.1).
    """
    ctx = _kontext(session)
    start = BuilderList(faction_id="TT", points_limit=1000,
                        ruleset_version=config.RULESET_VERSION)
    ergebnis = generator.generate(session, start, ctx, keep_existing=False)

    assert ergebnis.state.entries, "Der Generator hat gar nichts vorgeschlagen"
    assert ergebnis.validation.legal
    assert not [f for f in ergebnis.validation.findings if f.severity == "error"]


def test_generator_haelt_das_punktelimit_ein(session):
    ctx = _kontext(session)
    for limit in (500, 1000, 2000):
        start = BuilderList(faction_id="TT", points_limit=limit,
                            ruleset_version=config.RULESET_VERSION)
        ergebnis = generator.generate(session, start, ctx, keep_existing=False)
        assert ergebnis.validation.points_used <= limit


def test_assistent_laesst_die_bestehende_liste_stehen(session):
    """§5.3 v1: Der Kern ist gesperrt, gefüllt wird nur der Rest."""
    ctx = _kontext(session)
    leer = BuilderList(faction_id="TT", points_limit=1000,
                       ruleset_version=config.RULESET_VERSION)
    vorlage = generator.generate(session, leer, ctx, keep_existing=False)
    kern = BuilderList(
        faction_id="TT", points_limit=1000,
        ruleset_version=config.RULESET_VERSION,
        entries=vorlage.state.entries[:1],
    )

    ergebnis = generator.generate(session, kern, ctx, keep_existing=True)

    vorhanden = {e.uid for e in ergebnis.state.entries}
    assert all(e.uid in vorhanden for e in kern.entries), (
        "Der Assistent hat gesperrte Einträge angefasst")
    assert len(ergebnis.state.entries) >= len(kern.entries)


def test_vollautomatik_beginnt_bei_null(session):
    """§5.3 v2 — und der Patch trägt das Leeren mit."""
    ctx = _kontext(session)
    leer = BuilderList(faction_id="TT", points_limit=1000,
                       ruleset_version=config.RULESET_VERSION)
    bestand = generator.generate(session, leer, ctx, keep_existing=False).state

    neu = generator.generate(session, bestand, ctx, keep_existing=False)

    alte_uids = {e.uid for e in bestand.entries}
    assert not (alte_uids & {e.uid for e in neu.state.entries})
    entfernt = [a for a in neu.patch if a["type"] == "REMOVE_UNIT"]
    assert {a["uid"] for a in entfernt} >= alte_uids, (
        "Der Patch entfernt die alte Liste nicht — Übernehmen würde anhängen")


def test_generator_setzt_einen_warlord(session):
    ctx = _kontext(session)
    start = BuilderList(faction_id="TT", points_limit=1000,
                        ruleset_version=config.RULESET_VERSION)
    ergebnis = generator.generate(session, start, ctx, keep_existing=False)
    assert any(e.is_warlord for e in ergebnis.state.entries)


def test_generator_stapelt_keine_leader_auf_einer_einheit(session):
    """Der Validator lässt das als *Warnung* durch — ein Vorschlag nicht.

    Einzelne Datasheets erlauben mehrere Leader ausdrücklich, deshalb ist es
    im Validator bewusst keine Fehlermeldung. Ein Generator, der sich darauf
    stützt, baut aber zehn Charaktere um denselben Trupp und liefert eine
    Liste mit zehn Warnungen ab.
    """
    ctx = _kontext(session)
    start = BuilderList(faction_id="TT", points_limit=2000,
                        ruleset_version=config.RULESET_VERSION)
    ergebnis = generator.generate(session, start, ctx, keep_existing=False)

    je_ziel: dict[str, int] = {}
    for entry in ergebnis.state.entries:
        if entry.attached_to_uid:
            je_ziel[entry.attached_to_uid] = je_ziel.get(entry.attached_to_uid, 0) + 1
    assert not [uid for uid, n in je_ziel.items() if n > 1]
    assert not [f for f in ergebnis.validation.findings if f.severity == "warning"
                and f.rule == "one_leader_per_unit"]


def test_ohne_fraktion_kein_vorschlag(session):
    ctx = _kontext(session)
    leer = BuilderList(points_limit=1000, ruleset_version=config.RULESET_VERSION)
    ergebnis = generator.generate(session, leer, ctx, keep_existing=False)
    assert not ergebnis.state.entries
    assert ergebnis.gaps


# ------------------------------------------------------------------ Patch

def test_patch_erzeugt_genau_das_gemeldete_ergebnis(session):
    """Der Fehler, der beim Übernehmen zuschlug.

    Der Client wendet nicht die fertige Liste an, sondern den Patch — das
    ist der Preis dafür, dass ein Vorschlag ein Diff mit Übernehmen/
    Verwerfen ist (§6.1) und in *einem* Schritt an Undo hängt. Dann muss
    der Patch die Ausgangsliste aber auch wirklich in das Ergebnis
    überführen: ``ADD_UNIT`` ohne festgeschriebene ``uid`` würfelt beim
    zweiten Anwenden eine neue aus, und ``ATTACH_LEADER`` zeigt ins Leere.
    """
    ctx = _kontext(session)
    for keep in (True, False):
        start = BuilderList(faction_id="TT", points_limit=1000,
                            ruleset_version=config.RULESET_VERSION)
        ergebnis = generator.generate(session, start, ctx, keep_existing=keep)

        nachgespielt = apply_all(start, ergebnis.patch)

        assert [e.uid for e in nachgespielt.entries] == \
               [e.uid for e in ergebnis.state.entries], f"keep_existing={keep}"
        assert nachgespielt.entries == ergebnis.state.entries
        assert validate(nachgespielt, session, ctx).points_used == \
               ergebnis.validation.points_used


def test_patch_bleibt_auch_auf_einer_vorbelegten_liste_treu(session):
    """Derselbe Nachweis, aber mit gesperrtem Kern — der Alltagsfall."""
    ctx = _kontext(session)
    leer = BuilderList(faction_id="TT", points_limit=1000,
                       ruleset_version=config.RULESET_VERSION)
    kern_liste = generator.generate(session, leer, ctx, keep_existing=False).state
    start = BuilderList(faction_id="TT", points_limit=1000,
                        ruleset_version=config.RULESET_VERSION,
                        entries=kern_liste.entries[:2])

    ergebnis = generator.generate(session, start, ctx, keep_existing=True)

    assert apply_all(start, ergebnis.patch).entries == ergebnis.state.entries


# -------------------------------------------------------------- Ehrlichkeit

def test_fehlende_evidenz_wird_benannt(session):
    """§5.5 verlangt Begründungen — auch dafür, was *nicht* begründet ist.

    Ohne Turnierdaten fehlt die halbe Begründungsebene aus dem Plan. Sie
    stillschweigend wegzulassen wäre die schlechteste Variante: Der
    Vorschlag sähe fundierter aus, als er ist.
    """
    ctx = _kontext(session)
    start = BuilderList(faction_id="TT", points_limit=1000,
                        ruleset_version=config.RULESET_VERSION)
    daten = generator.generate(session, start, ctx, keep_existing=False).to_dict()

    assert "Phasen 1–3" in daten["missing_evidence"]["meta"]
    assert set(daten["missing_evidence"]["roles"]) == {
        "screening", "board_control", "secondary_scoring"}
    assert daten["missing_evidence"]["weapon_rules_ignored"]


def test_jeder_pick_traegt_eine_begruendung(session):
    ctx = _kontext(session)
    start = BuilderList(faction_id="TT", points_limit=1000,
                        ruleset_version=config.RULESET_VERSION)
    ergebnis = generator.generate(session, start, ctx, keep_existing=False)
    assert ergebnis.picks
    for pick in ergebnis.picks:
        assert pick.reason.strip(), f"{pick.name} ohne Begründung"


def test_rollenprofil_kennzeichnet_seine_herkunft():
    """Wie in ruleset.py: Niemand soll eine Annahme für belegt halten."""
    assert set(roleprofile.SPECS) >= set(COVERAGE_KEYS)
    for spec in roleprofile.SPECS.values():
        assert spec.basis in {"DATA", "ASSUMPTION"}
        assert spec.note.strip()
    # Die Zielprofile sind gesetzt, nicht gemessen — das muss dranstehen.
    assert roleprofile.SPECS["anti_tank"].basis == "ASSUMPTION"
    # Objective Control steht dagegen wörtlich in den Daten.
    assert roleprofile.SPECS["control"].basis == "DATA"
