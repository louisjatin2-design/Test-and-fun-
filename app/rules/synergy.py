"""Regelbasierte Synergie — PLAN.md §4.1.

Der Plan trennt zwei Signalfamilien ausdrücklich (§4): **deduktiv** aus den
Regeldaten und **induktiv** aus Turnierlisten. Sie werden getrennt gerechnet
und erst am Ende gewichtet zusammengeführt — „sonst kann man nie sagen,
*warum* etwas empfohlen wurde".

Hier steht die deduktive Hälfte. Sie braucht keine Turnierdaten und ist
deshalb schon jetzt vollständig baubar. Die induktive Hälfte (§4.2: Lift,
erfolgsbedingter Lift, Interaktionskoeffizient) braucht Listen aus Turnieren
und steht weiterhin aus; :data:`MISSING` benennt sie.

**Das Verfahren ist Angebot und Nachfrage.** Jede Einheit bekommt zwei
Listen: was sie *anbietet* (``provides``) und was ihr *fehlt* (``requires``).
Eine Synergie ist ein Treffer zwischen beidem — kein Ähnlichkeitsmaß, keine
Punktzahl aus dem Nichts, sondern ein benennbarer Grund.

**Herkunft, wie überall in diesem Projekt.** Zwei der Angebote stehen
wörtlich in den Exportdaten und sind damit ``DATA``: der Leader-Anschluss
(``Datasheets_leader``) und die Transportkapazität. Alles andere wird aus
Fließtext oder Profilwerten abgeleitet und ist ``ASSUMPTION`` — eine
Formulierung, die die Regex nicht kennt, fehlt schlicht. Das UI zeigt die
Einstufung mit an, damit niemand eine Ableitung für einen Beleg hält.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app import derive
from app.rules import roleprofile
from app.rules.ruleset import Basis, RuleSpec

#: Was diese Hälfte nicht leisten kann.
MISSING: dict[str, str] = {
    "empirisch": (
        "Lift, erfolgsbedingter Lift und Interaktionskoeffizient (§4.2) "
        "brauchen Turnierlisten. Die Ingestion steht aus (Phasen 1–3)."
    ),
    "gewichtung": (
        "Die Zusammenführung beider Signalfamilien (§4.3) setzt voraus, "
        "dass es beide gibt. Bis dahin wird nur die regelbasierte Seite "
        "gezeigt — ungewichtet und einzeln begründet."
    ),
}

SPECS: dict[str, RuleSpec] = {
    "leader_attach": RuleSpec(
        "leader_attach", "Anschluss", "DATA",
        "Datasheets_leader nennt die Paare wörtlich.",
    ),
    "transport": RuleSpec(
        "transport", "Transport", "DATA",
        "Kapazität und zulässige Keywords stehen im Transport-Text des "
        "Datasheets.",
    ),
    "hit_support": RuleSpec(
        "hit_support", "Trefferhilfe", "ASSUMPTION",
        "Aus dem Fähigkeitstext gelesen (Wiederholungswürfe, +1 auf Treffer). "
        "Eine Formulierung, die das Muster nicht kennt, fehlt.",
    ),
    "wound_support": RuleSpec(
        "wound_support", "Verwundungshilfe", "ASSUMPTION",
        "Aus dem Fähigkeitstext gelesen (+1 auf Verwundung, Lethal Hits).",
    ),
    "damage_mitigation": RuleSpec(
        "damage_mitigation", "Schadensabwehr", "ASSUMPTION",
        "Rettungswurf oder Feel No Pain aus dem Fähigkeitstext; der Bedarf "
        "aus Rüstung und Rettungswurf des Profils.",
    ),
    "melee_delivery": RuleSpec(
        "melee_delivery", "Nahkampf-Zustellung", "ASSUMPTION",
        "Bedarf aus Bewegung und dem Verhältnis von Nah- zu Fernkampfschaden; "
        "das Angebot ist die belegte Transportkapazität.",
    ),
}

# ---------------------------------------------------------------------------
# Schwellen für den Bedarf — allesamt gesetzt, allesamt hier
# ---------------------------------------------------------------------------

#: Ab dieser Bewegung gilt eine Nahkampfeinheit nicht mehr als langsam.
SLOW_MOVEMENT = 7
#: Nahkampfschaden muss den Fernkampf um so viel übertreffen.
MELEE_DOMINANCE = 1.5
#: Ab so vielen Attacken lohnt sich Trefferhilfe spürbar.
MANY_ATTACKS = 6
#: Ab so vielen Attacken ist Verwundungshilfe ein eigener Grund.
HIGH_VOLUME = 15
#: Bis zu diesem Trefferwert gilt eine Einheit als treffschwach (4+ und mehr).
POOR_SKILL = 4
#: Ab diesem Rüstungswurf ist eine Einheit ohne Retter verwundbar (4+ und mehr).
FRAGILE_SAVE = 4
#: Erst ab diesen Punkten lohnt es sich, eine Einheit zu schützen.
WORTH_PROTECTING = 100

_CAPACITY_KEYWORDS = re.compile(
    r"transport capacity of \d+\s+(.+?)\s+models", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Effekt-Graph
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Effect:
    """Was eine Einheit anbietet."""

    kind: str
    detail: str
    capacity: int = 0
    keywords: tuple[str, ...] = ()

    @property
    def basis(self) -> Basis:
        spec = SPECS.get(self.kind)
        return spec.basis if spec else "ASSUMPTION"

    def to_dict(self) -> dict:
        return {
            "kind": self.kind, "detail": self.detail, "basis": self.basis,
            "capacity": self.capacity, "keywords": list(self.keywords),
        }


@dataclass(frozen=True)
class Need:
    """Was einer Einheit fehlt."""

    kind: str
    reason: str

    @property
    def basis(self) -> Basis:
        spec = SPECS.get(self.kind)
        return spec.basis if spec else "ASSUMPTION"

    def to_dict(self) -> dict:
        return {"kind": self.kind, "reason": self.reason, "basis": self.basis}


@dataclass(frozen=True)
class UnitEffects:
    datasheet_id: str
    name: str
    faction_id: str
    keywords: frozenset[str]
    model_count: int
    provides: tuple[Effect, ...] = ()
    requires: tuple[Need, ...] = ()

    def to_dict(self) -> dict:
        return {
            "datasheet_id": self.datasheet_id,
            "name": self.name,
            "provides": [e.to_dict() for e in self.provides],
            "requires": [n.to_dict() for n in self.requires],
        }


@dataclass(frozen=True)
class Synergy:
    """Ein Treffer zwischen Angebot und Nachfrage."""

    kind: str
    partner_id: str
    partner_name: str
    direction: str  # "receives" | "provides"
    explanation: str

    @property
    def basis(self) -> Basis:
        spec = SPECS.get(self.kind)
        return spec.basis if spec else "ASSUMPTION"

    def to_dict(self) -> dict:
        spec = SPECS.get(self.kind)
        return {
            "kind": self.kind,
            "title": spec.title if spec else self.kind,
            "basis": self.basis,
            "note": spec.note if spec else "",
            "partner_id": self.partner_id,
            "partner_name": self.partner_name,
            "direction": self.direction,
            "explanation": self.explanation,
        }


# ---------------------------------------------------------------------------
# Ableitung je Einheit
# ---------------------------------------------------------------------------


def effects_for(card: dict) -> UnitEffects:
    """Liest Angebot und Nachfrage aus einer Karte."""
    keywords = frozenset(k.lower() for k in card.get("keywords") or ())
    points = card.get("points") or []
    models = min((int(p.get("models") or 1) for p in points), default=1)

    return UnitEffects(
        datasheet_id=card.get("id", ""),
        name=card.get("name", ""),
        faction_id=card.get("faction_id", ""),
        keywords=keywords,
        model_count=models,
        provides=tuple(_provides(card, keywords)),
        requires=tuple(_requires(card, keywords, models)),
    )


def _provides(card: dict, keywords: frozenset[str]) -> list[Effect]:
    out: list[Effect] = []

    # --- Belegt: Anschluss und Transport
    targets = card.get("can_lead") or []
    if targets:
        out.append(Effect(
            "leader_attach",
            f"Kann sich an {len(targets)} Einheit(en) anschließen.",
        ))

    transport = card.get("transport") or {}
    kapazitaet = int(transport.get("capacity") or card.get("transport_capacity") or 0)
    if kapazitaet > 0:
        erlaubt = _transport_keywords(transport.get("text") or "")
        out.append(Effect(
            "transport",
            f"Transportiert {kapazitaet} Modelle"
            + (f" mit Keyword {', '.join(erlaubt).upper()}" if erlaubt else "")
            + ".",
            capacity=kapazitaet,
            keywords=tuple(erlaubt),
        ))

    # --- Abgeleitet: was der Fähigkeitstext *anderen* hergibt
    #
    # Entscheidend ist das „anderen". Der erste Ansatz zählte jede Fähigkeit
    # mit „Wiederholungswurf" als Angebot — und weil fast jede Einheit
    # irgendeine solche Fähigkeit für sich selbst hat, kamen für einen
    # einzigen Trupp knapp tausend „Synergien" heraus. Eine Einheit, die ihre
    # eigenen Trefferwürfe wiederholt, hilft niemandem sonst.
    #
    # Gezählt wird deshalb nur, was eine Reichweite hat: eine Aura („within
    # 6\"") wirkt über die eigene Einheit hinaus. Das ist eine enge Auslegung,
    # und sie übersieht Fähigkeiten, die anders formuliert sind — eine
    # fehlende Synergie ist aber ungleich weniger schädlich als tausend
    # erfundene.
    tags = _aura_tags(card)
    if {"Reroll Hits", "+1 to Hit"} & tags:
        out.append(Effect("hit_support", _tag_detail(tags, ("Reroll Hits", "+1 to Hit"))))
    if {"+1 to Wound", "Reroll Wounds", "Lethal Hits"} & tags:
        out.append(Effect("wound_support",
                          _tag_detail(tags, ("+1 to Wound", "Reroll Wounds",
                                             "Lethal Hits"))))
    if {"Invulnerable Save", "Feel No Pain"} & tags:
        out.append(Effect("damage_mitigation",
                          _tag_detail(tags, ("Invulnerable Save", "Feel No Pain"))))

    return out


def _requires(card: dict, keywords: frozenset[str], models: int) -> list[Need]:
    out: list[Need] = []
    profile = (card.get("profiles") or [{}])[0] or {}

    # --- Nahkampf-Zustellung: langsam, aber im Nahkampf stark.
    bewegung = roleprofile.stat_int(profile.get("M"), 0)
    nah = _mean_damage(card, "melee")
    fern = _mean_damage(card, "ranged")
    ist_transport = int(card.get("transport_capacity") or 0) > 0
    if (bewegung and bewegung <= SLOW_MOVEMENT
            and nah > 0 and nah > fern * MELEE_DOMINANCE
            and "infantry" in keywords and not ist_transport):
        out.append(Need(
            "melee_delivery",
            f'Kommt nur {bewegung}" weit, richtet den Schaden aber im '
            "Nahkampf an — ohne Transport erreicht sie das Ziel spät.",
        ))

    # --- Trefferhilfe: viele Attacken bei mäßigem Trefferwert.
    attacken, skill = _attack_profile(card)
    if attacken >= MANY_ATTACKS and skill >= POOR_SKILL:
        out.append(Need(
            "hit_support",
            f"Rund {attacken:.0f} Attacken auf {skill}+ — Trefferhilfe "
            "wirkt hier stärker als anderswo.",
        ))
    # Verwundungshilfe lohnt sich überall — als *Bedarf* taugt sie deshalb
    # nur bei wirklich hohem Attackenvolumen. Bei der ersten Schwelle traf
    # sie auf drei Viertel aller Einheiten zu und sagte damit nichts mehr.
    if attacken >= HIGH_VOLUME:
        out.append(Need(
            "wound_support",
            f"Rund {attacken:.0f} Attacken — jede Verwundungshilfe "
            "vervielfacht sich entsprechend.",
        ))

    # --- Schadensabwehr: teuer, schlecht gerüstet, ohne Retter.
    ruestung = roleprofile.stat_int(profile.get("Sv"), 7)
    retter = roleprofile.stat_int(profile.get("inv_sv"), 0)
    kosten = min((int(p.get("cost") or 0) for p in card.get("points") or []
                  if int(p.get("cost") or 0) > 0), default=0)
    if not retter and ruestung >= FRAGILE_SAVE and kosten >= WORTH_PROTECTING:
        out.append(Need(
            "damage_mitigation",
            f"{ruestung}+ Rüstung, kein Rettungswurf, {kosten} Punkte — "
            "was hier durchkommt, ist teuer.",
        ))

    return out


def _transport_keywords(text: str) -> list[str]:
    match = _CAPACITY_KEYWORDS.search(derive.strip_html(text or ""))
    if not match:
        return []
    # "6 Adeptus Custodes Infantry models" -> das letzte Wort ist das
    # entscheidende Keyword, davor steht meist die Fraktion.
    worte = match.group(1).split()
    return [worte[-1].lower()] if worte else []


def _aura_tags(card: dict) -> set[str]:
    """Effekt-Tags nur aus Fähigkeiten, die eine Reichweite haben.

    ``derive.effect_tags`` hängt an eine Fähigkeit mit „within 6\"" ein Tag
    ``Aura 6"`` an. Genau das ist hier das Sieb.
    """
    tags: set[str] = set()
    for ability in card.get("abilities") or ():
        eigene = set(ability.get("tags") or ())
        if text := ability.get("description"):
            eigene |= set(derive.effect_tags(text))
        if any(t.startswith("Aura") for t in eigene):
            tags |= eigene
    return tags


def _tag_detail(tags: set[str], gesucht: tuple[str, ...]) -> str:
    treffer = [t for t in gesucht if t in tags]
    return "Gewährt: " + ", ".join(treffer) + "."


def _mean_damage(card: dict, gruppe: str) -> float:
    weapons = (card.get("weapons") or {}).get(gruppe) or []
    if not weapons:
        return 0.0
    ziel = roleprofile.TARGETS["anti_elite"]
    werte = [roleprofile.weapon_damage(w, ziel) for w in weapons]
    return sum(werte) / len(werte)


def _attack_profile(card: dict) -> tuple[float, int]:
    """Attacken insgesamt und der schlechteste Trefferwert darunter."""
    weapons = ((card.get("weapons") or {}).get("ranged") or []) \
        + ((card.get("weapons") or {}).get("melee") or [])
    if not weapons:
        return 0.0, 0
    models = min((int(p.get("models") or 1) for p in card.get("points") or []),
                 default=1)
    attacken = max(
        (roleprofile.expected_dice(w.get("A")) for w in weapons), default=0.0)
    skills = [
        roleprofile.stat_int(w.get("BS_WS"), 0) for w in weapons
        if roleprofile.stat_int(w.get("BS_WS"), 0)
    ]
    return attacken * models, max(skills) if skills else 0


# ---------------------------------------------------------------------------
# Angebot trifft Nachfrage
# ---------------------------------------------------------------------------

#: Welcher Bedarf durch welches Angebot gedeckt wird.
#:
#: Meist heißen beide Seiten gleich. Die Ausnahme ist die Zustellung: Der
#: Bedarf einer langsamen Nahkampfeinheit heißt ``melee_delivery``, gedeckt
#: wird er durch die belegte Transportkapazität — das ist genau das Beispiel,
#: mit dem PLAN.md §4.1 das Verfahren erklärt.
NEED_TO_PROVIDE: dict[str, str] = {
    "melee_delivery": "transport",
    "hit_support": "hit_support",
    "wound_support": "wound_support",
    "damage_mitigation": "damage_mitigation",
}


@dataclass
class SynergyIndex:
    """Alle Einheiten einer Fraktion mit ihrem Effekt-Graph."""

    units: dict[str, UnitEffects] = field(default_factory=dict)
    leader_pairs: set[tuple[str, str]] = field(default_factory=set)

    @staticmethod
    def build(cards: list[dict]) -> SynergyIndex:
        index = SynergyIndex()
        for card in cards:
            effects = effects_for(card)
            index.units[effects.datasheet_id] = effects
            for target in card.get("can_lead") or ():
                index.leader_pairs.add((card.get("id", ""), target.get("id", "")))
        return index


def synergies_for(datasheet_id: str, index: SynergyIndex) -> list[Synergy]:
    """Alle Partner einer Einheit, mit Begründung."""
    einheit = index.units.get(datasheet_id)
    if not einheit:
        return []

    out: list[Synergy] = []
    for partner in index.units.values():
        if partner.datasheet_id == datasheet_id:
            continue
        out.extend(_pair(einheit, partner, index))

    # Belegtes zuerst, dann nach Partnername — eine stabile Reihenfolge, damit
    # zwei Aufrufe dasselbe liefern.
    out.sort(key=lambda s: (s.basis != "DATA", s.kind, s.partner_name))
    return out


def _pair(einheit: UnitEffects, partner: UnitEffects,
          index: SynergyIndex) -> list[Synergy]:
    out: list[Synergy] = []

    # --- Anschluss (DATA, beide Richtungen)
    if (partner.datasheet_id, einheit.datasheet_id) in index.leader_pairs:
        out.append(Synergy(
            "leader_attach", partner.datasheet_id, partner.name, "receives",
            f"{partner.name} kann sich anschließen — Datasheets_leader nennt "
            "das Paar.",
        ))
    if (einheit.datasheet_id, partner.datasheet_id) in index.leader_pairs:
        out.append(Synergy(
            "leader_attach", partner.datasheet_id, partner.name, "provides",
            f"Kann sich an {partner.name} anschließen — Datasheets_leader "
            "nennt das Paar.",
        ))

    # --- Angebot trifft Nachfrage, in beide Richtungen
    for bedarfsart, angebotsart in NEED_TO_PROVIDE.items():
        bedarf = next((n for n in einheit.requires if n.kind == bedarfsart), None)
        angebot = next((e for e in partner.provides if e.kind == angebotsart), None)
        if bedarf and angebot and _fits(einheit, angebot):
            out.append(Synergy(
                bedarfsart, partner.datasheet_id, partner.name, "receives",
                f"{partner.name}: {angebot.detail} — {bedarf.reason}",
            ))

        eigenes = next((e for e in einheit.provides if e.kind == angebotsart), None)
        fremder = next((n for n in partner.requires if n.kind == bedarfsart), None)
        if eigenes and fremder and _fits(partner, eigenes):
            out.append(Synergy(
                bedarfsart, partner.datasheet_id, partner.name, "provides",
                f"{partner.name} braucht das: {fremder.reason}",
            ))

    return out


def _fits(empfaenger: UnitEffects, angebot: Effect) -> bool:
    """Harte Zusatzbedingungen — beim Transport zählen Plätze und Keyword.

    Ein Transport mit sechs Plätzen ist für einen Zehnertrupp keine
    Synergie, sondern eine Enttäuschung. Und wenn im Transport-Text ein
    Keyword steht, muss die Einheit es tragen. Beides steht in den Daten;
    hier wird nichts geschätzt.
    """
    if angebot.kind != "transport":
        return True
    if angebot.capacity < empfaenger.model_count:
        return False
    return not angebot.keywords or bool(
        set(angebot.keywords) & empfaenger.keywords)


def as_dict() -> dict:
    """Herkunft und Grenzen für API und UI."""
    return {
        "specs": {
            spec.key: {"title": spec.title, "basis": spec.basis, "note": spec.note}
            for spec in SPECS.values()
        },
        "missing": dict(MISSING),
    }
