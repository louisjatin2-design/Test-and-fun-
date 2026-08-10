"""Der Listen-Generator — PLAN.md §5.

Zwei Betriebsarten hinter einem Aufruf, genau wie in §5.3 beschrieben:

``assist``   Der Nutzer bringt eine Liste mit; gesperrte Einträge bleiben
             unangetastet, optimiert wird nur der Rest ("fülle mir die
             letzten 240 Punkte"). Das ist der Alltagsfall.
``auto``     Leere Startliste, alles wird gesetzt.

Es ist derselbe Code: ``auto`` ist ``assist`` mit leerem Kern.

**Der Generator hat keine eigene Regelmeinung.** Jeder Zwischenstand läuft
durch denselben Reducer (:mod:`app.rules.builderlist`) und denselben
Validator (:mod:`app.rules.validator`) wie der Builder. Ein Vorschlag, den
der Validator ablehnt, wird gar nicht erst vorgeschlagen — PLAN.md §6.5
verlangt genau das, damit Builder und Generator die Liste nicht
unterschiedlich lesen können.

**Was er nicht kann, sagt er.** §5.4 sieht Archetyp-Seeding aus echten
Turnierlisten und einen Meta-Prior je Einheit vor. Beides braucht die
Turnierauswertung aus den Phasen 1–3, die noch aussteht. Der Generator läuft
deshalb allein auf dem Objective-Layer, der sich aus Regeldaten rechnen
lässt: der Rollenabdeckung aus §5.2. Jedes Ergebnis führt in
``missing_evidence`` mit, welche Begründungsebene aus §5.5 fehlt — statt sie
mit erfundenen Prozentzahlen zu füllen.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.rules import roleprofile, ruleset
from app.rules.builderlist import BuilderList, apply_all
from app.rules.roleprofile import COVERAGE_KEYS, RoleVector
from app.rules.validator import RulesContext, ValidationResult, validate

# ---------------------------------------------------------------------------
# Stellschrauben — allesamt ASSUMPTION, allesamt hier und nirgends sonst
# ---------------------------------------------------------------------------

#: Gewicht der Rollen in der Zielfunktion. Summe 1.0.
WEIGHTS: dict[str, float] = {
    "anti_tank": 0.24,
    "anti_elite": 0.20,
    "anti_horde": 0.18,
    "durability": 0.20,
    "control": 0.18,
}

#: Zielhöhe je Rolle, als Vielfaches von „Budget mal *mediane* Effizienz der
#: Fraktion". Die Meßlatte kommt damit aus den Daten der Fraktion selbst und
#: nicht aus einer absoluten Zahl, die für Custodes und Guardsmen
#: gleichermaßen falsch wäre.
#:
#: **Wie diese Zahlen entstanden sind.** Nicht geraten, sondern gemessen:
#: Über neun Fraktionen wurde je eine 2000-Punkte-Liste erzeugt und
#: nachgerechnet, welches Vielfache des Ziels sie tatsächlich erreicht. Beim
#: ersten Ansatz waren es 5–9× — die Ziele waren so leicht, dass jede Rolle
#: nach einem Drittel des Budgets gesättigt war und die Zielfunktion für den
#: Rest der Liste nichts mehr unterschied. Die Werte hier sind so gesetzt,
#: dass eine volle Liste knapp über 1,0 landet: Lücken zählen dann über das
#: ganze Budget hinweg, nicht nur am Anfang.
#:
#: Das Verfahren ist wiederholbar — wer Gewichte oder Zielprofile ändert,
#: misst neu, statt hier zu raten.
SHARES: dict[str, float] = {
    "anti_tank": 2.00,
    "anti_elite": 2.00,
    "anti_horde": 2.20,
    "durability": 0.80,
    "control": 2.60,
}

#: Gewicht des ausgegebenen Budgets. Ohne diesen Term hört der Generator
#: auf, sobald jede Rolle gesättigt ist — und lässt 400 Punkte liegen.
SPEND_WEIGHT = 0.45

#: Anrechnung für Rollenleistung *über* dem Ziel.
#:
#: Eine harte Deckelung bei 100 % erzeugt Ausgewogenheit, aber sie macht den
#: Generator ab dem Moment blind, in dem alle Rollen erfüllt sind: Jede
#: weitere Einheit ist dann gleich gut, und übrig bleibt das billigste
#: Restbudget-Füllsel. Genau die „legalen, aber unsinnigen Listen" aus §5.4.
#: Mit einer Restanrechnung bleibt die Lücke der klar bessere Griff (Faktor
#: 1,0 gegen 0,15), aber unter gleich gesättigten Kandidaten gewinnt der
#: wirksamere statt des zufälligen.
OVERSHOOT_CREDIT = 0.15

#: Zuschlag, wenn ein Kandidat ein Leader-Paar mit der Liste bildet.
#:
#: Das ist der einzige Objective-Term mit Herkunft ``DATA``: Ob sich ein
#: Charakter anschließen darf, steht in ``Datasheets_leader``. Ohne ihn
#: stellt der Generator Charaktere neben Einheiten, die sie führen könnten —
#: der häufigste stille Fehler beim Listenbau, und §5.5 verlangt genau diese
#: Begründungsart („Warum diese Kombination?").
LEADER_BONUS = 0.05

#: Abschlag für einen Charakter, der führen *könnte*, aber niemanden findet.
#:
#: Das Gegenstück zum Leader-Bonus. Ohne ihn füllt der Generator das
#: Restbudget mit einzelnen Charakteren: Sie sind billig, bringen OC und
#: Haltbarkeit mit und niemand hält sie auf. Eine Armee aus zwölf einzeln
#: herumstehenden Charakteren ist aber keine Armee. Der Abschlag greift
#: bewusst nur, wenn ``Datasheets_leader`` den Kandidaten überhaupt als
#: Leader kennt — Charaktere, die nie einen Trupp führen, sind allein
#: aufgestellt völlig normal und werden nicht bestraft.
LONE_CHARACTER_PENALTY = 0.6

#: Höchstanteil Charaktere an den Einträgen der Liste.
#:
#: Der Abschlag oben stellt Charaktere hintan, aber er verhindert sie nicht:
#: In Fraktionen wie den Necrons sind Charaktere schlicht punkteffizient —
#: zäh, mit ordentlichen Waffen, und sie kosten wenig. Die Gier-Suche kauft
#: dann zwölf davon, weil jeder einzelne Griff für sich richtig gerechnet
#: ist. Was fehlt, ist keine feinere Gewichtung, sondern die Einsicht, dass
#: eine Armee Truppen braucht. Genau die steht hier: ein struktureller
#: Deckel, keine weitere Stellschraube.
MAX_CHARACTER_SHARE = 0.4

#: Abschlag je weiterer Kopie desselben Datasheets.
#:
#: Die Rule of Three erlaubt drei — dreimal dasselbe ist trotzdem selten
#: eine gute Liste, und §5.4 nennt Diversifizierung ausdrücklich als Ziel.
DUPLICATE_PENALTY = 0.35

#: So viele Punkte werden für Enhancements zurückgehalten, solange ein
#: legaler Träger und ein Detachment da sind.
ENHANCEMENT_RESERVE = 45

#: So viele Kandidaten werden je Runde durch den Validator geschickt. Der
#: Rest der Rangliste ist billiger Rechenaufwand, nicht teurer.
VALIDATE_TOP_K = 14

#: Obergrenze für Tauschversuche der lokalen Suche (§5.4, Schritt 3).
LOCAL_SEARCH_ROUNDS = 2

SPECS: dict[str, ruleset.RuleSpec] = {
    "objective": ruleset.RuleSpec(
        "objective", "Zielfunktion", "ASSUMPTION",
        "Gewichte und Zielanteile je Rolle sind gesetzt, nicht belegt. "
        "Ohne Turnierdaten gibt es nichts, woran man sie eichen könnte.",
    ),
    "no_meta_prior": ruleset.RuleSpec(
        "no_meta_prior", "Kein Meta-Prior", "ASSUMPTION",
        "PLAN.md §5.2 sieht eine Gewichtung nach Turniererfolg vor. Die "
        "Turnierauswertung (Phasen 1–3) steht aus; der Vorschlag beruht "
        "allein auf Regel- und Profildaten.",
    ),
}


# ---------------------------------------------------------------------------
# Datenklassen
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    """Eine Einheit in einer bestimmten Truppgröße."""

    datasheet_id: str
    name: str
    role: str
    model_count: int
    cost: int
    vector: RoleVector


@dataclass
class Pick:
    """Eine Entscheidung des Generators samt Begründung (§5.5)."""

    datasheet_id: str
    name: str
    cost: int
    model_count: int
    reason: str
    closes: str | None = None
    coverage_before: float = 0.0
    coverage_after: float = 0.0

    def to_dict(self) -> dict:
        return {
            "datasheet_id": self.datasheet_id,
            "name": self.name,
            "cost": self.cost,
            "model_count": self.model_count,
            "reason": self.reason,
            "closes": self.closes,
            "coverage_before": round(self.coverage_before, 3),
            "coverage_after": round(self.coverage_after, 3),
        }


@dataclass
class GenerationResult:
    state: BuilderList
    validation: ValidationResult
    patch: list[dict] = field(default_factory=list)
    picks: list[Pick] = field(default_factory=list)
    coverage: dict[str, float] = field(default_factory=dict)
    targets: dict[str, float] = field(default_factory=dict)
    gaps: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "list": self.state.to_dict(),
            "validation": self.validation.to_dict(),
            "patch": self.patch,
            "picks": [p.to_dict() for p in self.picks],
            "coverage": {k: round(v, 3) for k, v in self.coverage.items()},
            "targets": {k: round(v, 2) for k, v in self.targets.items()},
            "gaps": self.gaps,
            "role_specs": [
                {"key": s.key, "title": s.title, "basis": s.basis, "note": s.note}
                for s in roleprofile.SPECS.values()
            ],
            "missing_evidence": {
                "meta": SPECS["no_meta_prior"].note,
                "roles": roleprofile.MISSING_ROLES,
                "weapon_rules_ignored": list(roleprofile.IGNORED_WEAPON_RULES),
            },
        }


# ---------------------------------------------------------------------------
# Kandidaten
# ---------------------------------------------------------------------------


def as_dict() -> dict:
    """Die Stellschrauben für die Browser-Engine.

    Der Generator läuft in der Offline-Datei ein zweites Mal, in
    JavaScript. Die Suche muss dort noch einmal geschrieben werden — die
    Zahlen nicht.
    """
    return {
        "weights": dict(WEIGHTS),
        "shares": dict(SHARES),
        "spend_weight": SPEND_WEIGHT,
        "overshoot_credit": OVERSHOOT_CREDIT,
        "leader_bonus": LEADER_BONUS,
        "duplicate_penalty": DUPLICATE_PENALTY,
        "lone_character_penalty": LONE_CHARACTER_PENALTY,
        "max_character_share": MAX_CHARACTER_SHARE,
        "enhancement_reserve": ENHANCEMENT_RESERVE,
        "validate_top_k": VALIDATE_TOP_K,
        "local_search_rounds": LOCAL_SEARCH_ROUNDS,
        "specs": {
            spec.key: {"title": spec.title, "basis": spec.basis, "note": spec.note}
            for spec in SPECS.values()
        },
        "roles": roleprofile.as_dict(),
    }


def load_candidates(
    session: Session, faction_id: str, ruleset_version: str
) -> list[Candidate]:
    """Alle Einheiten der Fraktion, je Truppgröße eine eigene Wahl.

    Eine Zehner- und eine Fünferstaffel sind verschiedene Entscheidungen mit
    verschiedenem Preis und verschiedener Wirkung — sie hier
    zusammenzuwerfen hieße, dem Generator die Hälfte der Auswahl zu nehmen.
    """
    query = select(models.DatasheetCard).where(
        models.DatasheetCard.ruleset_version == ruleset_version,
        models.DatasheetCard.faction_id == faction_id,
    )
    candidates: list[Candidate] = []
    for row in session.scalars(query):
        payload = json.loads(row.payload)
        for option in payload.get("points", []):
            cost = int(option.get("cost") or 0)
            model_count = int(option.get("models") or 1)
            if cost <= 0:
                # Ohne Punktekosten ist eine Einheit nicht planbar; der
                # Validator meldet sie ohnehin als unbekannt.
                continue
            candidates.append(Candidate(
                datasheet_id=row.datasheet_id,
                name=row.name,
                role=row.role or "Other",
                model_count=model_count,
                cost=cost,
                vector=roleprofile.unit_vector(payload, model_count),
            ))

    # Feste Reihenfolge, unabhängig davon, wie die Datenbank die Zeilen
    # ausspuckt. Bei gleichem Grenznutzen entscheidet sonst der Zufall,
    # welcher Kandidat gewinnt — zwei Läufe lieferten verschiedene Listen,
    # und die Browser-Engine (die die Karten in anderer Reihenfolge sieht)
    # könnte gar nicht dasselbe Ergebnis liefern.
    candidates.sort(key=lambda c: (c.datasheet_id, c.model_count))
    return candidates


def coverage_targets(
    candidates: list[Candidate], points_limit: int
) -> dict[str, float]:
    """Wie viel von jeder Rolle eine Liste dieser Größe haben sollte.

    Maßstab ist die *mediane Effizienz der Fraktion*: Was bekommt man in
    dieser Fraktion pro Punkt üblicherweise an Anti-Tank? Mal dem Budget mal
    dem Zielanteil ergibt das eine Latte, die für zähe Elitefraktionen
    genauso trägt wie für billige Massenfraktionen. Eine absolute Zahl täte
    das nicht.
    """
    targets: dict[str, float] = {}
    for key in COVERAGE_KEYS:
        effizienz = [
            getattr(c.vector, key) / c.cost for c in candidates if c.cost > 0
        ]
        mittel = median(effizienz) if effizienz else 0.0
        targets[key] = max(1e-6, mittel * points_limit * SHARES[key])
    return targets


# ---------------------------------------------------------------------------
# Zielfunktion
# ---------------------------------------------------------------------------


def _vector_of(state: BuilderList, by_key: dict[tuple[str, int], Candidate]) -> RoleVector:
    total = RoleVector()
    for entry in state.entries:
        candidate = by_key.get((entry.datasheet_id, entry.model_count))
        if candidate:
            total = total + candidate.vector
    return total


def coverage_of(vector: RoleVector, targets: dict[str, float]) -> dict[str, float]:
    """Abdeckung je Rolle, gedeckelt bei 1.0 — für die Anzeige.

    Die Deckelung *ist* die Ausgewogenheit: Ist Anti-Tank erfüllt, bringt
    die vierte Panzerabwehr fast nichts mehr, und der nächste Griff geht
    in eine andere Rolle. Ohne sie baut jede Gier-Suche dieselbe
    einseitige Liste.
    """
    return {
        key: min(1.0, getattr(vector, key) / targets[key])
        for key in COVERAGE_KEYS
    }


def _credited(vector: RoleVector, targets: dict[str, float]) -> float:
    """Gewichtete Rollenleistung für die Zielfunktion.

    Bis zum Ziel zählt jede Einheit voll, darüber nur noch mit
    :data:`OVERSHOOT_CREDIT` — der Knick, der Lücken schließt, ohne den
    Generator nach der Sättigung blind zu machen.
    """
    total = 0.0
    for key in COVERAGE_KEYS:
        anteil = getattr(vector, key) / targets[key]
        total += WEIGHTS[key] * (min(1.0, anteil)
                                 + OVERSHOOT_CREDIT * max(0.0, anteil - 1.0))
    return total


def score(vector: RoleVector, points_used: int, points_limit: int,
          targets: dict[str, float]) -> float:
    budget = min(1.0, points_used / points_limit) if points_limit else 0.0
    return _credited(vector, targets) + SPEND_WEIGHT * budget


# ---------------------------------------------------------------------------
# Erzeugung
# ---------------------------------------------------------------------------


def generate(
    session: Session,
    state: BuilderList,
    context: RulesContext | None = None,
    keep_existing: bool = True,
) -> GenerationResult:
    """Füllt ``state`` bis ans Punktelimit auf.

    ``keep_existing=True`` lässt die vorhandenen Einträge stehen (§5.3 v1,
    Assistent), ``False`` beginnt bei null (v2, Vollautomatik).
    """
    ctx = context or RulesContext(session, state.ruleset_version)

    # Der Patch muss die Liste des Nutzers in das Ergebnis überführen — sonst
    # hängt „Übernehmen" den Vorschlag an die alte Liste an, statt sie zu
    # ersetzen. Im Neubau-Modus gehört das Leeren deshalb in den Patch.
    vorbereitung: list[dict] = []
    if not keep_existing:
        vorbereitung = [
            {"type": "REMOVE_UNIT", "uid": entry.uid} for entry in state.entries
        ]
        state = BuilderList(
            faction_id=state.faction_id,
            detachment_id=state.detachment_id,
            points_limit=state.points_limit,
            ruleset_version=state.ruleset_version,
            mfm_version=state.mfm_version,
            name=state.name,
            entries=(),
        )

    if not state.faction_id:
        return GenerationResult(
            state=state,
            validation=validate(state, session, ctx),
            patch=vorbereitung,
            gaps=["Ohne Fraktion gibt es nichts vorzuschlagen."],
        )

    candidates = load_candidates(session, state.faction_id, state.ruleset_version)
    if not candidates:
        return GenerationResult(
            state=state,
            validation=validate(state, session, ctx),
            patch=vorbereitung,
            gaps=[f"Keine Einheiten mit Punktekosten für {state.faction_id}."],
        )

    by_key = {(c.datasheet_id, c.model_count): c for c in candidates}
    targets = coverage_targets(candidates, state.points_limit)

    patch: list[dict] = list(vorbereitung)
    picks: list[Pick] = []

    reserve = ENHANCEMENT_RESERVE if _enhancement_possible(state, ctx) else 0

    state = _fill(session, ctx, state, candidates, by_key, targets,
                  patch, picks, reserve)
    state = _attach_leaders(session, ctx, state, patch, picks)
    state = _set_warlord(session, ctx, state, patch, picks)
    state = _add_enhancements(session, ctx, state, patch, picks)
    # Was die Rücklage für Enhancements übrig gelassen hat, geht jetzt in
    # Einheiten — ein Vorschlag, der 40 Punkte verschenkt, ist keiner.
    state = _fill(session, ctx, state, candidates, by_key, targets,
                  patch, picks, reserve=0)
    state = _local_search(session, ctx, state, candidates, by_key, targets,
                          patch, picks)

    endstand = validate(state, session, ctx)
    vector = _vector_of(state, by_key)
    abdeckung = coverage_of(vector, targets)

    return GenerationResult(
        state=state,
        validation=endstand,
        patch=patch,
        picks=picks,
        coverage=abdeckung,
        targets=targets,
        gaps=_gaps(abdeckung, endstand, state),
    )


def _fill(session, ctx, state, candidates, by_key, targets, patch, picks, reserve):
    """Gier-Suche: je Runde der beste Zuwachs pro Punkt."""
    limit = state.points_limit
    # Wer laut Datasheets_leader überhaupt jemanden anführen kann.
    leader_ids = {leader for leader, _ in ctx.leader_pairs}
    while True:
        aktuell = validate(state, session, ctx)
        frei = limit - reserve - aktuell.points_used
        if frei <= 0:
            return state

        vector = _vector_of(state, by_key)
        basis = score(vector, aktuell.points_used, limit, targets)
        vorher = coverage_of(vector, targets)

        bereits = _counts(state)
        charaktere = sum(
            1 for e in state.entries
            if (k := ctx.cards.get(e.datasheet_id)) and k.is_character
        )
        # Ein Charakter ist immer erlaubt — ohne Warlord ist keine Liste legal.
        charakter_platz = max(1, int(MAX_CHARACTER_SHARE * len(state.entries)))

        rangliste = []
        for candidate in candidates:
            if candidate.cost > frei:
                continue
            karte = ctx.cards.get(candidate.datasheet_id)
            if karte and karte.is_character and charaktere >= charakter_platz:
                continue
            neu = score(vector + candidate.vector,
                        aktuell.points_used + candidate.cost, limit, targets)
            gewinn = neu - basis
            bonus = _leader_bonus(candidate, state, ctx)
            gewinn += bonus
            if (not bonus and karte and karte.is_character
                    and candidate.datasheet_id in leader_ids):
                gewinn -= LONE_CHARACTER_PENALTY * gewinn
            gewinn -= DUPLICATE_PENALTY * gewinn * bereits.get(candidate.datasheet_id, 0)
            if gewinn <= 0:
                continue
            rangliste.append((gewinn / candidate.cost, candidate))

        if not rangliste:
            return state
        rangliste.sort(key=lambda item: item[0], reverse=True)

        for _, candidate in rangliste[:VALIDATE_TOP_K]:
            aktion = {
                "type": "ADD_UNIT",
                "datasheet_id": candidate.datasheet_id,
                "model_count": candidate.model_count,
            }
            versuch = apply_all(state, [aktion])
            if not validate(versuch, session, ctx).legal:
                continue
            _pin_uid(aktion, state, versuch)

            nachher = coverage_of(vector + candidate.vector, targets)
            luecke = _biggest_gain(vorher, nachher)
            picks.append(Pick(
                datasheet_id=candidate.datasheet_id,
                name=candidate.name,
                cost=candidate.cost,
                model_count=candidate.model_count,
                reason=_reason(candidate, luecke, vorher, nachher),
                closes=luecke,
                coverage_before=vorher.get(luecke, 0.0) if luecke else 0.0,
                coverage_after=nachher.get(luecke, 0.0) if luecke else 0.0,
            ))
            patch.append(aktion)
            state = versuch
            break
        else:
            # Kein Kandidat der Spitzengruppe war legal — die Suche würde
            # sich sonst mit denselben Vorschlägen im Kreis drehen.
            return state


def _pin_uid(aktion: dict, vorher: BuilderList, nachher: BuilderList) -> None:
    """Schreibt die uid fest, die der Reducer gerade vergeben hat.

    Ohne sie ist der Patch nicht wiederholbar: ``ADD_UNIT`` ohne ``uid``
    würfelt beim erneuten Anwenden im Browser eine *neue* aus, und jede
    folgende Aktion — ``ATTACH_LEADER``, ``SET_WARLORD``,
    ``SET_ENHANCEMENT`` — zeigt dann auf einen Eintrag, den es dort nicht
    gibt. Der Vorschlag scheiterte damit genau beim Übernehmen.

    Die uid wird bewusst *abgelesen* statt hier erzeugt: Sie entsteht im
    Reducer, und das soll die einzige Stelle bleiben, die uids vergibt.
    """
    bekannt = {entry.uid for entry in vorher.entries}
    neu = next((e.uid for e in nachher.entries if e.uid not in bekannt), None)
    if neu:
        aktion["uid"] = neu


def _counts(state: BuilderList) -> dict[str, int]:
    zaehler: dict[str, int] = {}
    for entry in state.entries:
        zaehler[entry.datasheet_id] = zaehler.get(entry.datasheet_id, 0) + 1
    return zaehler


def _has_leader(state: BuilderList, uid: str) -> bool:
    return any(entry.attached_to_uid == uid for entry in state.entries)


def _leader_bonus(candidate: Candidate, state: BuilderList,
                  ctx: RulesContext) -> float:
    """Zuschlag, wenn der Kandidat ein *freies* Leader-Paar mit der Liste bildet.

    Beide Richtungen zählen: ein Charakter, der etwas Vorhandenes anführen
    darf, genauso wie eine Einheit, für die ein vorhandener Charakter
    endlich ein Ziel hätte. Belegt durch ``Datasheets_leader`` — hier wird
    nichts geschätzt.

    Entscheidend ist das *frei*. Ohne diese Prüfung zählt jede Einheit
    beliebig oft als Anschlussziel, und der Zuschlag macht aus einer Armee
    eine Ansammlung von Charakteren, die alle auf denselben Trupp zeigen.
    """
    for entry in state.entries:
        if entry.attached_to_uid:
            continue
        if (candidate.datasheet_id, entry.datasheet_id) in ctx.leader_pairs:
            if not _has_leader(state, entry.uid):
                return LEADER_BONUS
        if (entry.datasheet_id, candidate.datasheet_id) in ctx.leader_pairs:
            # Der Kandidat wäre das Ziel — er darf noch keinen Leader haben,
            # aber er ist ja neu, also zählt nur, dass der Charakter frei ist.
            return LEADER_BONUS
    return 0.0


def _percent(value: float) -> str:
    """Prozentangabe für Begründungstexte — ausdrücklich kaufmännisch gerundet.

    Bewusst nicht ``f"{value:.0%}"``. Diese Formatierung rechnet auf der
    exakten Dezimaldarstellung des Doubles und rundet zur *geraden* Zahl:
    0,585 wird zu „58 %". Die Browser-Engine rundet mit ``Math.round`` auf
    dem Produkt und kommt auf „59 %" — das Produkt ``0.585 * 100`` ist in
    beiden Sprachen bitgleich 58,5, nur die Rundungsregel ist eine andere.

    Auf den echten Daten wichen dadurch Begründungen ab, obwohl beide Seiten
    dieselbe Liste bauten. Eine langweilige, ausgeschriebene Rundung ist hier
    mehr wert als die kürzere Formatierung.
    """
    return f"{math.floor(value * 100 + 0.5)}%"


def _biggest_gain(vorher: dict[str, float], nachher: dict[str, float]) -> str | None:
    zuwachs = {k: nachher[k] - vorher.get(k, 0.0) for k in nachher}
    key = max(zuwachs, key=lambda k: zuwachs[k], default=None)
    return key if key and zuwachs[key] > 0.001 else None


def _reason(candidate: Candidate, luecke: str | None,
            vorher: dict[str, float], nachher: dict[str, float]) -> str:
    if not luecke:
        return f"Füllt {candidate.cost} Punkte, ohne eine Rolle zu verschlechtern."
    titel = roleprofile.SPECS[luecke].title
    return (f"Schließt die größte Lücke: {titel} "
            f"{_percent(vorher.get(luecke, 0.0))} → {_percent(nachher[luecke])}.")


def _enhancement_possible(state: BuilderList, ctx: RulesContext) -> bool:
    return bool(state.detachment_id) and any(
        enh.detachment_id == state.detachment_id
        for enh in ctx.enhancements.values()
    )


def _attach_leaders(session, ctx, state, patch, picks):
    """Ungenutzte Anschlüsse nutzen — §5.3, Punkt 3.

    Ein Charakter, der danebensteht, obwohl er sich anschließen dürfte, ist
    der häufigste stille Fehler beim Listenbau.
    """
    for entry in list(state.entries):
        karte = ctx.cards.get(entry.datasheet_id)
        if not karte or not karte.is_character or entry.attached_to_uid:
            continue
        for ziel in state.entries:
            if ziel.uid == entry.uid or ziel.attached_to_uid:
                continue
            # Ein Ziel, das schon geführt wird, ist besetzt. Der Validator
            # lässt mehr durch — als Warnung, weil einzelne Datasheets es
            # ausdrücklich erlauben. Ein *Vorschlag* darf sich darauf nicht
            # stützen: Er baut sonst zehn Charaktere um denselben Trupp und
            # liefert eine Liste mit zehn Warnungen ab.
            if _has_leader(state, ziel.uid):
                continue
            if (entry.datasheet_id, ziel.datasheet_id) not in ctx.leader_pairs:
                continue
            aktion = {"type": "ATTACH_LEADER", "uid": entry.uid,
                      "target_uid": ziel.uid}
            versuch = apply_all(state, [aktion])
            if validate(versuch, session, ctx).legal:
                patch.append(aktion)
                picks.append(Pick(
                    datasheet_id=entry.datasheet_id,
                    name=karte.name, cost=0, model_count=entry.model_count,
                    reason=(f"Schließt sich {ctx.name(ziel.datasheet_id)} an — "
                            "Datasheets_leader gibt das Paar her."),
                    closes="anschluss",
                ))
                state = versuch
                break
    return state


def _set_warlord(session, ctx, state, patch, picks):
    if any(entry.is_warlord for entry in state.entries):
        return state
    charaktere = [
        entry for entry in state.entries
        if (karte := ctx.cards.get(entry.datasheet_id)) and karte.is_character
    ]
    if not charaktere:
        return state
    # Der teuerste Charakter ist die naheliegendste Wahl — er ist am
    # ehesten dafür gebaut.
    gewaehlt = max(charaktere, key=lambda e: ctx.cost_for(e))
    aktion = {"type": "SET_WARLORD", "uid": gewaehlt.uid}
    versuch = apply_all(state, [aktion])
    if not validate(versuch, session, ctx).legal:
        return state
    patch.append(aktion)
    picks.append(Pick(
        datasheet_id=gewaehlt.datasheet_id, name=ctx.name(gewaehlt.datasheet_id),
        cost=0, model_count=gewaehlt.model_count,
        reason="Warlord — jede Armee braucht einen; gewählt ist der teuerste Charakter.",
        closes="warlord",
    ))
    return versuch


def _add_enhancements(session, ctx, state, patch, picks):
    if not state.detachment_id:
        return state
    for entry in list(state.entries):
        if sum(1 for e in state.entries if e.enhancement_id) >= ruleset.MAX_ENHANCEMENTS:
            break
        karte = ctx.cards.get(entry.datasheet_id)
        if not karte or not karte.is_character or karte.is_epic_hero:
            continue
        if entry.enhancement_id:
            continue
        erlaubt = ctx.allowed_enhancements.get(entry.datasheet_id, set())
        moeglich = [
            enh for enh_id in sorted(erlaubt)
            if (enh := ctx.enhancements.get(enh_id))
            and enh.detachment_id == state.detachment_id
        ]
        # Das teuerste zuerst: Enhancements sind Punkte, die sonst liegen
        # bleiben, und der Preis ist der beste verfügbare Hinweis auf Wirkung.
        # Die id als zweites Kriterium, damit gleich teure nicht in der
        # Reihenfolge einer Menge landen — die ist zwischen zwei Prozessen
        # verschieden, und der Vorschlag wäre nicht reproduzierbar.
        for enh in sorted(moeglich, key=lambda e: (-e.cost, e.id)):
            aktion = {"type": "SET_ENHANCEMENT", "uid": entry.uid,
                      "enhancement_id": enh.id}
            versuch = apply_all(state, [aktion])
            if validate(versuch, session, ctx).legal:
                patch.append(aktion)
                picks.append(Pick(
                    datasheet_id=entry.datasheet_id, name=karte.name,
                    cost=enh.cost, model_count=entry.model_count,
                    reason=f"Enhancement {enh.name} ({enh.cost} Pkt.) — "
                           "legal an diesem Charakter in diesem Detachment.",
                    closes="enhancement",
                ))
                state = versuch
                break
    return state


def _local_search(session, ctx, state, candidates, by_key, targets, patch, picks):
    """Tauschoperationen nach §5.4, Schritt 3.

    Die Gier-Suche entscheidet in der Reihenfolge, in der sie greift, und
    sieht dabei nie, dass ein früher Griff einen späteren verbaut. Der
    Tausch holt genau das zurück: Was bringt es, den schwächsten Eintrag
    gegen etwas anderes zu ersetzen, das ins frei werdende Budget passt?
    """
    for _ in range(LOCAL_SEARCH_ROUNDS):
        aktuell = validate(state, session, ctx)
        vector = _vector_of(state, by_key)
        basis = score(vector, aktuell.points_used, state.points_limit, targets)
        verbessert = False

        for entry in sorted(state.entries, key=lambda e: ctx.cost_for(e)):
            # Angeschlossene oder eingestiegene Einträge hängen an anderen;
            # sie herauszunehmen zieht mehr nach sich, als der Tausch wert ist.
            if entry.attached_to_uid or entry.transported_in_uid:
                continue
            if any(e.attached_to_uid == entry.uid
                   or e.transported_in_uid == entry.uid for e in state.entries):
                continue

            raus = by_key.get((entry.datasheet_id, entry.model_count))
            if not raus:
                continue
            ohne = apply_all(state, [{"type": "REMOVE_UNIT", "uid": entry.uid}])
            frei = state.points_limit - (aktuell.points_used - raus.cost)
            rest = vector_minus(vector, raus.vector)

            for candidate in candidates:
                if candidate.cost > frei or candidate.datasheet_id == entry.datasheet_id:
                    continue
                neu = score(rest + candidate.vector,
                            aktuell.points_used - raus.cost + candidate.cost,
                            state.points_limit, targets)
                if neu <= basis + 1e-6:
                    continue
                aktion = {"type": "ADD_UNIT",
                          "datasheet_id": candidate.datasheet_id,
                          "model_count": candidate.model_count}
                versuch = apply_all(ohne, [aktion])
                if not validate(versuch, session, ctx).legal:
                    continue
                _pin_uid(aktion, ohne, versuch)
                patch.extend([{"type": "REMOVE_UNIT", "uid": entry.uid}, aktion])
                picks.append(Pick(
                    datasheet_id=candidate.datasheet_id, name=candidate.name,
                    cost=candidate.cost, model_count=candidate.model_count,
                    reason=(f"Tausch für {ctx.name(entry.datasheet_id)}: bessere "
                            "Rollenabdeckung im selben Budget."),
                    closes="tausch",
                ))
                state = versuch
                verbessert = True
                break
            if verbessert:
                break

        if not verbessert:
            break
    return state


def vector_minus(total: RoleVector, part: RoleVector) -> RoleVector:
    """Rollenvektor ohne einen Beitrag.

    Die Reichweite lässt sich so nicht zurückrechnen — sie ist ein Maximum,
    kein Vorrat. Sie bleibt stehen; für die Zielfunktion zählt sie ohnehin
    nicht mit (:data:`COVERAGE_KEYS`).
    """
    return RoleVector(
        anti_tank=max(0.0, total.anti_tank - part.anti_tank),
        anti_elite=max(0.0, total.anti_elite - part.anti_elite),
        anti_horde=max(0.0, total.anti_horde - part.anti_horde),
        durability=max(0.0, total.durability - part.durability),
        control=max(0.0, total.control - part.control),
        reach=total.reach,
    )


def _gaps(abdeckung: dict[str, float], ergebnis: ValidationResult,
          state: BuilderList) -> list[str]:
    """„Was fehlt der Liste?" — §5.5, dritte Begründungsart."""
    luecken = [
        f"{roleprofile.SPECS[key].title}: {_percent(wert)} der Zielabdeckung"
        for key, wert in sorted(abdeckung.items(), key=lambda kv: kv[1])
        if wert < 0.85
    ]
    frei = state.points_limit - ergebnis.points_used
    if frei > 0:
        luecken.append(f"{frei} Punkte nicht ausgegeben.")
    return luecken
