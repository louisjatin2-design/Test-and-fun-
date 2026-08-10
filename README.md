# warhammer-meta

Web-App für Warhammer 40.000: wertet Turnierergebnisse aus, rankt Fraktionen und Einheiten statistisch bereinigt und speist daraus einen erklärbaren Listen-Assistenten — mit einem Listenbuilder, der live gegen die Regeln validiert und auf Klick die Regeln jeder Einheit im Seitenpanel zeigt.

Ausgelegt als **self-gehostetes Werkzeug für den privaten Gebrauch**, nicht als öffentliche Instanz.

Der Umsetzungsplan — Datenquellen, Datenmodell, Ranking-Methodik, Synergie-Erkennung, Generator, Listenbuilder, Stack, Roadmap und Risiken — steht in [`PLAN.md`](PLAN.md).

## Status

**Phase 0, 4, 4b und der regelbasierte Teil von 6 sind gebaut** — alles, was ohne Turnierdaten auskommt:

| | Was läuft |
|---|---|
| **Regel-DB** | ETL des kompletten Wahapedia-Exports (17 Dateien, 1.711 Datasheets, 1.918 Leader-Paare) in eine lokale SQLite-Datenbank |
| **Regel-Inspektor** | Klick auf eine Einheit öffnet Profil, Waffen, Fähigkeiten, Anschlussziele, Transport, Enhancements, Stratagems und Quelle im Seitenpanel — ohne die Liste zu verlassen |
| **Listenbuilder** | Live-Validierung bei jeder Änderung, legalitätsgefilterte Zuweisungen, Budgetleiste mit Vorschau, Undo/Redo, Autosave, Export |
| **Validator** | Punktelimit, Fraktion, Rule of Three, Epic Heroes, Enhancements, Leader-Anschluss, Transportkapazität, Warlord |
| **Live-Updates** | Erkennt neue Wahapedia-Stände im Betrieb, lädt sie nach und meldet sie offenen Browsern — ohne Neustart |
| **Offline-Datei** | `build_offline.py` erzeugt eine eigenständige HTML-Datei mit Daten und Regel-Engine — läuft ohne Server auf jedem Telefon |
| **Auf jedem Gerät** | Eine Oberfläche für PC, iPad, iPhone und Android: drei Spalten, zwei Spalten oder Reiter — je nach Platz. Installierbar als App |
| **Listen-Generator** | Baut eine Liste aus Fraktion + Punktelimit oder füllt die Restpunkte einer bestehenden auf — legal, ausgewogen, mit Begründung je Einheit |

Noch offen: Turnierdaten-Ingestion (Phase 1–3) und die Synergie-Engine (Phase 5). Der Meta-Abschnitt im Inspektor ist dafür vorbereitet und meldet bis dahin ehrlich „noch keine Daten".

## Der Listen-Generator

Knopf **Vorschlag** in der Kopfzeile, zwei Betriebsarten aus [`PLAN.md` §5.3](PLAN.md):

| | |
|---|---|
| **Restpunkte füllen** | Die vorhandene Liste bleibt unangetastet, gefüllt wird nur der Rest — „fülle mir die letzten 240 Punkte". Der Alltagsfall. |
| **Komplett neu bauen** | Fraktion und Punktelimit genügen. |

Das Ergebnis erscheint als **Diff mit Übernehmen/Verwerfen**, nicht als fertige Tatsache. Übernehmen läuft als ganz normaler Patch durch denselben Reducer wie jeder Klick im Builder — der ganze Vorschlag hängt damit als *ein* Schritt an Undo.

### Wonach er entscheidet

Harte Regeln sind nicht verhandelbar: Jeder Zwischenstand läuft durch denselben Validator wie der Builder, ein Vorschlag mit Regelbruch wird gar nicht erst gemacht. Darüber liegt die **Rollenabdeckung** aus §5.2 — für jede Einheit wird aus den Waffenprofilen der erwartete Schaden gegen drei Zielarchetypen gerechnet:

| Rolle | Zielprofil |
|---|---|
| Anti-Tank | T10, Sv2+, W12 |
| Anti-Elite | T5, Sv2+, 4++, W3 |
| Anti-Horde | T3, Sv5+, W1 (Überschussschaden verfällt, wie im Spiel) |
| Haltbarkeit | effektive Lebenspunkte gegen einen Referenzangriff S4/AP-1 |
| Objective Control | Summe der OC-Werte |

Die Zielhöhe je Rolle richtet sich nach der **medianen Effizienz der jeweiligen Fraktion** — eine absolute Zahl wäre für Custodes und Guardsmen gleichermaßen falsch. Erfüllte Rollen zählen nur noch anteilig weiter, damit der nächste Griff in die Lücke geht statt in die vierte Panzerabwehr.

Modelliert sind Torrent, Twin-linked, Sustained Hits, Lethal Hits, Devastating Wounds, Anti-X und Blast. Nicht modelliert sind Rapid Fire, Melta, Heavy und Indirect Fire: Sie hängen an Entfernung und Spielsituation und wären aus einem statischen Profil geraten, nicht gerechnet — deshalb bleiben sie draußen und stehen in der Antwort unter `missing_evidence`.

### Was er nicht kann, sagt er

[`PLAN.md` §5.4](PLAN.md) sieht Archetyp-Seeding aus echten Turnierlisten und einen Meta-Prior je Einheit vor. Beides braucht die Turnierauswertung aus den Phasen 1–3. Bis dahin beruht jeder Vorschlag **allein auf Regel- und Profildaten**, und genau das steht im Dialog. Drei der neun Rollen aus §5.2 — Screening, Board Control, Secondary-Scoring — hängen davon ab, wie eine Einheit *gespielt* wird, und werden gar nicht erst geschätzt: Eine erfundene Zahl ginge in die Bewertung ein, ohne dass jemand sie prüfen könnte.

Die Stellschrauben der Zielfunktion sind gesetzt, nicht belegt. Sie stehen gesammelt oben in `app/rules/generator.py`, jede mit Begründung — und die Zielhöhen wurden gemessen statt geraten: Beim ersten Ansatz erreichte eine volle Liste das Fünf- bis Neunfache des Ziels, war also nach einem Drittel des Budgets gesättigt und der Rest der Liste beliebig. Das Verfahren ist wiederholbar; wer die Gewichte ändert, misst neu.

**Läuft auch ohne Server.** Der Generator steht wie Reducer und Validator ein zweites Mal in `app/static/rules.js` und arbeitet damit in der Offline-Datei auf iPad und iPhone — im Flugmodus, ohne einen einzigen Netzwerkzugriff. Die Doppelung ist tragbar, weil `tests/test_parity.py` beide Seiten aus derselben Ausgangslage bauen lässt und Einheit für Einheit, Anschluss für Anschluss und Begründung für Begründung vergleicht. Die Stellschrauben kommen aus `generator.as_dict()`, existieren also weiterhin nur einmal.

Dass das nicht selbstverständlich ist, zeigte die Prüfung auf den echten Daten: Sieben von neun Fraktionen stimmten sofort überein, zwei wichen in *einem* Begründungstext ab. Ursache war die Prozentformatierung — `f"{0.585:.0%}"` ergibt in Python „58 %", `Math.round(0.585 * 100)` im Browser „59 %". Das Produkt ist in beiden Sprachen bitgleich 58,5; nur die Rundungsregel war eine andere. Beide Seiten runden jetzt ausdrücklich kaufmännisch.

## Loslegen

```bash
pip install -e .              # oder: pip install fastapi uvicorn sqlalchemy httpx
python -m app.etl.wahapedia   # lädt den Wahapedia-Export (~30 s)
uvicorn app.api.main:app      # http://127.0.0.1:8000
```

Unter **Windows** in der Eingabeaufforderung — `uvicorn` liegt dort oft nicht im PATH, und Umgebungsvariablen brauchen eine eigene Zeile:

```bat
python -m pip install -e .
python -m app.etl.wahapedia
python -m uvicorn app.api.main:app
```

Das Fenster muss offen bleiben, es *ist* der Server; beenden mit `Strg+C`. Beim Installieren von Python muss der Haken **„Add python.exe to PATH"** gesetzt sein, sonst findet `cmd` den Befehl nicht.

Der ETL legt `data/warhammer_meta.sqlite3` an. Ohne Netz geht es auch aus einem Verzeichnis mit den CSVs:

```bash
python -m app.etl.wahapedia --from-dir ./meine-csvs
```

### Ohne Rechner: eine Datei fürs Handy

Auf einem iPhone oder iPad läuft kein Python — FastAPI und SQLite fallen dort aus. Für diesen Fall baut

```bash
python -m app.build_offline                       # alle Fraktionen
python -m app.build_offline --faction SM --out dist/marines.html
```

eine **einzelne HTML-Datei** mit Oberfläche, Regel-Engine und allen Daten darin (alle Fraktionen: rund 13 MB). Auf das Gerät kopieren, antippen, fertig: Sie läuft vollständig offline, auch im Flugmodus, und macht keinen einzigen Netzwerkzugriff.

Reducer, Validator **und Generator** kommen dabei aus `app/static/rules.js` statt aus Python. Diese Doppelung ist der Preis dafür, dass ohne Server überhaupt validiert und gebaut werden kann — `tests/test_parity.py` treibt dieselben zufälligen Aktionsfolgen durch beide Engines und vergleicht Punkte, Legalität und jeden Meldungstext; für den Generator vergleicht er die gebauten Listen Eintrag für Eintrag.

Was der Offline-Datei fehlt: Live-Updates. Ein neuer Regelstand heißt hier, die Datei neu zu bauen. `dist/` ist aus demselben Grund wie `data/` gitignored — die Datei enthält die vollständigen Regeltexte und ist für den eigenen Gebrauch, nicht zum Hochladen.

### Auf iPad oder Handy öffnen (mit Rechner im selben WLAN)

Die App läuft auf deinem Rechner; das Tablet oder Telefon ruft sie über das heimische WLAN auf. Beide Geräte müssen im **selben Netz** sein.

**1. Server für das Netz freigeben.** Standardmäßig hört er nur auf `localhost` und ist von anderen Geräten nicht erreichbar:

```bash
WH_BIND_HOST=0.0.0.0 uvicorn app.api.main:app --host 0.0.0.0 --port 8000
```

Unter Windows gilt dieselbe Zeile nicht — dort setzt `set` die Variable, und zwar in einer eigenen Zeile davor:

```bat
set WH_BIND_HOST=0.0.0.0
python -m uvicorn app.api.main:app --host 0.0.0.0 --port 8000
```

**2. IP-Adresse des Rechners herausfinden:**

```bash
hostname -I | awk '{print $1}'      # Linux
ipconfig getifaddr en0              # macOS (WLAN)
ipconfig                            # Windows: "IPv4-Adresse"
```

**3. Auf dem Gerät aufrufen:** `http://<IP-des-Rechners>:8000`, zum Beispiel `http://192.168.1.42:8000`.

**4. Optional als App ablegen.** Safari → Teilen → „Zum Home-Bildschirm"; Chrome auf Android → Menü → „App installieren". Die Seite startet dann ohne Browserleiste, mit eigenem Symbol.

Klappt es nicht, blockiert meist die Firewall des Rechners den Port — unter macOS und Windows muss Python einmalig für eingehende Verbindungen freigegeben werden.

#### Der Export braucht auf dem Tablet einen Umweg

`navigator.clipboard` gibt es nur im *secure context*, also unter HTTPS oder auf `localhost`. Über `http://192.168.…` — den Weg oben — hat der Browser die Zwischenablage-API schlicht nicht. Der Export-Dialog zeigt den Text deshalb in einem Feld, versucht das Kopieren trotzdem, bietet auf Geräten mit Teilen-Menü `navigator.share` an und schreibt hin, was tatsächlich geklappt hat. Notfalls markiert man den Text und kopiert von Hand.

#### Wichtig: `0.0.0.0` ist nicht mehr nur lokal

Mit dieser Bindung ist die App für **jedes Gerät im selben Netz** erreichbar, nicht nur für deine. Die App warnt beim Start entsprechend. Im eigenen WLAN mit den eigenen Geräten bleibt das die private Nutzung, auf die sich [`PLAN.md` §6.3](PLAN.md) stützt. In einem fremden Netz — Café, Büro, Wohnheim, Gäste-WLAN — gilt das nicht mehr; dort entweder

```bash
WH_RULES_TEXT_MODE=derived WH_BIND_HOST=0.0.0.0 uvicorn app.api.main:app --host 0.0.0.0
```

oder gar nicht freigeben. Ins offene Internet gehört die Instanz in keinem Fall.

### Eine Oberfläche für alle Geräte

Die App passt sich an zwei Größen an, nicht an eine: an die **Breite** das Layout, an das **Eingabegerät** die Bedienelemente. Das fällt nicht zusammen — ein iPad im Querformat ist 1194 px breit und wird trotzdem mit dem Finger bedient, ein schmal gezogenes Fenster auf dem PC nicht. Wer beides an der Breite festmacht, bekommt auf dem einen Gerät Mausbedienung ohne Maus und auf dem anderen Fingergrößen ohne Finger.

| Breite | Layout | Typisch |
|---|---|---|
| über 1024 px | Katalog · Liste · Inspektor nebeneinander | PC, iPad quer |
| 621–1024 px | Katalog · Liste, Inspektor als Sheet von rechts | iPad hoch, halbes Fenster |
| bis 620 px | Reiter zwischen Katalog und Liste, Inspektor als Bottom Sheet | iPhone, Android |
| flach (Höhe ≤ 520 px) | kompakte Kopfzeile, Inspektor von rechts | Telefon quer |

Am Touchscreen (`hover: none`, `pointer: coarse`) kommen unabhängig davon dazu: dauerhaft sichtbare Knöpfe statt Hover-Einblendung, Trefferflächen ab 44 px und 16 px Schrift in allen Eingabefeldern. Die 16 px sind kein Geschmack, sondern eine Funktion: Darunter zoomt Safari beim Antippen eines Feldes die Seite heran — und nicht von selbst wieder heraus.

Dazu kommt, was auf dem Telefon sonst schiefgeht: Höhen in `dvh` statt `vh`, damit die Adressleiste nicht das Fußende der App verdeckt; `env(safe-area-inset-*)` für Notch und Home-Indikator; und ein Manifest, ohne das Chrome kein „App installieren" anbietet.

`tests/test_frontend.py` hält die Regeln fest, deren Verlust ein Gerät unbenutzbar macht — sie sehen im Stylesheet wie Kosmetik aus und sind keine.

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

255 Tests, darunter die Abnahmekriterien aus [`PLAN.md` §6.7](PLAN.md): Contract-Test über jede Karte, Property-Test „was das UI anbietet, darf der Validator nie ablehnen", Budget-Messung und Export-Roundtrip.

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
  rules/roleprofile.py Rollenprofil je Einheit aus Waffen- und Profilwerten
  rules/generator.py   Listen-Generator: Assistent und Vollautomatik
  live.py              Datenstand-Zähler für Live-Updates
  etl/updates.py       Update-Erkennung und -Übernahme
  api/main.py          FastAPI inkl. SSE-Stream
  static/rules.js      Reducer + Validator für den Browser (Offline-Modus)
  static/styles.css    Oberfläche inkl. Anpassung an Bildschirm und Finger
  static/manifest.webmanifest  Macht die App installierbar (Android/Chrome)
  static/              Builder-Oberfläche (kein Build-Schritt)
  build_offline.py     Baut die eigenständige HTML-Datei fürs Telefon
```

### Zwei Abweichungen vom Plan

- **SQLite statt PostgreSQL** und **kein Next.js.** Für eine Instanz mit einem Nutzer ist beides unnötiger Aufwand; SQLAlchemy hält den Weg zu PostgreSQL offen, und ein Frontend ohne Build-Schritt startet mit einem Befehl. Bei Turnierdaten (Phase 1–3) ist der Wechsel neu zu bewerten.
- **Regelkonstanten sind als Annahme markiert.** Rule of Three, Enhancement-Obergrenze und Epic-Hero-Einzigartigkeit stehen im Kernregelwerk, nicht im Datenexport. Sie liegen in `rules/ruleset.py` und werden im UI als „Annahme" gekennzeichnet, damit niemand sie für belegt hält.

---

Regeldaten powered by Wahapedia. Warhammer 40.000 ist geistiges Eigentum von Games Workshop; dieses Projekt steht in keiner Verbindung zu Games Workshop.
