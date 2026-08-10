"""Die harten Regeln aus PLAN.md §5.1 als Konstanten — an einer Stelle.

**Wichtig zur Herkunft.** Die Wahapedia-CSVs exportieren Datasheets, nicht das
Kernregelwerk. Listenbau-Regeln wie "Rule of Three" stehen dort nirgends und
sind hier als Konstanten hinterlegt. Jede trägt deshalb eine Einstufung:

``DATA``       Direkt aus den Exportdaten belegbar (Leader-Paare, Punkte,
               Enhancement-Zuordnung, Transportkapazität). Kann nicht falsch
               sein, ohne dass die Quelldaten falsch sind.
``ASSUMPTION`` Aus dem Kernregelwerk übernommen und **nicht** durch die Daten
               gedeckt. Wenn Games Workshop das ändert oder die Annahme von
               vornherein danebenlag, ist die Korrektur eine Zeile hier —
               nicht eine Suche durch die Codebasis.

Die Einstufung wird über die API mit ausgeliefert und im UI angezeigt, damit
niemand eine Annahme für eine belegte Regel hält.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Basis = Literal["DATA", "ASSUMPTION"]


@dataclass(frozen=True)
class RuleSpec:
    key: str
    title: str
    basis: Basis
    note: str


#: Höchstzahl gleicher Datasheets in einer Armee.
MAX_SAME_DATASHEET = 3
#: Ausnahme für Battleline und Dedicated Transports.
MAX_SAME_DATASHEET_BATTLELINE = 6
BATTLELINE_ROLES = frozenset({"Battleline", "Dedicated Transports"})

#: Höchstzahl Enhancements je Armee.
MAX_ENHANCEMENTS = 3

#: Übliche Punktelimits.
POINTS_LIMITS = (1000, 1500, 2000)
DEFAULT_POINTS_LIMIT = 2000

#: Höchstzahl Leader, die sich an dieselbe Einheit anschließen.
MAX_LEADERS_PER_UNIT = 1

SPECS: dict[str, RuleSpec] = {
    "points_limit": RuleSpec(
        "points_limit",
        "Punktelimit",
        "DATA",
        "Kosten je Truppgröße aus Datasheets_models_cost.csv.",
    ),
    "faction_match": RuleSpec(
        "faction_match",
        "Fraktionszugehörigkeit",
        "DATA",
        "Datasheets.faction_id.",
    ),
    "leader_attach": RuleSpec(
        "leader_attach",
        "Leader-Anschluss",
        "DATA",
        "Erlaubte Paare vollständig aus Datasheets_leader.csv (1.918 Paare).",
    ),
    "transport_capacity": RuleSpec(
        "transport_capacity",
        "Transportkapazität",
        "DATA",
        "Kapazität aus dem Freitextfeld Datasheets.transport gelesen. "
        "Zusatzklauseln ('kann auch 1 Dreadnought transportieren') werden "
        "nicht ausgewertet und deshalb nicht erzwungen.",
    ),
    "enhancement_allowed": RuleSpec(
        "enhancement_allowed",
        "Enhancement am erlaubten Datasheet",
        "DATA",
        "Zuordnung aus Datasheets_enhancements.csv.",
    ),
    "enhancement_detachment": RuleSpec(
        "enhancement_detachment",
        "Enhancement gehört zum Detachment",
        "DATA",
        "Enhancements.detachment_id gegen das gewählte Detachment.",
    ),
    "rule_of_three": RuleSpec(
        "rule_of_three",
        "Rule of Three",
        "ASSUMPTION",
        f"Höchstens {MAX_SAME_DATASHEET} gleiche Datasheets, "
        f"{MAX_SAME_DATASHEET_BATTLELINE} bei Battleline und Dedicated "
        "Transports. Aus dem Kernregelwerk, nicht aus den Exportdaten — "
        "vor Turniereinsatz gegen die aktuelle Fassung prüfen.",
    ),
    "epic_hero_unique": RuleSpec(
        "epic_hero_unique",
        "Epic Heroes sind einzigartig",
        "ASSUMPTION",
        "Je Epic Hero höchstens ein Exemplar. Das EPIC HERO-Keyword kommt aus "
        "den Daten, die Einzigartigkeit aus dem Kernregelwerk.",
    ),
    "enhancement_count": RuleSpec(
        "enhancement_count",
        "Höchstens drei Enhancements",
        "ASSUMPTION",
        f"Maximal {MAX_ENHANCEMENTS} je Armee, jedes nur einmal. Aus dem "
        "Kernregelwerk.",
    ),
    "enhancement_bearer": RuleSpec(
        "enhancement_bearer",
        "Träger ist Charakter ohne Epic Hero",
        "ASSUMPTION",
        "Keywords stammen aus den Daten, die Trägerbeschränkung aus dem "
        "Kernregelwerk.",
    ),
    "one_leader_per_unit": RuleSpec(
        "one_leader_per_unit",
        "Ein Leader je Einheit",
        "ASSUMPTION",
        f"Höchstens {MAX_LEADERS_PER_UNIT} Leader je Einheit. Einzelne "
        "Datasheets erlauben ausdrücklich einen zweiten Charakter; diese "
        "Ausnahme steht als Freitext in leader_footer und wird nicht "
        "ausgewertet — deshalb Warnung statt Fehler.",
    ),
    "warlord": RuleSpec(
        "warlord",
        "Warlord benannt",
        "ASSUMPTION",
        "Genau ein Charakter ist als Warlord zu benennen.",
    ),
}


def as_dict() -> dict:
    """Die Konstanten für die Browser-Engine.

    `app/static/rules.js` liest sie hierher aus, statt eigene Zahlen zu
    führen. Die Logik gibt es dadurch zweimal (unvermeidbar ohne Server),
    die Zahlen aber weiterhin nur einmal.
    """
    from app import config

    return {
        # Der Regelstand gehört dazu: Die Browser-Engine normalisiert Listen
        # damit, und ohne ihn stünde die Version einmal hier und einmal im
        # Aufrufer.
        "ruleset_version": config.RULESET_VERSION,
        "max_same_datasheet": MAX_SAME_DATASHEET,
        "max_same_datasheet_battleline": MAX_SAME_DATASHEET_BATTLELINE,
        "battleline_roles": sorted(BATTLELINE_ROLES),
        "max_enhancements": MAX_ENHANCEMENTS,
        "max_leaders_per_unit": MAX_LEADERS_PER_UNIT,
        "points_limits": list(POINTS_LIMITS),
        "default_points_limit": DEFAULT_POINTS_LIMIT,
        "specs": {
            spec.key: {
                "title": spec.title,
                "basis": spec.basis,
                "note": spec.note,
            }
            for spec in SPECS.values()
        },
    }


def max_copies(role: str) -> int:
    return (
        MAX_SAME_DATASHEET_BATTLELINE
        if role in BATTLELINE_ROLES
        else MAX_SAME_DATASHEET
    )
