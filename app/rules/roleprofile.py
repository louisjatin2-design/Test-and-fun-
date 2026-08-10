"""Rollenprofil einer Einheit — PLAN.md §5.2, der Objective-Layer.

Der Plan verlangt für den Generator einen Rollenvektor und hält ausdrücklich
fest, dass er **aus den Profildaten berechenbar** ist: „erwarteter Schaden
gegen T5/Sv3+ vs. T10/Sv2+/4++ — direkt aus ``Datasheets_wargear``". Genau
das steht hier. Damit hängt der Generator *nicht* an den Turnierdaten aus den
Phasen 1–3: Was ohne sie geht, geht sofort.

**Was hier fehlt, fehlt sichtbar.** Der Plan nennt in §5.2 neun Rollen. Sechs
davon lassen sich aus Profil- und Waffenwerten rechnen. Drei nicht:
Screening, Board Control und Secondary-Scoring hängen davon ab, wie eine
Einheit *gespielt* wird, nicht davon, was auf ihrer Karte steht. Sie werden
deshalb nicht geschätzt, sondern weggelassen und in :data:`MISSING_ROLES`
benannt. Eine erfundene Zahl wäre schlimmer als eine fehlende: Sie ginge in
die Bewertung ein, ohne dass jemand sie prüfen könnte.

Wie in :mod:`app.rules.ruleset` trägt jeder Bestandteil eine Herkunft:

``DATA``       Steht so in den Exportdaten.
``ASSUMPTION`` Modellannahme — Zielprofile, Waffenauswahl, Referenzangriff.
               Falsch heißt hier: eine Zeile in diesem Modul, nicht eine
               Suche durch die Codebasis.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from app.rules.ruleset import Basis

# ---------------------------------------------------------------------------
# Herkunft der Bestandteile
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProfileSpec:
    key: str
    title: str
    basis: Basis
    note: str


SPECS: dict[str, ProfileSpec] = {
    "anti_tank": ProfileSpec(
        "anti_tank", "Anti-Tank", "ASSUMPTION",
        "Erwarteter Schaden pro Runde gegen T10, Sv2+, W12. Zielprofil "
        "gewählt, Waffenwerte aus Datasheets_wargear.",
    ),
    "anti_elite": ProfileSpec(
        "anti_elite", "Anti-Elite", "ASSUMPTION",
        "Erwarteter Schaden gegen T5, Sv2+, 4++, W3.",
    ),
    "anti_horde": ProfileSpec(
        "anti_horde", "Anti-Horde", "ASSUMPTION",
        "Erwarteter Schaden gegen T3, Sv5+, W1 — Überschuss je Modell "
        "verfällt, wie im Spiel.",
    ),
    "durability": ProfileSpec(
        "durability", "Haltbarkeit", "ASSUMPTION",
        "Effektive Lebenspunkte gegen einen Referenzangriff mit S4/AP-1. "
        "Rechnet T, Sv und Retter zusammen.",
    ),
    "control": ProfileSpec(
        "control", "Objective Control", "DATA",
        "Summe der OC-Werte aller Modelle aus Datasheets_models.",
    ),
    "reach": ProfileSpec(
        "reach", "Reichweite", "DATA",
        "Größte Reichweite der Fernkampfwaffen aus Datasheets_wargear.",
    ),
}

#: Rollen aus PLAN.md §5.2, die aus Kartendaten *nicht* ableitbar sind.
MISSING_ROLES: dict[str, str] = {
    "screening": "Hängt von Aufstellung und Spielweise ab, nicht von der Karte.",
    "board_control": "Braucht Bewegungs- und Missionsdaten, nicht im Export.",
    "secondary_scoring": "Ergibt sich aus der Mission, nicht aus dem Datasheet.",
}

#: Waffenregeln, die hier modelliert sind.
MODELLED_WEAPON_RULES = (
    "torrent", "twin-linked", "sustained hits N", "lethal hits",
    "devastating wounds", "anti-<keyword> N+", "blast",
)
#: Waffenregeln, die bewusst nicht modelliert sind — sie hängen an
#: Entfernung oder Spielsituation und wären aus einem statischen Profil
#: geraten, nicht gerechnet.
IGNORED_WEAPON_RULES = ("rapid fire", "melta", "hazardous", "heavy", "indirect fire")


# ---------------------------------------------------------------------------
# Zielprofile (ASSUMPTION)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Target:
    """Ein repräsentatives Ziel, gegen das gerechnet wird."""

    key: str
    name: str
    toughness: int
    save: int
    invulnerable: int | None
    wounds: int
    models: int
    keywords: frozenset[str]


TARGETS: dict[str, Target] = {
    "anti_tank": Target(
        "anti_tank", "Panzer", toughness=10, save=2, invulnerable=None,
        wounds=12, models=1, keywords=frozenset({"vehicle"}),
    ),
    "anti_elite": Target(
        "anti_elite", "Elite", toughness=5, save=2, invulnerable=4,
        wounds=3, models=5, keywords=frozenset({"infantry"}),
    ),
    "anti_horde": Target(
        "anti_horde", "Horde", toughness=3, save=5, invulnerable=None,
        wounds=1, models=10, keywords=frozenset({"infantry"}),
    ),
}

#: Referenzangriff für die Haltbarkeit: ein Bolt Rifle.
REFERENCE_ATTACK_STRENGTH = 4
REFERENCE_ATTACK_AP = -1


# ---------------------------------------------------------------------------
# Würfelmathematik
# ---------------------------------------------------------------------------

_DICE = re.compile(r"^(\d*)d(\d+)$", re.IGNORECASE)
_ANTI = re.compile(r"anti-([a-z ]+?)\s*(\d)\+")
_SUSTAINED = re.compile(r"sustained hits\s*(\d+)")


def expected_dice(expression: str | int | None) -> float:
    """Erwartungswert eines Würfelausdrucks: ``3``, ``D6``, ``2D3+1``.

    Unlesbares ergibt 0.0. Das ist Absicht: Eine Waffe, deren Attacken
    niemand parsen kann, soll den Generator nicht mit einer geratenen Zahl
    in die Irre führen.
    """
    if isinstance(expression, (int, float)):
        return float(expression)
    text = str(expression or "").strip().lower().replace(" ", "")
    if not text or text in {"-", "n/a"}:
        return 0.0

    total = 0.0
    sign = 1
    # "2d3+1" zerfällt in ['2d3', '+', '1']; die Trennzeichen bleiben stehen
    # und bestimmen das Vorzeichen des jeweils folgenden Summanden.
    for part in re.split(r"([+-])", text):
        if part == "+":
            sign = 1
        elif part == "-":
            sign = -1
        elif not part:
            continue
        elif match := _DICE.match(part):
            count = int(match.group(1) or 1)
            sides = int(match.group(2))
            total += sign * count * (sides + 1) / 2
        elif part.isdigit():
            total += sign * int(part)
        else:
            return 0.0
    return max(0.0, total)


def _roll_chance(needed: int) -> float:
    """Wahrscheinlichkeit, ``needed``+ auf W6 zu würfeln.

    Die 1 misslingt immer, die 6 gelingt immer — deshalb die Deckelung.
    """
    return min(5 / 6, max(0.0, (7 - needed) / 6))


def hit_chance(skill: str | None) -> float:
    """``BS``/``WS`` als Trefferchance. ``N/A`` heißt Torrent: trifft immer."""
    text = str(skill or "").strip().rstrip("+")
    if text.lower() in {"n/a", "-", ""}:
        return 1.0
    return _roll_chance(int(text)) if text.isdigit() else 0.0


def wound_chance(strength: float, toughness: int) -> float:
    """Die Verwundungstabelle des Kernregelwerks."""
    if strength <= 0 or toughness <= 0:
        return 0.0
    if strength >= 2 * toughness:
        needed = 2
    elif strength > toughness:
        needed = 3
    elif strength == toughness:
        needed = 4
    elif 2 * strength <= toughness:
        needed = 6
    else:
        needed = 5
    return _roll_chance(needed)


def save_fail_chance(save: int, invulnerable: int | None, armour_penetration: int) -> float:
    """Chance, dass eine Verwundung durchkommt.

    Gerettet wird mit dem besseren aus modifiziertem Rüstungs- und
    unmodifiziertem Rettungswurf.
    """
    modified = save - armour_penetration  # AP ist negativ
    best = min(modified, invulnerable) if invulnerable else modified
    return 1.0 - _roll_chance(best)


# ---------------------------------------------------------------------------
# Waffen
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WeaponRules:
    torrent: bool = False
    twin_linked: bool = False
    sustained: int = 0
    lethal: bool = False
    devastating: bool = False
    blast: bool = False
    anti: tuple[tuple[str, int], ...] = ()


def weapon_rules(weapon: dict) -> WeaponRules:
    """Liest die Waffenregeln aus Beschreibung und Keywords.

    Der Wahapedia-Export legt sie als Fließtext ab („anti-infantry 4+,
    devastating wounds, rapid fire 1"), nicht als Feld.
    """
    text = " ".join([
        str(weapon.get("description") or ""),
        " ".join(str(k) for k in weapon.get("keywords") or ()),
    ]).lower()

    sustained = _SUSTAINED.search(text)
    return WeaponRules(
        torrent="torrent" in text,
        twin_linked="twin-linked" in text,
        sustained=int(sustained.group(1)) if sustained else 0,
        lethal="lethal hits" in text,
        devastating="devastating wounds" in text,
        blast="blast" in text,
        anti=tuple((kw.strip(), int(n)) for kw, n in _ANTI.findall(text)),
    )


def weapon_damage(weapon: dict, target: Target) -> float:
    """Erwarteter Schaden einer Waffe an *einem* Modell gegen ``target``."""
    attacks = expected_dice(weapon.get("A"))
    strength = expected_dice(weapon.get("S"))
    damage = expected_dice(weapon.get("D"))
    if attacks <= 0 or strength <= 0 or damage <= 0:
        return 0.0

    rules = weapon_rules(weapon)
    if rules.blast:
        attacks += target.models // 5

    p_hit = 1.0 if rules.torrent else hit_chance(weapon.get("BS_WS"))
    hits = attacks * p_hit + attacks * (1 / 6) * rules.sustained

    # Kritische Treffer gibt es nur, wo überhaupt gewürfelt wird.
    crit_hits = 0.0 if rules.torrent else attacks * (1 / 6)

    p_wound = wound_chance(strength, target.toughness)
    if rules.twin_linked:
        p_wound = p_wound + (1 - p_wound) * p_wound

    # Anti-X senkt die nötige Verwundung — aber nur gegen passende Ziele.
    crit_wound_chance = 1 / 6
    for keyword, needed in rules.anti:
        if any(keyword.startswith(k) or k.startswith(keyword) for k in target.keywords):
            p_wound = max(p_wound, _roll_chance(needed))
            crit_wound_chance = max(crit_wound_chance, _roll_chance(needed))

    if rules.lethal:
        wounds = crit_hits + (hits - crit_hits) * p_wound
    else:
        wounds = hits * p_wound

    p_fail = save_fail_chance(
        target.save, target.invulnerable, _armour_penetration(weapon.get("AP")))

    # Devastating Wounds gehen als tödliche Verletzungen an der Rettung vorbei.
    if rules.devastating:
        mortal = wounds * crit_wound_chance
        normal = (wounds - mortal) * p_fail
        durchgekommen = mortal + normal
    else:
        durchgekommen = wounds * p_fail

    # Überschüssiger Schaden verfällt am Modell — eine D6-Waffe tötet kein
    # 6er-Pack Einwundenmodelle mit einem Treffer.
    return durchgekommen * min(damage, target.wounds)


# ---------------------------------------------------------------------------
# Einheit
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RoleVector:
    anti_tank: float = 0.0
    anti_elite: float = 0.0
    anti_horde: float = 0.0
    durability: float = 0.0
    control: float = 0.0
    reach: float = 0.0

    def __add__(self, other: RoleVector) -> RoleVector:
        return RoleVector(
            anti_tank=self.anti_tank + other.anti_tank,
            anti_elite=self.anti_elite + other.anti_elite,
            anti_horde=self.anti_horde + other.anti_horde,
            durability=self.durability + other.durability,
            control=self.control + other.control,
            # Reichweite summiert sich nicht — die weiteste zählt.
            reach=max(self.reach, other.reach),
        )

    def to_dict(self) -> dict[str, float]:
        return {
            "anti_tank": round(self.anti_tank, 2),
            "anti_elite": round(self.anti_elite, 2),
            "anti_horde": round(self.anti_horde, 2),
            "durability": round(self.durability, 1),
            "control": round(self.control, 1),
            "reach": round(self.reach, 0),
        }


#: Dimensionen, die der Generator als Abdeckung behandelt (Reichweite nicht:
#: sie ist eine Eigenschaft, kein Vorrat, der sich aufsummiert).
COVERAGE_KEYS = ("anti_tank", "anti_elite", "anti_horde", "durability", "control")


def unit_vector(card: dict, model_count: int) -> RoleVector:
    """Rollenvektor einer Einheit in der gewählten Truppgröße.

    **Zur Waffenauswahl.** Der Export nennt alle Waffenoptionen eines
    Datasheets, aber nirgends, wie viele Modelle welche davon tragen — die
    Spalte gibt es schlicht nicht. Gerechnet wird deshalb mit dem
    *Mittelwert* der gelisteten Profile je Kampfart, multipliziert mit der
    Modellzahl. Das ist eine Annahme, aber die neutralste verfügbare: Das
    Maximum würde jede Einheit mit einer Spezialwaffe überbewerten, das
    Minimum jede mit einer Ersatzwaffe unterbewerten.
    """
    weapons = card.get("weapons") or {}
    ranged = list(weapons.get("ranged") or ())
    melee = list(weapons.get("melee") or ())
    models = max(1, int(model_count or 1))

    values: dict[str, float] = {}
    for key, target in TARGETS.items():
        pro_modell = _mean(weapon_damage(w, target) for w in ranged) \
            + _mean(weapon_damage(w, target) for w in melee)
        values[key] = pro_modell * models

    profile = (card.get("profiles") or [{}])[0]
    toughness = _int(profile.get("T"), 4)
    save = _int(profile.get("Sv"), 7)
    invulnerable = _int(profile.get("inv_sv"), 0) or None
    wounds = _int(profile.get("W"), 1)

    p_wound = wound_chance(REFERENCE_ATTACK_STRENGTH, toughness)
    p_fail = save_fail_chance(save, invulnerable, REFERENCE_ATTACK_AP)
    durchlass = p_wound * p_fail
    durability = (models * wounds / durchlass) if durchlass > 0 else 0.0

    return RoleVector(
        anti_tank=values["anti_tank"],
        anti_elite=values["anti_elite"],
        anti_horde=values["anti_horde"],
        durability=durability,
        control=models * _int(profile.get("OC"), 0),
        reach=max((_int(w.get("range"), 0) for w in ranged), default=0.0),
    )


def _armour_penetration(value) -> int:
    """AP als negative Zahl. Der Export schreibt ``0``, ``-1``, ``-2``.

    Ein positiver Wert wäre ein Rüstungs*bonus* — den gibt es nicht, also
    wird das Vorzeichen erzwungen statt einer kaputten Zahl zu vertrauen.
    """
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    return -int(digits) if digits else 0


def _mean(values: Iterable[float]) -> float:
    items = [v for v in values]
    return sum(items) / len(items) if items else 0.0


def _int(value, default: int = 0) -> int:
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    return int(digits) if digits else default
