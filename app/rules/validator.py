"""Constraint-Validator — PLAN.md §5.1, Phase 4.

Eigenständiger Service ohne UI-Abhängigkeit: Er prüft die im Builder gebaute
Liste genauso wie eine importierte. Harte Regelbrüche sind ``error`` und
blockieren den Export, weiche Hinweise sind ``warning`` und dürfen ignoriert
werden (PLAN.md §6.1 — ein Builder, der bevormundet, wird umgangen).
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.rules import ruleset
from app.rules.builderlist import BuilderList, Entry


@dataclass(frozen=True)
class Finding:
    severity: str  # "error" | "warning"
    rule: str
    message: str
    uid: str | None = None

    @property
    def basis(self) -> str:
        spec = ruleset.SPECS.get(self.rule)
        return spec.basis if spec else "ASSUMPTION"

    def to_dict(self) -> dict:
        spec = ruleset.SPECS.get(self.rule)
        return {
            "severity": self.severity,
            "rule": self.rule,
            "title": spec.title if spec else self.rule,
            "basis": self.basis,
            "note": spec.note if spec else "",
            "message": self.message,
            "uid": self.uid,
        }


@dataclass
class ValidationResult:
    points_used: int = 0
    points_limit: int = 0
    findings: list[Finding] = field(default_factory=list)
    per_entry_points: dict[str, int] = field(default_factory=dict)

    @property
    def legal(self) -> bool:
        return not any(f.severity == "error" for f in self.findings)

    def to_dict(self) -> dict:
        return {
            "legal": self.legal,
            "points_used": self.points_used,
            "points_limit": self.points_limit,
            "points_free": self.points_limit - self.points_used,
            "per_entry_points": self.per_entry_points,
            "findings": [f.to_dict() for f in self.findings],
            "errors": sum(1 for f in self.findings if f.severity == "error"),
            "warnings": sum(1 for f in self.findings if f.severity == "warning"),
        }


@dataclass(frozen=True)
class CardFacts:
    """Was der Validator von einer Karte braucht — als reine Daten."""

    datasheet_id: str
    name: str
    faction_id: str
    role: str
    is_epic_hero: bool
    is_character: bool
    transport_capacity: int
    points: tuple[tuple[int, int], ...]  # (Modellzahl, Kosten)


@dataclass(frozen=True)
class EnhancementFacts:
    id: str
    name: str
    cost: int
    detachment: str
    detachment_id: str


class RulesContext:
    """Alles, was der Validator aus der DB braucht — einmal geladen.

    Der Builder ruft die Validierung nach jeder Änderung auf; ein Kontext,
    der pro Aufruf zwölf Abfragen macht, wäre das Ende des 100-ms-Budgets.

    **Bewusst ohne ORM-Objekte.** Der Kontext wird über Requests hinweg
    gehalten; ORM-Instanzen wären nach dem Commit ihrer Session abgelöst und
    jeder Attributzugriff würde fehlschlagen.
    """

    def __init__(self, session: Session, ruleset_version: str) -> None:
        self.cards: dict[str, CardFacts] = {}
        for card in session.scalars(
            select(models.DatasheetCard).where(
                models.DatasheetCard.ruleset_version == ruleset_version
            )
        ):
            payload = json.loads(card.payload)
            self.cards[card.datasheet_id] = CardFacts(
                datasheet_id=card.datasheet_id,
                name=card.name,
                faction_id=card.faction_id,
                role=card.role,
                is_epic_hero=card.is_epic_hero,
                is_character=card.is_character,
                transport_capacity=card.transport_capacity,
                points=tuple(
                    (int(p["models"]), int(p["cost"]))
                    for p in payload.get("points", [])
                ),
            )

        self.leader_pairs: set[tuple[str, str]] = {
            (pair.leader_id, pair.attached_id)
            for pair in session.scalars(select(models.LeaderAttach))
        }
        self.enhancements: dict[str, EnhancementFacts] = {
            enh.id: EnhancementFacts(
                id=enh.id,
                name=enh.name,
                cost=int(enh.cost) if enh.cost.strip().isdigit() else 0,
                detachment=enh.detachment,
                detachment_id=enh.detachment_id,
            )
            for enh in session.scalars(select(models.Enhancement))
        }
        self.allowed_enhancements: dict[str, set[str]] = defaultdict(set)
        for link in session.scalars(select(models.DatasheetEnhancement)):
            self.allowed_enhancements[link.datasheet_id].add(link.enhancement_id)

    def name(self, datasheet_id: str) -> str:
        card = self.cards.get(datasheet_id)
        return card.name if card else datasheet_id

    def cost_for(self, entry: Entry) -> int:
        """Punkte für die gewählte Modellzahl.

        Gibt es keinen exakten Treffer, gilt die größte Staffel, die nicht
        über der gewählten Modellzahl liegt — und wenn auch die fehlt, die
        kleinste. Ein stiller 0-Wert wäre die schlechteste Variante: Er
        macht jede Liste scheinbar legal.
        """
        card = self.cards.get(entry.datasheet_id)
        options = card.points if card else ()
        if not options:
            return 0
        exact = [cost for models, cost in options if models == entry.model_count]
        if exact:
            return exact[0]
        below = [(m, c) for m, c in options if m <= entry.model_count]
        return max(below, key=lambda o: o[0])[1] if below else options[0][1]


def validate(
    state: BuilderList, session: Session, context: RulesContext | None = None
) -> ValidationResult:
    ctx = context or RulesContext(session, state.ruleset_version)
    result = ValidationResult(points_limit=state.points_limit)

    for entry in state.entries:
        cost = ctx.cost_for(entry)
        # Enhancements kosten extra und zählen aufs Limit.
        if entry.enhancement_id and (
            enhancement := ctx.enhancements.get(entry.enhancement_id)
        ):
            cost += enhancement.cost
        result.per_entry_points[entry.uid] = cost
        result.points_used += cost

    _check_points(state, result)
    _check_faction(state, ctx, result)
    _check_rule_of_three(state, ctx, result)
    _check_epic_heroes(state, ctx, result)
    _check_enhancements(state, ctx, result)
    _check_leaders(state, ctx, result)
    _check_transports(state, ctx, result)
    _check_warlord(state, ctx, result)
    _check_unknown_points(state, ctx, result)

    return result


# ---------------------------------------------------------------------------
# Einzelregeln
# ---------------------------------------------------------------------------


def _check_points(state: BuilderList, result: ValidationResult) -> None:
    if result.points_used > state.points_limit:
        over = result.points_used - state.points_limit
        result.findings.append(
            Finding(
                "error",
                "points_limit",
                f"{over} Punkte über dem Limit "
                f"({result.points_used} von {state.points_limit}).",
            )
        )


def _check_faction(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    if not state.faction_id:
        return
    for entry in state.entries:
        card = ctx.cards.get(entry.datasheet_id)
        if card is None:
            result.findings.append(
                Finding(
                    "error",
                    "faction_match",
                    f"Unbekanntes Datasheet: {entry.datasheet_id}",
                    entry.uid,
                )
            )
        elif card.faction_id != state.faction_id:
            result.findings.append(
                Finding(
                    "error",
                    "faction_match",
                    f"{card.name} gehört zu {card.faction_id}, "
                    f"die Armee zu {state.faction_id}.",
                    entry.uid,
                )
            )


def _check_rule_of_three(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    counts = Counter(entry.datasheet_id for entry in state.entries)
    for datasheet_id, count in counts.items():
        card = ctx.cards.get(datasheet_id)
        if card is None:
            continue
        allowed = ruleset.max_copies(card.role)
        if count > allowed:
            result.findings.append(
                Finding(
                    "error",
                    "rule_of_three",
                    f"{card.name}: {count} Exemplare, erlaubt sind {allowed} "
                    f"(Rolle: {card.role or 'Other'}).",
                )
            )


def _check_epic_heroes(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    counts = Counter(
        entry.datasheet_id
        for entry in state.entries
        if (card := ctx.cards.get(entry.datasheet_id)) and card.is_epic_hero
    )
    for datasheet_id, count in counts.items():
        if count > 1:
            result.findings.append(
                Finding(
                    "error",
                    "epic_hero_unique",
                    f"{ctx.name(datasheet_id)} ist ein Epic Hero und darf nur "
                    f"einmal vorkommen ({count} enthalten).",
                )
            )


def _check_enhancements(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    bearers = [e for e in state.entries if e.enhancement_id]

    if len(bearers) > ruleset.MAX_ENHANCEMENTS:
        result.findings.append(
            Finding(
                "error",
                "enhancement_count",
                f"{len(bearers)} Enhancements vergeben, erlaubt sind "
                f"{ruleset.MAX_ENHANCEMENTS}.",
            )
        )

    used = Counter(e.enhancement_id for e in bearers)
    for enhancement_id, count in used.items():
        if count > 1:
            name = ctx.enhancements[enhancement_id].name if (
                enhancement_id in ctx.enhancements
            ) else enhancement_id
            result.findings.append(
                Finding(
                    "error",
                    "enhancement_count",
                    f"Enhancement '{name}' ist {count}-mal vergeben, "
                    "erlaubt ist einmal.",
                )
            )

    for entry in bearers:
        enhancement = ctx.enhancements.get(entry.enhancement_id or "")
        card = ctx.cards.get(entry.datasheet_id)
        if enhancement is None:
            result.findings.append(
                Finding(
                    "error",
                    "enhancement_allowed",
                    f"Unbekanntes Enhancement: {entry.enhancement_id}",
                    entry.uid,
                )
            )
            continue
        if card is None:
            continue

        if not card.is_character or card.is_epic_hero:
            result.findings.append(
                Finding(
                    "error",
                    "enhancement_bearer",
                    f"{card.name} kann '{enhancement.name}' nicht tragen — "
                    "Enhancements gehen nur an Charaktere ohne Epic Hero.",
                    entry.uid,
                )
            )
        elif entry.enhancement_id not in ctx.allowed_enhancements.get(
            entry.datasheet_id, set()
        ):
            result.findings.append(
                Finding(
                    "error",
                    "enhancement_allowed",
                    f"{card.name} steht nicht auf der Liste zulässiger Träger "
                    f"für '{enhancement.name}'.",
                    entry.uid,
                )
            )

        if state.detachment_id and enhancement.detachment_id != state.detachment_id:
            result.findings.append(
                Finding(
                    "error",
                    "enhancement_detachment",
                    f"'{enhancement.name}' gehört zum Detachment "
                    f"'{enhancement.detachment}', gewählt ist ein anderes.",
                    entry.uid,
                )
            )


def _check_leaders(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    by_target: dict[str, list[Entry]] = defaultdict(list)

    for entry in state.entries:
        if not entry.attached_to_uid:
            continue
        target = next(
            (e for e in state.entries if e.uid == entry.attached_to_uid), None
        )
        if target is None:
            result.findings.append(
                Finding(
                    "error",
                    "leader_attach",
                    "Anschluss verweist auf eine Einheit, die nicht in der "
                    "Liste steht.",
                    entry.uid,
                )
            )
            continue

        by_target[target.uid].append(entry)

        if (entry.datasheet_id, target.datasheet_id) not in ctx.leader_pairs:
            result.findings.append(
                Finding(
                    "error",
                    "leader_attach",
                    f"{ctx.name(entry.datasheet_id)} kann sich nicht an "
                    f"{ctx.name(target.datasheet_id)} anschließen.",
                    entry.uid,
                )
            )

    for target_uid, leaders in by_target.items():
        if len(leaders) > ruleset.MAX_LEADERS_PER_UNIT:
            names = ", ".join(ctx.name(leader.datasheet_id) for leader in leaders)
            result.findings.append(
                Finding(
                    "warning",
                    "one_leader_per_unit",
                    f"{len(leaders)} Leader an derselben Einheit ({names}). "
                    "Einzelne Datasheets erlauben das ausdrücklich — bitte am "
                    "Datasheet prüfen.",
                    target_uid,
                )
            )


def _check_transports(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    load: dict[str, int] = defaultdict(int)
    for entry in state.entries:
        if not entry.transported_in_uid:
            continue
        transport = next(
            (e for e in state.entries if e.uid == entry.transported_in_uid), None
        )
        if transport is None:
            result.findings.append(
                Finding(
                    "error",
                    "transport_capacity",
                    "Einheit sitzt in einem Transport, der nicht in der Liste "
                    "steht.",
                    entry.uid,
                )
            )
            continue
        # Ein angeschlossener Leader fährt mit der Einheit mit.
        load[transport.uid] += entry.model_count

    for transport_uid, models_inside in load.items():
        transport = next(e for e in state.entries if e.uid == transport_uid)
        card = ctx.cards.get(transport.datasheet_id)
        capacity = card.transport_capacity if card else 0
        if capacity == 0:
            result.findings.append(
                Finding(
                    "error",
                    "transport_capacity",
                    f"{ctx.name(transport.datasheet_id)} hat keine erkennbare "
                    "Transportkapazität.",
                    transport_uid,
                )
            )
        elif models_inside > capacity:
            result.findings.append(
                Finding(
                    "error",
                    "transport_capacity",
                    f"{ctx.name(transport.datasheet_id)}: {models_inside} "
                    f"Modelle an Bord, Kapazität {capacity}.",
                    transport_uid,
                )
            )


def _check_warlord(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    if not state.entries:
        return
    warlords = [e for e in state.entries if e.is_warlord]
    if not warlords:
        result.findings.append(
            Finding("warning", "warlord", "Kein Warlord benannt.")
        )
    elif len(warlords) > 1:
        result.findings.append(
            Finding(
                "error",
                "warlord",
                f"{len(warlords)} Warlords benannt, erlaubt ist einer.",
            )
        )
    else:
        card = ctx.cards.get(warlords[0].datasheet_id)
        if card is not None and not card.is_character:
            result.findings.append(
                Finding(
                    "error",
                    "warlord",
                    f"{card.name} ist kein Charakter und kann nicht Warlord "
                    "sein.",
                    warlords[0].uid,
                )
            )


def _check_unknown_points(
    state: BuilderList, ctx: RulesContext, result: ValidationResult
) -> None:
    """Punkte, die die Quelle nicht hergibt, dürfen nicht still 0 sein."""
    for entry in state.entries:
        if result.per_entry_points.get(entry.uid, 0) == 0 and ctx.cards.get(
            entry.datasheet_id
        ):
            result.findings.append(
                Finding(
                    "warning",
                    "points_limit",
                    f"Für {ctx.name(entry.datasheet_id)} liefert der Export "
                    "keine Punktkosten — die Summe ist zu niedrig.",
                    entry.uid,
                )
            )
