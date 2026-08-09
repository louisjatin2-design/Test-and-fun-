# warhammer-meta

Web-App für Warhammer 40.000: wertet Turnierergebnisse aus, rankt Fraktionen und Einheiten statistisch bereinigt und speist daraus einen erklärbaren Listen-Assistenten — mit einem Listenbuilder, der live gegen die Regeln validiert und auf Klick die Regeln jeder Einheit im Seitenpanel zeigt.

Ausgelegt als **self-gehostetes Werkzeug für den privaten Gebrauch**, nicht als öffentliche Instanz.

Der Umsetzungsplan — Datenquellen, Datenmodell, Ranking-Methodik, Synergie-Erkennung, Generator, Listenbuilder, Stack, Roadmap und Risiken — steht in [`PLAN.md`](PLAN.md).

## Status

**Phase 0, 4 und 4b sind gebaut** — der Teil, der ohne Turnierdaten auskommt:

| | Was läuft |
|---|---|
| **Regel-DB** | ETL des kompletten Wahapedia-Exports (17 Dateien, 1.711 Datasheets, 1.918 Leader-Paare) in eine lokale SQLite-Datenbank |
| **Regel-Inspektor** | Klick auf eine Einheit öffnet Profil, Waffen, Fähigkeiten, Anschlussziele, Transport, Enhancements, Stratagems und Quelle im Seitenpanel — ohne die Liste zu verlassen |
| **Listenbuilder** | Live-Validierung bei jeder Änderung, legalitätsgefilterte Zuweisungen, Budgetleiste mit Vorschau, Undo/Redo, Autosave, Export |
| **Validator** | Punktelimit, Fraktion, Rule of Three, Epic Heroes, Enhancements, Leader-Anschluss, Transportkapazität, Warlord |
| **Live-Updates** | Erkennt neue Wahapedia-Stände im Betrieb, lädt sie nach und meldet sie offenen Browsern — ohne Neustart |

Noch offen: Turnierdaten-Ingestion (Phase 1–3), Synergie-Engine (Phase 5), Generator (Phase 6/8). Der Meta-Abschnitt im Inspektor ist dafür vorbereitet und meldet bis dahin ehrlich „noch keine Daten".

## Loslegen

```bash
pip install -e .              # oder: pip install fastapi uvicorn sqlalchemy httpx
python -m app.etl.wahapedia   # lädt den Wahapedia-Export (~30 s)
uvicorn app.api.main:app      # http://127.0.0.1:8000
```

Der ETL legt `data/warhammer_meta.sqlite3` an. Ohne Netz geht es auch aus einem Verzeichnis mit den CSVs:

```bash
python -m app.etl.wahapedia --from-dir ./meine-csvs
```

### Regeldaten werden nicht eingecheckt

`data/` steht in `.gitignore`, und die Testfixtures erfinden eine eigene Fraktion statt echte Datasheets zu kopieren. Der Volltextmodus ist laut [`PLAN.md` §6.3](PLAN.md) an die private, self-gehostete Nutzung gebunden — Regeldaten in ein GitHub-Repository zu committen wäre genau die Veröffentlichung, die diese Begründung aushebelt.

### Live-Updates

Die App prüft im Hintergrund, ob Wahapedia einen neueren Regelstand veröffentlicht hat. Abgefragt wird dafür nur `Last_update.csv` (rund 30 Bytes); der vollständige Export wird ausschließlich geladen, wenn sich der Stand geändert hat.

Läuft ein Update durch, ziehen drei Dinge automatisch nach: die Caches im Serverprozess, die Validierung offener Listen (Punkte ändern sich mit jedem MFM-Stand) und offene Browser — die bekommen über Server-Sent Events ein Banner. **Die Liste selbst wird dabei nie angefasst.**

Ein `python -m app.etl.wahapedia` von Hand wird ebenfalls bemerkt: Maßgeblich ist der Ingest-Zeitstempel in der Datenbank, nicht der Prozesszustand. Ein Serverneustart ist nach einem ETL-Lauf also nie nötig.

| Variable | Default | Bedeutung |
|---|---|---|
| `WH_UPDATE_INTERVAL_HOURS` | `24` | Abstand zwischen zwei Prüfungen. `0` schaltet sie ab; von Hand geht es weiter über `POST /api/updates/check`. |
| `WH_UPDATE_INITIAL_DELAY_SECONDS` | `20` | Erste Prüfung nach dem Start. Ein self-gehostetes Werkzeug läuft nicht wochenlang durch — ohne frühe erste Prüfung würde ein 24-Stunden-Intervall praktisch nie feuern. |
| `WH_UPDATE_AUTO_APPLY` | `1` | Gefundene Updates gleich laden. Auf `0` wird nur gemeldet. |

### Anzeigetiefe der Regeltexte

| Variable | Default | Bedeutung |
|---|---|---|
| `WH_RULES_TEXT_MODE` | `full` | `full` zeigt die Regeltexte vollständig — nur für die private, lokale Instanz. `derived` zeigt Werte, Namen, abgeleitete Effekt-Tags und Deep-Links; **Pflicht, sobald eine Instanz öffentlich erreichbar ist.** |
| `WH_BIND_HOST` | `127.0.0.1` | Wird hier eine nicht-lokale Adresse gesetzt, während `full` aktiv ist, warnt die App beim Start. |
| `WH_DATABASE_URL` | SQLite in `data/` | SQLAlchemy — PostgreSQL bleibt offen. |
| `WH_WAHAPEDIA_BASE_URL` | `…/wh40k11ed` | Quelle des Exports. |

## Tests

```bash
pytest
```

158 Tests, darunter die Abnahmekriterien aus [`PLAN.md` §6.7](PLAN.md): Contract-Test über jede Karte, Property-Test „was das UI anbietet, darf der Validator nie ablehnen", Budget-Messung und Export-Roundtrip.

## Aufbau

```
app/
  config.py            Anzeigemodus, Attribution, Öffentlichkeits-Warnung
  models.py            Silver-Schema + datasheet_card (Gold-Read-Model)
  derive.py            Freitext → Zahlen, Effekt-Tags, HTML-Sanitizing
  etl/csvreader.py     Wahapedia-CSV: BOM, Trailing-Pipe, rohe Zeilenumbrüche
  etl/wahapedia.py     SourceAdapter (HTTP | lokales Verzeichnis) + Ingest
  etl/cards.py         Baut die Karten für den Inspektor
  rules/ruleset.py     Regelkonstanten, jede mit Herkunft: DATA oder ASSUMPTION
  rules/builderlist.py Listendokument + Reducer
  rules/validator.py   Constraint-Validator
  live.py              Datenstand-Zähler für Live-Updates
  etl/updates.py       Update-Erkennung und -Übernahme
  api/main.py          FastAPI inkl. SSE-Stream
  static/              Builder-Oberfläche (kein Build-Schritt)
```

### Zwei Abweichungen vom Plan

- **SQLite statt PostgreSQL** und **kein Next.js.** Für eine Instanz mit einem Nutzer ist beides unnötiger Aufwand; SQLAlchemy hält den Weg zu PostgreSQL offen, und ein Frontend ohne Build-Schritt startet mit einem Befehl. Bei Turnierdaten (Phase 1–3) ist der Wechsel neu zu bewerten.
- **Regelkonstanten sind als Annahme markiert.** Rule of Three, Enhancement-Obergrenze und Epic-Hero-Einzigartigkeit stehen im Kernregelwerk, nicht im Datenexport. Sie liegen in `rules/ruleset.py` und werden im UI als „Annahme" gekennzeichnet, damit niemand sie für belegt hält.

---

Regeldaten powered by Wahapedia. Warhammer 40.000 ist geistiges Eigentum von Games Workshop; dieses Projekt steht in keiner Verbindung zu Games Workshop.
