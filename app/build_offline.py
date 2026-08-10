"""Baut eine einzelne, in sich geschlossene HTML-Datei.

Zweck: den Builder auf ein Gerät bringen, auf dem kein Python läuft — ein
iPhone oder iPad. Dort gibt es weder FastAPI noch SQLite, also wandern
Daten, Oberfläche und Regel-Engine in *eine* Datei. Öffnen genügt; danach
funktioniert alles offline, auch im Flugmodus.

Reducer und Validator kommen dabei aus `app/static/rules.js` statt aus
Python. Dass es sie zweimal gibt, hält `tests/test_parity.py` in Schach.

**Die Datei gehört nicht ins Repository.** Sie enthält die vollständigen
Regeltexte; ein Commit wäre die Veröffentlichung, die PLAN.md §6.3
ausschließt. `dist/` steht deshalb in `.gitignore`, und der Build weist
beim Erzeugen darauf hin.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app import config, db, derive, models
from app.rules import generator, ruleset, synergy

STATIC = Path(__file__).resolve().parent / "static"

#: So viele Partner je Synergieart wandern in die Offline-Datei.
OFFLINE_SYNERGY_LIMIT = 6

#: Ab dieser Größe weist der Build auf einen Build je Fraktion hin. Keine
#: gemessene Grenze — ein Anhaltspunkt, der zwei Fraktionen (klein) von
#: allen zwanzig (zweistellige MB) trennt.
SIZE_HINT_MB = 8

#: Diese Schlüssel hängen an einer bestimmten Fraktion und bekommen je
#: Fraktion einen eigenen Block in der Datei (siehe ``_split``).
PER_FACTION = (
    "cards", "enhancements", "stratagems", "stratagems_by_detachment",
    "synergies",
)

CONTEXT_REASON = (
    "Meta- und Synergiedaten brauchen die Turnierauswertung (Phasen 1–3) "
    "und die Synergie-Engine (Phase 5)."
)


def collect(session, faction_ids: list[str] | None, text_mode: str) -> dict:
    """Sammelt alles, was die Offline-Datei braucht."""
    version = config.RULESET_VERSION

    faction_names = {f.id: f.name for f in session.scalars(select(models.Faction))}
    cards_by_faction: dict[str, list[dict]] = defaultdict(list)

    query = select(models.DatasheetCard).where(
        models.DatasheetCard.ruleset_version == version
    )
    if faction_ids:
        query = query.where(models.DatasheetCard.faction_id.in_(faction_ids))

    for card in session.scalars(query):
        payload = json.loads(card.payload)
        payload.update(
            min_cost=card.min_cost,
            is_epic_hero=card.is_epic_hero,
            is_character=card.is_character,
            transport_capacity=card.transport_capacity,
            rules_text_mode=text_mode,
        )
        if text_mode == "derived":
            payload = _strip_text(payload)
        cards_by_faction[card.faction_id].append(payload)

    for cards in cards_by_faction.values():
        cards.sort(key=lambda c: c["name"])

    present = sorted(cards_by_faction)
    enhancements: dict[str, dict] = {}
    stratagems: dict[str, dict] = {}
    by_detachment: dict[str, dict] = {}
    detachments: dict[str, list[dict]] = {}

    for faction_id in present:
        enhancements[faction_id] = {
            enh.id: {
                "id": enh.id,
                "name": enh.name,
                "cost": derive.to_int(enh.cost),
                "detachment": enh.detachment,
                "detachment_id": enh.detachment_id,
                "description": "" if text_mode == "derived"
                else derive.sanitize_html(enh.description),
                "tags": derive.effect_tags(enh.description),
            }
            for enh in session.scalars(
                select(models.Enhancement).where(
                    models.Enhancement.faction_id == faction_id
                )
            )
        }

        faction_stratagems = {}
        grouped: dict[str, list[str]] = defaultdict(list)
        for strat in session.scalars(
            select(models.Stratagem).where(
                models.Stratagem.faction_id == faction_id
            )
        ):
            faction_stratagems[strat.id] = {
                "id": strat.id,
                "name": strat.name,
                "type": strat.type,
                "cp_cost": strat.cp_cost,
                "turn": strat.turn,
                "phase": strat.phase,
                "detachment": strat.detachment,
                "detachment_id": strat.detachment_id,
                "description": "" if text_mode == "derived"
                else derive.sanitize_html(strat.description),
                "tags": derive.effect_tags(strat.description),
            }
            grouped[strat.detachment_id].append(strat.id)
        stratagems[faction_id] = faction_stratagems
        by_detachment[faction_id] = dict(grouped)

        seen: dict[str, str] = {}
        for row in session.scalars(
            select(models.DetachmentAbility).where(
                models.DetachmentAbility.faction_id == faction_id
            )
        ):
            if row.detachment_id and row.detachment_id not in seen:
                seen[row.detachment_id] = row.detachment or row.detachment_id
        detachments[faction_id] = sorted(
            ({"id": did, "name": name} for did, name in seen.items()),
            key=lambda d: d["name"],
        )

    # Regelbasierte Synergie (§4.1) wird hier *ausgerechnet* und als Daten
    # mitgegeben, statt die Ableitung ein zweites Mal in JavaScript zu
    # schreiben. Sie hängt nur an den Regeldaten, ändert sich also zwischen
    # zwei Builds nicht — genau der Fall, in dem Vorrechnen besser ist als
    # Doppeln. Je Art gedeckelt, sonst wächst die Datei um ein Vielfaches.
    synergies: dict[str, dict[str, list[dict]]] = {}
    for faction_id in present:
        index = synergy.SynergyIndex.build(cards_by_faction[faction_id])
        je_einheit: dict[str, list[dict]] = {}
        for datasheet_id in index.units:
            gezeigt: dict[str, int] = {}
            treffer = []
            for eintrag in synergy.synergies_for(datasheet_id, index):
                zahl = gezeigt.get(eintrag.kind, 0)
                if zahl < OFFLINE_SYNERGY_LIMIT:
                    treffer.append(eintrag.to_dict())
                gezeigt[eintrag.kind] = zahl + 1
            if treffer:
                je_einheit[datasheet_id] = treffer
        synergies[faction_id] = je_einheit

    meta_rows = {row.key: row.value for row in session.scalars(select(models.Meta))}

    return {
        "meta": {
            "ruleset_version": version,
            "rules_text_mode": text_mode,
            "data_version": 0,
            "update_interval_hours": 0,
            "last_update": meta_rows.get("last_update", ""),
            "ingested_at": meta_rows.get("ingested_at", ""),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "has_data": bool(present),
            "offline": True,
            "context_reason": CONTEXT_REASON,
            "synergy_limit": OFFLINE_SYNERGY_LIMIT,
            "attribution": {
                "text": config.ATTRIBUTION.text,
                "url": config.ATTRIBUTION.url,
                "notice": config.ATTRIBUTION.notice,
            },
            "points_limits": list(ruleset.POINTS_LIMITS),
            "rules": [
                {"key": s.key, "title": s.title, "basis": s.basis, "note": s.note}
                for s in ruleset.SPECS.values()
            ],
        },
        "ruleset": ruleset.as_dict(),
        # Ohne Server rechnet der Generator im Browser (app/static/rules.js).
        # Die Suche steht dort ein zweites Mal, die Stellschrauben nicht.
        "generator": generator.as_dict(),
        "factions": sorted(
            ({"id": fid, "name": faction_names.get(fid, fid)} for fid in present),
            key=lambda f: f["name"],
        ),
        "detachments": detachments,
        "cards": {fid: cards_by_faction[fid] for fid in present},
        "enhancements": enhancements,
        "stratagems": stratagems,
        "stratagems_by_detachment": by_detachment,
        "synergies": synergies,
        "synergy_meta": synergy.as_dict(),
    }


def _strip_text(payload: dict) -> dict:
    """`derived`-Modus — dieselbe Linie wie im Server (PLAN.md §6.3)."""
    for ability in payload.get("abilities", []):
        ability["description"] = ""
        ability["derived_only"] = True
    for group in ("ranged", "melee"):
        for weapon in payload.get("weapons", {}).get(group, []):
            weapon["description"] = ""
    for key in ("legend", "loadout"):
        payload[key] = ""
    if payload.get("damaged"):
        payload["damaged"]["description"] = ""
    if payload.get("transport"):
        payload["transport"]["text"] = ""
    payload["leader_note"] = {"head": "", "footer": ""}
    payload["composition"] = []
    for option in payload.get("options", []):
        option["description"] = ""
    return payload


def _payload(data: dict) -> str:
    """Die Daten als JSON-Text, sicher für ein ``<script>``-Element.

    Zwei Eingriffe, beide gegen den HTML-Tokenizer und nicht gegen JSON:

    * ``</`` wird zu ``<\\/``. Sonst beendet ein ``</script>`` mitten im
      Regeltext das umschließende Element, und der Rest der Datei landet im
      sichtbaren Dokument.
    * ``<!--`` wird zu ``\\u003c!--``. Danach kann der Tokenizer nicht mehr in
      seinen "escaped"-Zustand geraten, in dem ein späteres ``<script`` das
      Ende der Daten verschieben würde.

    Beides sind gültige JSON-Escapes; ``JSON.parse`` liefert wieder den
    ursprünglichen Text. Und beide Muster können in JSON nur *innerhalb* einer
    Zeichenkette stehen — außerhalb kommen ``<`` und ``/`` dort nicht vor.

    ``separators`` spart die Leerzeichen hinter Komma und Doppelpunkt. Bei
    allen Fraktionen sind das rund ein MB weniger, das ein Telefon nicht
    laden, halten und durchsuchen muss.
    """
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return text.replace("</", "<\\/").replace("<!--", "\\u003c!--")


def _split(data: dict) -> tuple[dict, list[str]]:
    """Trennt den Kern von den Daten der einzelnen Fraktionen.

    Der Kern ist winzig — Regelkonstanten, Fraktionsnamen, Detachments — und
    wird beim Öffnen gelesen. Alles, was an einer *bestimmten* Fraktion hängt,
    bekommt einen eigenen Block; app.js liest davon nur den, den man auswählt.

    **Warum überhaupt.** Bis hierher las die Datei beim Öffnen alle zwanzig
    Fraktionen auf einmal ein: 18 MB Text wurden zu einem Objektbaum, der ein
    Vielfaches davon belegt. Auf einem Telefon oder älteren iPad ist der
    Speicher je Seite eng, und wenn er nicht reicht, sieht man davon nichts
    als eine Fraktionsauswahl, die leer bleibt. Für den Listenbau braucht man
    ohnehin immer genau eine Fraktion — die anderen neunzehn sind reine Last.

    Es bleibt dabei *eine* Datei: Die Blöcke sind Elemente im selben Dokument,
    nichts wird nachgeladen. Der Browser hält sie als Text, und Text kostet
    einen Bruchteil dessen, was ein Objektbaum kostet.
    """
    faction_ids = sorted(data.get("cards") or {})

    core = {key: value for key, value in data.items() if key not in PER_FACTION}
    #: Fraktion -> Nummer des Blocks. Über die Nummer statt über die
    #: Fraktions-ID, damit die Element-ID keine Zeichen enthalten kann, die
    #: `getElementById` nicht verträgt.
    core["faction_slots"] = {fid: i for i, fid in enumerate(faction_ids)}

    blocks = []
    for fid in faction_ids:
        blocks.append(_payload({
            key: (data.get(key) or {}).get(fid, [] if key == "cards" else {})
            for key in PER_FACTION
        }))
    return core, blocks


def render(data: dict) -> str:
    """Setzt Oberfläche, Engine und Daten zu einer Datei zusammen."""
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    css = (STATIC / "styles.css").read_text(encoding="utf-8")
    rules_js = (STATIC / "rules.js").read_text(encoding="utf-8")
    app_js = (STATIC / "app.js").read_text(encoding="utf-8")

    html = html.replace(
        '<link rel="stylesheet" href="/static/styles.css">',
        f"<style>\n{css}\n</style>",
    )
    # **Daten und Code in getrennte Elemente.** Früher stand beides in einem
    # einzigen <script>: `window.WH_OFFLINE = { … }`, direkt gefolgt von
    # rules.js und app.js. Ein Objektliteral muss der JavaScript-Parser aber
    # vollständig verarbeiten, bevor die erste Zeile Code läuft — und bei
    # allen Fraktionen sind das rund 13 MB. Reicht der Speicher dafür nicht,
    # fällt das ganze Script aus, Oberfläche inklusive. Auf iPad und iPhone
    # blieb davon eine Seite übrig, die aussah wie die App und in der sich
    # keine Fraktion auswählen ließ: Die Auswahlfelder füllt app.js, und
    # app.js lief nie.
    #
    # Als `type="application/json"` sind die Daten für den JavaScript-Parser
    # gar nicht da. `JSON.parse` in app.js liest sie danach in einem Zug —
    # sparsamer, schneller, und ein Fehler dabei ist ein normaler Fehler
    # *im* Programm, den der Startbildschirm anzeigen kann.
    #
    # Und je Fraktion ein eigener Block (siehe `_split`): Beim Öffnen wird nur
    # der Kern gelesen, der Rest erst, wenn man die Fraktion auswählt.
    core, blocks = _split(data)
    elemente = [f'<script type="application/json" id="wh-data">'
                f"{_payload(core)}</script>"]
    elemente += [
        f'<script type="application/json" id="wh-faction-{index}">{block}</script>'
        for index, block in enumerate(blocks)
    ]
    html = html.replace(
        '<script src="/static/rules.js"></script>\n'
        '<script src="/static/app.js"></script>',
        "\n".join(elemente) + "\n<script>\n"
        f"{rules_js}\n{app_js}\n"
        "</script>",
    )

    # Symbol und Manifest liegen im Serverbetrieb unter /static/. Die
    # Offline-Datei wird aus dem Dateisystem geöffnet — dort gibt es kein
    # /static/, und jede solche Zeile wäre ein Ladefehler. Das Manifest
    # bringt hier ohnehin nichts: Ohne Server ist die Datei die App.
    for tag in (
        '<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">\n',
        '<link rel="manifest" href="/static/manifest.webmanifest">\n',
    ):
        html = html.replace(tag, "")

    # Der Zusammenbau steht und fällt mit wörtlichen Treffern oben. Ändert
    # jemand index.html, sollen die Ersetzungen hier auffallen und nicht erst
    # auf einem Telefon ohne Netz, wo die Datei dann halb geladen dasteht.
    if "/static/" in html:
        raise RuntimeError(
            "Die Offline-Datei verweist noch auf /static/ — index.html wurde "
            "geändert, ohne app/build_offline.py nachzuziehen."
        )
    return html


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Baut eine eigenständige HTML-Datei für Handy oder Tablet."
    )
    parser.add_argument(
        "--faction", action="append", default=None,
        help="Nur diese Fraktion(en) einbauen (mehrfach angebbar). "
             "Ohne Angabe: alle.",
    )
    parser.add_argument(
        "--out", type=Path, default=Path("dist/warhammer-builder.html"),
        help="Zieldatei (Default: dist/warhammer-builder.html).",
    )
    parser.add_argument(
        "--mode", choices=("full", "derived"), default="full",
        help="Anzeigetiefe der Regeltexte (PLAN.md §6.3). "
             "'full' nur für den eigenen Gebrauch.",
    )
    parser.add_argument(
        "--list-factions", action="store_true",
        help="Nur die verfügbaren Fraktionen mit ihrer Kennung ausgeben. "
             "Die braucht --faction.",
    )
    args = parser.parse_args(argv)

    db.create_all()

    # Ohne diese Liste ist `--faction` kaum zu benutzen: Die Kennungen stehen
    # sonst nirgends, und wer die Datei kleiner bauen will, müsste raten.
    if args.list_factions:
        with db.session() as session:
            vorhanden = collect(session, None, "derived")["factions"]
        if not vorhanden:
            print("Keine Regeldaten gefunden. Zuerst "
                  "'python -m app.etl.wahapedia' ausführen.", file=sys.stderr)
            return 1
        breite = max(len(f["id"]) for f in vorhanden)
        for faction in vorhanden:
            print(f"  {faction['id']:<{breite}}  {faction['name']}")
        return 0

    with db.session() as session:
        data = collect(session, args.faction, args.mode)

    if not data["factions"]:
        print(
            "Keine Regeldaten gefunden. Zuerst 'python -m app.etl.wahapedia' "
            "ausführen.",
            file=sys.stderr,
        )
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(data), encoding="utf-8")

    cards = sum(len(c) for c in data["cards"].values())
    size = args.out.stat().st_size / 1e6
    print(f"{args.out}  —  {len(data['factions'])} Fraktionen, {cards} Einheiten, "
          f"{size:.1f} MB")
    print(f"Regelstand {data['meta']['last_update']}, Modus '{args.mode}'.")

    # Die Datei muss als Ganzes in den Speicher einer einzelnen Seite passen.
    # Auf dem Rechner fällt das nicht auf, auf einem Telefon sehr wohl — und
    # dort steht dann nur der Startbildschirm. Wer zwei Fraktionen spielt,
    # braucht die anderen neunzehn nicht dabeizuhaben.
    if size > SIZE_HINT_MB:
        print(
            f"\nHinweis: {size:.0f} MB in einer Datei sind für ein Telefon oder "
            "ein älteres iPad viel. Falls sie dort nicht startet, hilft ein "
            "Build mit nur den eigenen Fraktionen:\n"
            "    python -m app.build_offline --faction SM --out dist/marines.html"
        )

    if args.mode == "full":
        print(
            "\nHinweis: Die Datei enthält die vollständigen Regeltexte. Sie ist "
            "für den eigenen Gebrauch gedacht — nicht ins Repository committen "
            "und nicht öffentlich hochladen (PLAN.md §6.3)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
