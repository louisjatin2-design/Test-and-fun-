# Projektplan: Warhammer 40.000 Meta-Ranking & Listen-Generator

**Arbeitstitel:** `warhammer-meta` — eine Web-App, die (A) Turnierergebnisse verschiedener Quellen einsammelt, normalisiert und Fraktionen/Detachments/Einheiten statistisch sauber rankt, und (B) daraus plus den echten Regeldaten einen erklärbaren Listen-Generator speist.

Stand der Recherche: 09.08.2026. Alle unten genannten Datenquellen wurden live geprüft (HTTP-Status, Schema, Feldnamen), nicht aus dem Gedächtnis zitiert.

---

## 0. Kernidee in einem Absatz

Zwei Datenwelten treffen aufeinander: **harte Regeldaten** (welche Einheit kostet was, wer kann wen anführen, welches Detachment erlaubt welches Enhancement) und **weiche Evidenz** (was hat auf Turnieren tatsächlich gewonnen). Die App ist gut, wenn sie beides trennt und dann kontrolliert zusammenführt. Reine Winrate-Tabellen gibt es genug; der Mehrwert liegt in (1) skill-bereinigten Rankings mit Konfidenzintervallen statt nackter Prozentzahlen und (2) einem Generator, der jeden Vorschlag begründet — mit Regelmechanik *und* Turnierbeleg.

---

## 1. Datenquellen (geprüft)

### 1.1 Regeldaten — Wahapedia CSV-Export ✅ verifiziert

Wahapedia stellt einen offiziellen Datenexport bereit: <https://wahapedia.ru/wh40k11ed/the-rules/data-export/>
Format: CSV, Trennzeichen `|` (Pipe), UTF-8 mit BOM. Basis-URL: `https://wahapedia.ru/wh40k11ed/<Datei>.csv` (11. Edition; `wh40k10ed` existiert parallel weiter).

Live geprüfte Dateien und ihre Spalten:

| Datei | Spalten | Nutzen |
|---|---|---|
| `Factions.csv` | `id, name, link` | Fraktionsstammdaten |
| `Datasheets.csv` | `id, name, faction_id, source_id, legend, role, loadout, transport, virtual, leader_head, leader_footer, damaged_w, damaged_description, link` | Einheiten-Stammsatz (1.711 Zeilen) |
| `Datasheets_models.csv` | `datasheet_id, line, name, M, T, Sv, inv_sv, inv_sv_descr, W, Ld, OC, base_size` | Profilwerte |
| `Datasheets_wargear.csv` | `datasheet_id, line, dice, name, description, range, type, A, BS_WS, S, AP, D` | Waffenprofile inkl. Waffen-Keywords |
| `Datasheets_abilities.csv` | `datasheet_id, line, ability_id, model, name, description, type, parameter` | Fähigkeiten (Core/Faction/Datasheet) |
| `Datasheets_keywords.csv` | `datasheet_id, keyword, model, is_faction_keyword` | Keywords (für Regel-Interaktionen essenziell) |
| **`Datasheets_leader.csv`** | `leader_id, attached_id` | **1.918 harte Leader↔Bodyguard-Paare** |
| `Datasheets_enhancements.csv` | `datasheet_id, enhancement_id` | Wer darf welches Enhancement tragen |
| `Datasheets_detachment_abilities.csv` | `datasheet_id, detachment_ability_id` | Einheit ↔ Detachment-Zuordnung |
| `Datasheets_unit_composition.csv` | `datasheet_id, line, description` | Truppstärken |
| `Datasheets_models_cost.csv` | `datasheet_id, line, description, cost` | Punktkosten pro Truppgröße |
| `Datasheets_options.csv` | `datasheet_id, line, button, description` | Ausrüstungsoptionen (Freitext) |
| `Stratagems.csv` | `faction_id, name, id, type, cp_cost, turn, phase, detachment, detachment_id, description` | Stratagems |
| `Enhancements.csv` | `faction_id, id, name, cost, detachment, detachment_id, description` | Enhancements + Kosten |
| `Detachment_abilities.csv` | `id, faction_id, name, description, detachment, detachment_id` | Detachment-Regeln |
| `Abilities.csv` | `id, name, faction_id, description` | Globale Fähigkeiten |
| `Source.csv` | `id, name, type, edition, version, errata_date, errata_link` | Quellen-/Errata-Versionierung |
| `Last_update.csv` | `last_update` | Änderungserkennung für den ETL |

**`Datasheets_leader.csv` ist der wichtigste einzelne Datensatz des ganzen Projekts.** Er liefert Synergie als *Fakt*, nicht als Statistik: welcher Charakter sich an welche Einheit anschließen darf, ist die Grundmenge, aus der 80 % aller echten „Combos" bestehen. Genauso `Datasheets.transport` (Transportkapazität als Freitext) und `Datasheets_enhancements`.

Auflagen: Wahapedia bittet um Nennung („powered by Wahapedia"). Das ist einzuhalten. Die Regeltexte selbst sind GW-IP — im Produkt werden **abgeleitete Tags und Verlinkungen** gezeigt, keine vollständigen Regeltext-Kopien.

⚠️ **Validierungsaufgabe in Phase 0:** Der `wh40k11ed`-Export liefert HTTP 200, aber `Last_update` steht auf 2026-05-09 und die `link`-Spalten zeigen teils noch auf `/wh40k10ed/`-Pfade; die Dateigrößen von 10ed und 11ed sind fast identisch. Vor Projektstart muss stichprobenartig gegen die Website geprüft werden, ob der 11ed-Export inhaltlich schon vollständig auf 11. Edition steht. Falls nein: MFM/Dataslate-Quelle (unten) wird zur führenden Punktequelle, Wahapedia bleibt für Profile/Fähigkeiten.

### 1.2 Punkte & Balance-Stände

- **BSData/wh40k-11e-mfm** — geparste Snapshots des Munitorum Field Manual von `mfm.warhammer-community.com`. Vorteil: versioniert, mit Historie — genau das, was für „welche Punkte galten bei diesem Turnier?" gebraucht wird.
- Fallback/Ergänzung: `Datasheets_models_cost.csv` von Wahapedia.

### 1.3 Listen-Struktur zum Parsen

- **BSData/wh40k-11e** — Community-Katalogdateien (XML, BattleScribe-/New-Recruit-Format). Damit lassen sich exportierte Rosters (`.rosz`/`.ros`, New-Recruit-JSON) *strukturiert* einlesen statt Freitext zu raten.
- **GW-App-Textexport** und handgetippte Listen: nur als Freitext verfügbar → Parser (siehe §6).

### 1.4 Turnierergebnisse — der heikle Teil

| Quelle | Zugang | Bewertung |
|---|---|---|
| **Best Coast Pairings** | Kein dokumentiertes öffentliches API. Es existiert eine interne API (AWS API Gateway, z. B. `eventlistings`, `pairings`), gegen die Community-Skripte laufen (z. B. `specialprocedures/best-coast-pairings`) | Größter Datenbestand, aber **rechtlich der kritische Punkt** — undokumentierte Endpunkte sind kein Freibrief |
| **TableTopTO** (tabletopto.com) | Bietet laut Anbieter „comprehensive exports" und öffentliche Standings | Sauberster Weg, wenn Export/Partner-Zugang erreichbar |
| **Listhammer** (listhammer.info) | Aggregiert Listen+Ergebnisse, blockt Bots (HTTP 403) | Nur als Cross-Check / Plausibilisierung |
| **Stat Check**, **Warp Friends** | Veröffentlichte Meta-Auswertungen | Referenzwerte zum Validieren der eigenen Zahlen |
| **Manueller/TO-Upload** | CSV/JSON-Import in der eigenen App | Immer bauen — als Fallback und für lokale Turniere |

**Empfohlene Reihenfolge:** (1) BCP/TableTopTO schriftlich um API- bzw. Export-Zugang bitten — das ist ein Zweizeiler und löst das Problem sauber; (2) parallel den Import-Pfad für manuell exportierte Dateien bauen, damit die App unabhängig vom Ausgang funktioniert; (3) Scraping nur, wenn ToS/robots.txt es zulassen, dann mit Rate-Limit, Caching, User-Agent mit Kontakt und **ohne** Weiterveröffentlichung der Rohdaten.

Die gesamte Ingestion wird hinter ein `SourceAdapter`-Interface gelegt. So ist der Quellenzugang eine austauschbare Komponente und keine Architekturentscheidung — falls BCP wegfällt, kippt nicht das Projekt.

---

## 2. Datenmodell

Drei Schichten (Bronze/Silver/Gold), weil Turnierdaten schmutzig sind und man den Rohstand zum Nachdebuggen braucht.

**Bronze — `raw_ingest`**
`id, source, endpoint, fetched_at, payload JSONB, content_hash` — jeder Abruf unverändert. Reprocessing ohne erneutes Abrufen.

**Silver — normalisiert**

```
faction(id, name, parent_faction_id)
detachment(id, faction_id, name, ruleset_version)
datasheet(id, faction_id, name, role, transport_capacity, ruleset_version)
model_profile(datasheet_id, line, m, t, sv, inv, w, ld, oc)
weapon(datasheet_id, line, name, range, type, a, bs_ws, s, ap, d, keywords[])
keyword(datasheet_id, keyword, is_faction)
leader_attach(leader_id, attached_id)          -- aus Datasheets_leader
enhancement(id, faction_id, detachment_id, name, cost)
points(datasheet_id, model_count, cost, mfm_version, valid_from, valid_to)

tournament(id, source, source_event_id, name, date, country, player_count,
           rounds, format, points_limit, mission_pack, ruleset_version)
player(id, canonical_name, country)            -- Dedupe über Name+Region+Historie
army_list(id, tournament_id, player_id, faction_id, detachment_id,
          raw_text, parse_confidence, parse_status)
list_entry(army_list_id, datasheet_id, count, model_count, points,
           enhancement_id, matched_via, match_score)
game(id, tournament_id, round, p1_list_id, p2_list_id, p1_score, p2_score,
     result, table_number)
standing(tournament_id, player_id, rank, wins, losses, draws, tiebreak)
```

**Gold — Auswertungs-Views** (materialisiert, nächtlich):
`faction_window_stats`, `matchup_matrix`, `unit_usage`, `unit_cooccurrence`, `archetype_cluster`.

**Alles trägt `ruleset_version`.** Ein Dataslate oder MFM-Update macht ältere Daten nicht wertlos, aber nicht mehr direkt vergleichbar — die Version ist deshalb kein Metadatum, sondern Teil des Schlüssels.

---

## 3. Ranking: die Statistik ernst nehmen

Hier entscheidet sich, ob die App besser ist als eine Excel-Tabelle. Vier bekannte Fallstricke und ihre Behandlung:

**(a) Kleine Stichproben.** Eine Fraktion mit 12 Spielen und 75 % Winrate steht nicht oben. → **Bayesianisches Shrinkage** mit Beta-Prior auf 50 % (`Beta(α₀, α₀)`, α₀ ≈ 25 Spiele), zusätzlich **Wilson-Konfidenzintervall**. Im UI wird *nie* eine Winrate ohne n und CI gezeigt. Unter einem Schwellwert (z. B. n < 50 im Fenster) wird nicht gerankt, sondern „zu wenig Daten" angezeigt.

**(b) Skill-Confound.** Starke Spieler wählen starke Fraktionen — und umgekehrt spielen manche Fraktionen überproportional oft ambitionierte Spieler. Reine Winrate misst das mit. → **Gemeinsames logistisches Modell** über alle Einzelspiele:

```
P(Spieler i schlägt Spieler j) = σ( θᵢ − θⱼ + βfaction(i) − βfaction(j) )
```

`θ` = latente Spielerstärke (Bradley-Terry/Elo-artig), `β` = Fraktionseffekt. Geschätzt als Mixed-Effects-Logit (Spieler als Random Effect, Fraktion als Fixed Effect), z. B. mit `statsmodels`/`pymc` oder einer eigenen L2-regularisierten MLE. Ergebnis: **„Fraktionseffekt bei gleicher Spielerstärke"** — die ehrlichste Einzelzahl, die man aus Turnierdaten ziehen kann.

**(c) Schweizer System verzerrt Paarungen.** Gute Fraktionen treffen in späten Runden auf gute Fraktionen, ihre Winrate wird gedrückt. → Rundennummer und Tischnummer als Kovariablen; die Matchup-Matrix wird aus tatsächlichen Paarungen gebaut, nicht aus Marginalen hochgerechnet.

**(d) Zeit.** Das Meta bewegt sich. → **Exponentielle Recency-Gewichtung** (Halbwertszeit konfigurierbar, Default ~6 Wochen) **plus harte Schnitte an Balance-Dataslates**. Standardfenster: „seit letztem Dataslate".

**Ausgegebene Kennzahlen je Fraktion/Detachment:**
`n Spiele` · `rohe WR ± CI` · `skill-bereinigter Effekt` · `Meta-Anteil` · `Top-Cut-Rate` · `X-0-Rate` · `Ø-Platzierung (perzentilnormiert, damit Turniergrößen vergleichbar sind)` · `Trend ggü. Vorfenster`.

Turniergewichtung: `w = f(Spielerzahl, Rundenzahl, GT/Major-Status)`, gedeckelt, damit ein einzelnes Großturnier nicht das Fenster dominiert.

**Einheiten-Ebene** ist statistisch deutlich schwieriger als Fraktions-Ebene: „Einheit X hat 58 % Winrate" misst meistens nur, dass X in einer starken Fraktion steht. Deshalb:
- Vergleich **innerhalb** von Fraktion + Detachment + Zeitfenster, nie global.
- **L2-regularisierte Logit-Regression** auf Listen-Vektoren (Einheit-Indikatoren) → Koeffizient statt Rohdifferenz.
- Zusätzlich stabiler und ehrlicher: **Inklusionsrate gewichtet nach Platzierung** („in 71 % der Top-8-Listen, in 34 % aller Listen") — weniger anfällig als jede Winrate-Zuschreibung.
- Neue Einheiten: Cold-Start explizit ausweisen, nicht kaschieren.

---

## 4. Synergie-Erkennung

Zwei unabhängige Signalfamilien, die getrennt berechnet und erst am Ende gewichtet zusammengeführt werden — sonst kann man nie sagen, *warum* etwas empfohlen wurde.

### 4.1 Regelbasiert (deduktiv, aus Wahapedia)

Ziel: eine **Effekt-Graph**-Darstellung jeder Einheit. Aus `Datasheets_abilities.description`, `Datasheets_wargear` und `Datasheets_keywords` werden strukturierte Effekte extrahiert:

```
provides: reroll_hits(aura:6"), plus1_to_wound(target:CHAOS), lethal_hits,
          transport(capacity:10, keywords:[INFANTRY]), deep_strike, stealth,
          fights_first, invuln_grant(5+), leader_attach([id...])
requires: melee_delivery, high_volume_shots, character_protection
```

Extraktion: Regex/Keyword-Matching für die ~150 wiederkehrenden Formulierungen (Core Abilities sind hochgradig standardisiert), LLM-gestützte Extraktion nur für den Rest — Ergebnis wird **als geprüfte Datei ins Repo committet**, nicht zur Laufzeit generiert (reproduzierbar, review-bar, kostenlos im Betrieb).

Synergie = **Angebot-Nachfrage-Matching**: eine langsame Nahkampfeinheit mit `requires: melee_delivery` + ein Transport mit passender `capacity` und Keyword-Kompatibilität = harte, beweisbare Synergie. `leader_attach` und Enhancement-Zuordnung kommen ohne jede Heuristik direkt aus den CSVs.

### 4.2 Empirisch (induktiv, aus Turnierlisten)

- **Lift / PMI** innerhalb Fraktion+Detachment: `lift(A,B) = P(A,B) / (P(A)·P(B))`.
- **Erfolgsbedingter Lift**: Co-Occurrence in Top-25-%-Listen vs. in allen Listen — trennt „wird oft zusammen gespielt" von „gewinnt oft zusammen".
- **Frequent Itemset Mining** (FP-Growth) für 2er- bis 4er-Kombinationen mit Mindest-Support.
- **Confound-Kontrolle:** Wenn A und B beide für sich stark sind, erscheinen sie zusammen — ohne echte Interaktion. Deshalb zusätzlich ein Modell mit Interaktionsterm; berichtet wird der **Interaktionskoeffizient**, nicht der rohe Lift.

### 4.3 Zusammenführung

`synergy_score = w₁ · regel_score + w₂ · empirie_score`, mit getrennter Anzeige beider Komponenten. Eine Kombination, die regeltechnisch stark ist, aber empirisch nie gespielt wird, ist ein interessanter Hinweis — kein Fehler. Eine, die empirisch stark ist und regeltechnisch unerklärlich, ist meist ein Confound-Artefakt und wird niedriger gewichtet.

---

## 5. Der Listen-Generator

### 5.1 Harte Regeln (nicht verhandelbar, Constraint-Layer)

Punktelimit · Detachment-Legalität · Rule of Three · Battleline-Mindestanforderungen · Epic-Hero-Einzigartigkeit · Enhancement-Regeln (max. 3, je einmal, nur an nicht-Epic-Hero-Charaktere, nur erlaubte Datasheets) · Transportkapazität · Leader-Anschluss nur gemäß `leader_attach` · gültiger MFM-Stand.

Eine generierte Liste, die irgendeine dieser Regeln bricht, ist wertlos — deshalb Validierung als eigener, testbarer Service, der auch **importierte** Listen prüfen kann (eigenständiges Feature: „ist meine Liste legal?").

### 5.2 Weiche Ziele (Objective-Layer)

- Synergie-Score (§4)
- Meta-Prior je Einheit (§3)
- **Rollenabdeckung** als Vektor: Anti-Tank, Anti-Horde, Anti-Elite, Objective Control (OC), Screening, Board Control/Deployment, Secondary-Scoring/Actions, Haltbarkeit, Reichweite. Jede Einheit bekommt aus den Profildaten ein Rollenprofil (z. B. erwarteter Schaden gegen T5/Sv3+ vs. T10/Sv2+/4++ — direkt aus `Datasheets_wargear` berechenbar). Lücken im Vektor kosten Punkte in der Bewertung.
- **Matchup-Abdeckung**: gewichtet gegen die aktuellen Top-N-Fraktionen des Metas.

### 5.3 Algorithmus — pragmatisch statt puristisch

Reine Generierung „aus dem Nichts" per Solver produziert legale, aber unsinnige Listen. Der deutlich bessere Weg:

1. **Archetyp-Seeding:** Echte erfolgreiche Listen der Fraktion aus dem Zeitfenster clustern (k-Medoids auf Einheiten-Vektoren) → 3–6 Archetypen mit gemeinsamem „Kern" und variablen „Flex-Slots".
2. **Kern fixieren, Flex optimieren:** CP-SAT (OR-Tools) füllt die Flex-Punkte unter allen harten Constraints und maximiert die lineare Zielkomponente.
3. **Lokale Suche / Simulated Annealing** auf den quadratischen Synergie-Termen (die ein ILP nicht sauber abbildet): Tauschoperationen, bis keine Verbesserung mehr.
4. **Diversifizierung:** k verschiedene Vorschläge mit erzwungenem Mindestabstand, statt fünfmal derselben Liste.

Zusätzlicher Modus, der im Alltag wahrscheinlich der meistgenutzte wird: **„Fülle mir die letzten 240 Punkte"** — der Nutzer gibt seine bestehende Liste ein, der Optimizer arbeitet nur auf dem Rest. Deutlich nützlicher als eine Liste vom Reißbrett.

### 5.4 Erklärbarkeit (Pflicht, nicht Kür)

Jeder Vorschlag liefert Begründungen mit:
> *Warum diese Einheit?* — In 71 % der Top-8-Listen dieses Detachments (n = 143, letzte 6 Wochen).
> *Warum diese Kombination?* — Charakter X kann sich anschließen (Regel) und gewährt Lethal Hits; zusammen in 64 % der Listen, Interaktionskoeffizient +0,18.
> *Was fehlt der Liste?* — Anti-Tank-Abdeckung im unteren Quartil vergleichbarer Listen.

Ohne diese Ebene ist der Generator eine Blackbox, der niemand vertraut.

---

## 6. Das größte technische Risiko: Listen-Parsing

Turnierlisten kommen als Freitext aus mindestens vier Quellen (GW-App, New Recruit, BattleScribe, handgetippt) in unterschiedlichen Formaten, mit Tippfehlern, Spitznamen („Bricks", „Wraithlord x2"), fehlenden Punkten und abgeschnittenen Zeilen.

Pipeline: **Normalisieren** (Unicode, Casing, Sonderzeichen, Mengenangaben) → **Alias-Tabelle** (gepflegte Community-Synonyme) → **Fuzzy-Match** (`rapidfuzz`, Token-Set-Ratio) **fraktionsbeschränkt** (halbiert die Fehlerquote sofort) → **Punkte-Plausibilisierung** (Summe muss zum Limit passen; das ist ein starkes Korrektursignal) → **Review-Queue** für alles unter Schwellwert.

Strukturierte Formate (`.ros`/`.rosz`, New-Recruit-JSON) werden vorrangig geparst, wenn verfügbar — dort ist die Datasheet-ID direkt enthalten.

**Match-Rate ist eine Produktmetrik**, die im Dashboard steht (Ziel ≥ 95 %). Nicht zugeordnete Zeilen werden mitgezählt und verwässern sonst still alle Statistiken.

---

## 7. Technischer Stack

| Ebene | Wahl | Begründung |
|---|---|---|
| Backend/API | **Python 3.12 + FastAPI** | Die Statistik (statsmodels, pandas, scikit-learn) und der Solver (OR-Tools) sind Python-nativ. Alles in TypeScript zu bauen hieße, die Kernkompetenz der App in der schwächeren Umgebung zu schreiben. |
| DB | **PostgreSQL** (+ DuckDB für Analytics-Jobs) | JSONB für Bronze, relational für Silver, materialisierte Views für Gold |
| Jobs/ETL | APScheduler oder Prefect, idempotent, mit `content_hash`-Dedupe | Nächtlicher Ingest + Recompute |
| Cache/Queue | Redis | Rate-Limiting der Ingestion, teure Generator-Läufe |
| Frontend | **Next.js + TypeScript + Tailwind + shadcn/ui**, TanStack Query | |
| Charts | Recharts oder visx | Matchup-Matrix als Heatmap, Trend-Linien mit CI-Bändern |
| Deploy | Docker Compose → Fly.io/Hetzner, Postgres bei Neon/Supabase | |
| Tests | pytest (Constraint-Validator + Parser mit echten Beispiel-Listen als Fixtures), Playwright für die kritischen UI-Flows | |

API-Skizze:
```
GET  /api/factions/rankings?window=since_dataslate&format=2000_gt
GET  /api/factions/{id}/matchups
GET  /api/units/{id}/stats?faction=&detachment=
GET  /api/units/{id}/synergies
GET  /api/lists?faction=&placement=top8&since=
POST /api/lists/validate      { list_text | roster_file }
POST /api/lists/generate      { faction, detachment, points, locked_units[], style }
POST /api/import/tournament   { csv | json }        # TO-/Manuell-Upload
```

---

## 8. Roadmap

| Phase | Inhalt | Ergebnis | Aufwand* |
|---|---|---|---|
| **0** | Repo, Docker, Schema, Wahapedia-ETL, 11ed-Datenvalidierung (§1.1) | Vollständige Regel-DB, per Cron aktuell | ~1 Woche |
| **1** | Turnier-Ingest (mind. Manuell-Import), Normalisierung, Fraktions-Ranking mit CI + Recency | Erste nutzbare Ranking-Seite | ~2 Wochen |
| **2** | Listen-Parser + Einheiten-Statistik, Match-Rate-Dashboard | Einheiten-Ebene wird auswertbar | ~2 Wochen |
| **3** | Skill-bereinigtes Modell (Bradley-Terry + Fraktionseffekt), Matchup-Matrix | Der eigentliche statistische Mehrwert | ~1,5 Wochen |
| **4** | Synergie-Engine: Regel-Extraktion + empirisches Mining | Synergie-Explorer im UI | ~2,5 Wochen |
| **5** | Constraint-Validator + Generator (Seeding → CP-SAT → Local Search) | Listen-Generator mit Begründungen | ~3 Wochen |
| **6** | UI-Politur, Teilen/Export, Performance, Zugriffsschutz | v1 | ~2 Wochen |

\* Aufwand für eine Person, nebenbei; die Zahlen sind Größenordnungen, keine Zusagen.

**Sinnvoller MVP-Schnitt (Phase 0–2):** Regel-DB + Fraktionsranking mit ehrlichen Konfidenzintervallen + Einheiten-Inklusionsraten. Das ist für sich genommen schon nutzbar und liefert die Datenbasis, ohne die Phase 3–5 ohnehin nicht funktionieren.

---

## 9. Risiken und wie sie behandelt werden

| Risiko | Behandlung |
|---|---|
| **Turnierdaten-Zugang bricht weg** (BCP-ToS, API-Änderung) | `SourceAdapter`-Abstraktion; Manuell-Import von Tag 1; zuerst offiziell um Zugang fragen |
| **GW-IP / Regeltexte** | Keine Volltext-Regeln ausliefern, nur abgeleitete Tags + Deep-Links; Wahapedia-Attribution |
| **Listen-Parsing unter 90 %** | Alias-Tabelle als gepflegte Repo-Datei, Review-Queue, strukturierte Formate bevorzugen; Match-Rate sichtbar machen |
| **Statistische Fehlschlüsse** (Confounds, kleine n) | Shrinkage, CIs, Mindest-n, skill-bereinigtes Modell, Einheiten-Stats nur innerhalb Fraktion+Detachment |
| **Regel-/Punkte-Churn** | `ruleset_version` überall im Schlüssel; Auswertungsfenster an Dataslates ausgerichtet |
| **Generator produziert legale, aber unsinnige Listen** | Archetyp-Seeding aus echten Top-Listen statt Generierung auf der grünen Wiese |
| **Scope-Explosion** | Phase 0–2 als eigenständig auslieferbarer MVP definiert |

---

## 10. Offene Entscheidungen

1. **Datenzugang:** Bestehen bereits Beziehungen zu einem TO / BCP-Account / TableTopTO? Das bestimmt, ob Phase 1 zwei Tage oder zwei Wochen dauert.
2. **Generator-Tiefe:** Vollautomatische Listen oder eher Assistent („fülle die restlichen Punkte", „bewerte meine Liste")? Der Assistent-Modus ist billiger und im Alltag vermutlich nützlicher.
3. **Stack:** Python-Backend + Next.js-Frontend (Empfehlung) oder alles in TypeScript (einfacher zu deployen, aber Statistik/Solver werden mühsam)?
4. **Zielgruppe:** Privates Werkzeug (self-hosted, kein Auth, keine Rechtsfragen bei Weiterveröffentlichung) oder öffentliche Web-App (dann Auth, Rate-Limits, ToS-Klärung und Attribution zwingend)?
5. **Umfang:** Nur 40k, oder soll die Architektur AoS gleich mittragen? (Wahapedia exportiert beides — als Parameter mitzudenken kostet in Phase 0 fast nichts, nachträglich viel.)
6. **Format-Fokus:** 2000 Pkt. GT/WTC als Standard, oder auch 1000 Pkt./Combat Patrol?

---

## Quellen

- [Wahapedia Data Export](https://wahapedia.ru/wh40k11ed/the-rules/data-export/) · [Export Data Specs](https://wahapedia.ru/wh40k10ed/Export%20Data%20Specs.xlsx)
- [BSData/wh40k-11e](https://github.com/BSData/wh40k-11e) · [BSData/wh40k-11e-mfm](https://github.com/BSData/wh40k-11e-mfm) · [BSData](https://www.bsdata.net/)
- [Best Coast Pairings](https://www.bestcoastpairings.com/) · [Community-Scraper (Referenz)](https://github.com/specialprocedures/best-coast-pairings)
- [TableTopTO](https://www.tabletopto.com/) · [Listhammer](https://listhammer.info/) · [Stat Check](https://www.stat-check.com/the-meta) · [Warp Friends Meta Stats](https://warpfriends.wordpress.com/)

*Regeldaten powered by Wahapedia. Warhammer 40.000 ist geistiges Eigentum von Games Workshop; dieses Projekt steht in keiner Verbindung zu Games Workshop.*
