# Projektplan: Warhammer 40.000 Meta-Ranking & Listen-Generator

**Arbeitstitel:** `warhammer-meta` — eine Web-App, die (A) Turnierergebnisse verschiedener Quellen einsammelt, normalisiert und Fraktionen/Detachments/Einheiten statistisch sauber rankt, und (B) daraus plus den echten Regeldaten einen erklärbaren Listen-Generator speist.

Stand der Recherche: 09.08.2026. Alle unten genannten Datenquellen wurden live geprüft (HTTP-Status, Schema, Feldnamen, `robots.txt`), nicht aus dem Gedächtnis zitiert.

**Getroffene Entscheidungen:**

| Frage | Entscheidung |
|---|---|
| **Zielgruppe** | **Privates, self-gehostetes Werkzeug** für den eigenen Gebrauch — keine öffentliche Instanz. Diese Antwort entscheidet zugleich die Regeltext-Frage (§1.1, §6.3) und entschärft §1.4 teilweise. |
| **Regeltexte** | **Volltext aus dem Wahapedia-Export**, lokal angezeigt (`RULES_TEXT_MODE=full` als Default, §6.3). `derived` bleibt als Schalter erhalten und ist zwingend umzulegen, falls je eine öffentlich erreichbare Instanz entsteht. |
| Turnierdaten | Scraping-Weg prüfen und, soweit zulässig, nutzen — Details und Auflagen in §1.4. Manuell-Import wird trotzdem zuerst gebaut. |
| Generator | Beides, **Assistent zuerst** (v1: bewerten/ergänzen), Vollautomatik in v2 auf demselben Constraint- und Synergie-Code. |
| Stack | **Python/FastAPI + PostgreSQL + Next.js** (Begründung in §8). |
| Listenbuilder | Interaktive Arbeitsfläche statt Formular; Klick auf eine Einheit öffnet ihre vollständigen Regeln im Seitenpanel (§6). |
| Repo | `main` als Default-Branch, Arbeit läuft über Pull Requests. |

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

Auflagen: Wahapedia bittet um Nennung („powered by Wahapedia"). Das ist einzuhalten — durchgängig, inklusive Deep-Link auf die jeweilige Quellseite.

Zu den Regeltexten: Wahapedia formuliert sie eigenständig aus, sie sind keine Scans oder Copy-Paste aus den Büchern. **Das allein macht sie aber nicht frei** — der Regelinhalt bleibt GW-IP, und Wahapedia bewegt sich damit selbst in einer Grauzone. Entscheidend ist deshalb nicht die Herkunft der Formulierung, sondern der Nutzungsrahmen: Für die entschiedene **private, self-gehostete Instanz** werden die Texte lokal vollständig angezeigt (§6.3) — eine Kopie öffentlich angebotener Exportdaten für den eigenen Bedarf, die niemandem sonst ausgeliefert wird. Für eine öffentlich erreichbare Instanz gilt unverändert die engere Linie: nur abgeleitete Tags und Verlinkungen. Dafür existiert der Schalter in §6.3.

⚠️ **Validierungsaufgabe in Phase 0:** Der `wh40k11ed`-Export liefert HTTP 200, aber `Last_update` steht auf 2026-05-09 und die `link`-Spalten zeigen teils noch auf `/wh40k10ed/`-Pfade; die Dateigrößen von 10ed und 11ed sind fast identisch. Vor Projektstart muss stichprobenartig gegen die Website geprüft werden, ob der 11ed-Export inhaltlich schon vollständig auf 11. Edition steht. Falls nein: MFM/Dataslate-Quelle (unten) wird zur führenden Punktequelle, Wahapedia bleibt für Profile/Fähigkeiten.

### 1.2 Punkte & Balance-Stände

- **BSData/wh40k-11e-mfm** — geparste Snapshots des Munitorum Field Manual von `mfm.warhammer-community.com`. Vorteil: versioniert, mit Historie — genau das, was für „welche Punkte galten bei diesem Turnier?" gebraucht wird.
- Fallback/Ergänzung: `Datasheets_models_cost.csv` von Wahapedia.

### 1.3 Listen-Struktur zum Parsen

- **BSData/wh40k-11e** — Community-Katalogdateien (XML, BattleScribe-/New-Recruit-Format). Damit lassen sich exportierte Rosters (`.rosz`/`.ros`, New-Recruit-JSON) *strukturiert* einlesen statt Freitext zu raten.
- **GW-App-Textexport** und handgetippte Listen: nur als Freitext verfügbar → Parser (siehe §7).

### 1.4 Turnierergebnisse — der heikle Teil

| Quelle | Zugang | Bewertung |
|---|---|---|
| **Best Coast Pairings** | Kein dokumentiertes öffentliches API. Es existiert eine interne API (AWS API Gateway, z. B. `eventlistings`, `pairings`), gegen die Community-Skripte laufen (z. B. `specialprocedures/best-coast-pairings`) | Größter Datenbestand, aber **rechtlich der kritische Punkt** — undokumentierte Endpunkte sind kein Freibrief |
| **TableTopTO** (tabletopto.com) | Bietet laut Anbieter „comprehensive exports" und öffentliche Standings | Sauberster Weg, wenn Export/Partner-Zugang erreichbar |
| **Listhammer** (listhammer.info) | Aggregiert Listen+Ergebnisse, blockt Bots (HTTP 403) | Nur als Cross-Check / Plausibilisierung |
| **Stat Check**, **Warp Friends** | Veröffentlichte Meta-Auswertungen | Referenzwerte zum Validieren der eigenen Zahlen |
| **Manueller/TO-Upload** | CSV/JSON-Import in der eigenen App | Immer bauen — als Fallback und für lokale Turniere |

#### Entschiedener Weg: Scraping, aber geprüft

`robots.txt`-Befunde vom 09.08.2026:

| Host | `robots.txt` | Folge |
|---|---|---|
| `bestcoastpairings.com` | `User-agent: * / Disallow:` — leerer Disallow, also **keine Crawling-Einschränkung** | Robots-seitig zulässig |
| `www.tabletopto.com` | HTTP 404, keine Datei | Keine ausgesprochene Einschränkung |
| `listhammer.info` | Cloudflare Content Signals: `search=yes, ai-train=no, use=reference`, blockt Bots mit HTTP 403 | **Nicht scrapen.** Nur als manuelle Referenz zum Plausibilisieren eigener Zahlen |
| `wahapedia.ru` | Einschränkungen nur für `YandexBot`; CSV-Export wird ausdrücklich angeboten | Export nutzen, Attribution setzen |

⚠️ **`robots.txt` ist nicht die AGB.** Die BCP-Terms liegen unter `/eula` bzw. `/privacy`, sind aber clientseitig gerendert und maschinell nicht auslesbar — sie wurden im Rahmen dieser Recherche **nicht** geprüft. **Erste Aufgabe in Phase 1**, vor der ersten Zeile Scraper-Code: `/eula` und `/privacy` im Browser lesen und auf Klauseln zu *automated access, scraping, data mining, commercial reuse* prüfen. Findet sich eine Verbotsklausel, gilt der Weg als versperrt und der Import-/Anfrage-Pfad übernimmt — die Architektur (unten) fängt das ohne Umbau ab.

Verbindliche Auflagen für den Scraper, sobald er läuft:
- Rate-Limit deutlich unter dem, was die Seite spürt (Richtwert ≤ 1 Request/Sekunde, nachts, mit Backoff bei 429/5xx)
- Aussagekräftiger User-Agent mit Kontaktadresse — kein Tarnen als Browser
- Aggressives Caching über `content_hash`; jedes Turnier wird genau einmal geholt, danach nur noch Deltas
- Rohdaten bleiben lokal; veröffentlicht werden **nur Aggregate**, keine Kopie fremder Datenbestände
- Keine personenbezogenen Daten über den Spielernamen hinaus; Namen im öffentlichen UI pseudonymisierbar
- Ein Schalter, der die Quelle in einer Minute abschaltet, wenn der Betreiber widerspricht

Die Entscheidung für eine private, self-gehostete Instanz entschärft hier die *Weiterveröffentlichungs*-Frage — die Rohdaten bleiben ohnehin lokal und es gibt niemanden, an den etwas ausgeliefert würde. **Sie ersetzt die ToS-Prüfung aber nicht:** Ein Verbot automatisierten Zugriffs greift unabhängig davon, ob die geholten Daten je jemand anderes zu sehen bekommt. Die Prüfung bleibt damit erste Aufgabe in Phase 1.

Parallel dazu — nicht statt dessen: **Manuell-Import ab Tag 1** und eine formlose Anfrage nach offiziellem Export-/API-Zugang bei BCP und TableTopTO. Ein „ja" ersetzt den ganzen Scraper und macht das Rechtsthema gegenstandslos.

Die gesamte Ingestion liegt hinter einem `SourceAdapter`-Interface. Der Quellenzugang ist damit eine austauschbare Komponente und keine Architekturentscheidung — fällt BCP weg, kippt nicht das Projekt.

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
`faction_window_stats`, `matchup_matrix`, `unit_usage`, `unit_cooccurrence`, `archetype_cluster`,
`datasheet_card` (denormalisiertes Read-Model für den Regel-Inspektor — Begründung in §6.4).

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

### 5.3 Ausbaustufen: Assistent zuerst, Vollautomatik danach

**v1 — Assistent.** Der Nutzer bringt eine Liste mit (Text oder Roster-Datei) oder baut sie direkt im Listenbuilder (§6). Die App:
1. parst und validiert sie gegen alle harten Regeln (§5.1),
2. zeigt das Rollenprofil und markiert Lücken gegen vergleichbare erfolgreiche Listen,
3. weist auf ungenutzte Synergien hin („dieser Charakter könnte sich an X anschließen"),
4. füllt auf Wunsch die restlichen Punkte („fülle mir die letzten 240 Punkte").

Das ist der Modus, der im Alltag am häufigsten gebraucht wird, und er benötigt vom Optimizer nur den Teilraum der freien Punkte — also deutlich weniger Suchaufwand.

**v2 — Vollautomatik.** Komplette Liste aus Fraktion + Detachment + Punktelimit. Nutzt exakt denselben Constraint-Validator, dieselben Synergie-Scores und denselben Optimizer, nur mit leerer Startliste und größerem Suchraum. Der Aufwand steckt fast vollständig in v1; v2 ist danach vor allem eine Frage von Suchbudget und Ergebnis-Diversifizierung.

### 5.4 Algorithmus — pragmatisch statt puristisch

Reine Generierung „aus dem Nichts" per Solver produziert legale, aber unsinnige Listen. Der deutlich bessere Weg:

1. **Archetyp-Seeding:** Echte erfolgreiche Listen der Fraktion aus dem Zeitfenster clustern (k-Medoids auf Einheiten-Vektoren) → 3–6 Archetypen mit gemeinsamem „Kern" und variablen „Flex-Slots".
2. **Kern fixieren, Flex optimieren:** CP-SAT (OR-Tools) füllt die Flex-Punkte unter allen harten Constraints und maximiert die lineare Zielkomponente.
3. **Lokale Suche / Simulated Annealing** auf den quadratischen Synergie-Termen (die ein ILP nicht sauber abbildet): Tauschoperationen, bis keine Verbesserung mehr.
4. **Diversifizierung:** k verschiedene Vorschläge mit erzwungenem Mindestabstand, statt fünfmal derselben Liste.

Im Assistenten-Modus (v1) entfallen Schritt 1 und 2 weitgehend: der „Kern" ist die vom Nutzer gesperrte Liste, optimiert wird nur der Rest.

### 5.5 Erklärbarkeit (Pflicht, nicht Kür)

Jeder Vorschlag liefert Begründungen mit:
> *Warum diese Einheit?* — In 71 % der Top-8-Listen dieses Detachments (n = 143, letzte 6 Wochen).
> *Warum diese Kombination?* — Charakter X kann sich anschließen (Regel) und gewährt Lethal Hits; zusammen in 64 % der Listen, Interaktionskoeffizient +0,18.
> *Was fehlt der Liste?* — Anti-Tank-Abdeckung im unteren Quartil vergleichbarer Listen.

Ohne diese Ebene ist der Generator eine Blackbox, der niemand vertraut.

---

## 6. Der Listenbuilder — Arbeitsfläche mit Regel-Inspektor

Der Generator (§5) schlägt vor; der **Builder** ist die Fläche, auf der tatsächlich gearbeitet wird. Er ist keine eigene Engine, sondern die Oberfläche, an der Constraint-Validator (§5.1), Rollenprofil (§5.2), Synergie-Scores (§4) und Meta-Zahlen (§3) anfassbar werden. Zwei Dinge entscheiden, ob er benutzt wird: **er muss beim Bauen mitdenken statt erst auf Knopfdruck**, und **er muss die Regeln zeigen, ohne dass man ihn verlässt**.

### 6.1 Was „besser" konkret heißt

Der übliche Listenbuilder ist ein Formular mit Punktezähler. Die konkreten Abweichungen davon:

| Verbesserung | Warum |
|---|---|
| **Live-Validierung bei jeder Änderung** statt „Prüfen"-Button | Fehler beim Entstehen sehen, nicht zwanzig Minuten später. Der Validator aus §5.1 läuft inkrementell auf dem Patch, nicht jedes Mal auf der ganzen Liste. |
| **Fehler ≠ Warnung** | Harte Regelbrüche (§5.1) blockieren den Export und sind rot; weiche Hinweise (Rollenlücke, ungenutzte Synergie) sind gelb und dürfen ignoriert werden. Ein Builder, der bevormundet, wird umgangen. |
| **Kontextsensitiver Katalog** | Die Einheitenauswahl wird nach „passt zu dem, was schon drin steht" sortiert (Synergie-Score gegen die aktuelle Liste) statt alphabetisch — mit sichtbarem Umschalter auf Rolle, Punkte, Name, Inklusionsrate. |
| **Nur legale Ziele anbieten** | Leader-Anschluss, Transport-Zuweisung und Enhancements werden per Drag & Drop bzw. Auswahl gesetzt; angeboten wird ausschließlich, was `Datasheets_leader`, die Transportkapazität und `Datasheets_enhancements` hergeben. Was der Builder anbietet, darf der Validator nie ablehnen (Testkriterium, §6.7). |
| **Budgetleiste mit Vorschau** | Verbraucht / frei / über Limit — und beim Überfahren eines Katalogeintrags die Vorschau „danach: 1.870 / 2.000". |
| **Rollenprofil läuft mit** | Das Radar aus §5.2 aktualisiert sich live; Lücken gegenüber vergleichbaren erfolgreichen Listen sind während des Bauens sichtbar, nicht erst in einem Bericht am Ende. |
| **Undo/Redo und benannte Stände** | Listenbau ist Ausprobieren. Ohne Undo probiert niemand aus. |
| **Vorschläge als Patch übernehmen** | Jede Generator-Empfehlung (§5.3) erscheint als Diff auf die Liste mit „Übernehmen" / „Verwerfen" — kein Moduswechsel, kein Neuladen. |
| **Local-first mit Autosave** | Der Builder-State liegt im Browser (§6.5); ein Verbindungsabbruch kostet keine Liste. Sync und Teilen sind optional obendrauf. |
| **Export ohne Umweg** | Klartext im GW-App-Stil, New-Recruit-kompatibles JSON, Teilen-Link. Der eigene Parser (§7) muss den eigenen Export fehlerfrei zurücklesen — der billigste Dauertest, den der Parser bekommen kann. |

### 6.2 Der Regel-Inspektor: Klick auf eine Einheit zeigt ihre Regeln

**Die Interaktion.** Ein Klick (Desktop) bzw. Tap (Mobil) auf eine Einheit — in der Liste *oder* im Katalog — öffnet den Inspektor: auf dem Desktop als Seitenpanel rechts, auf dem Mobilgerät als Bottom Sheet. **Die Liste bleibt dabei sichtbar.** Das ist kein Layout-Detail: Regeln liest man beim Listenbau immer *vergleichend*, und jede Navigation, die die Liste verdeckt, reißt den Gedanken ab. Erneuter Klick oder `Esc` schließt; ein Pin hält das Panel offen, während weitergebaut wird.

**Inhalt in fester Reihenfolge** — das Wichtigste zuerst, Details aufklappbar:

| # | Abschnitt | Quelle |
|---|---|---|
| 1 | Kopf: Name, Punkte für die gewählte Truppgröße, Rolle, Fraktions- und Einheiten-Keywords als Chips | `Datasheets`, `Datasheets_models_cost`, `Datasheets_keywords` |
| 2 | Profilwerte je Modellzeile: M, T, Sv, Inv, W, Ld, OC, Basegröße | `Datasheets_models` |
| 3 | Waffen, getrennt nach Fern- und Nahkampf: Range, A, BS/WS, S, AP, D plus Waffen-Keywords | `Datasheets_wargear` |
| 4 | Fähigkeiten, gruppiert nach Core / Faction / Detachment / Datasheet / Wargear | `Datasheets_abilities.type`, `Abilities` |
| 5 | Schadensprofil („Damaged: 1–4 Wounds Remaining") | `Datasheets.damaged_w`, `damaged_description` |
| 6 | **Anschluss:** welche Charaktere sich anschließen dürfen bzw. an welche Einheiten dieser Charakter darf — jeder Eintrag klickbar und springt in den Inspektor der Zieleinheit | `Datasheets_leader` |
| 7 | Transport: Kapazität und zugelassene Keywords | `Datasheets.transport` |
| 8 | Im gewählten Detachment erlaubte Enhancements mit Kosten | `Datasheets_enhancements`, `Enhancements` |
| 9 | Auf diese Einheit anwendbare Stratagems (Keyword- und Detachment-Abgleich) | `Stratagems`, `Detachment_abilities` |
| 10 | Truppstärken und Ausrüstungsoptionen | `Datasheets_unit_composition`, `Datasheets_options` |
| 11 | **Meta-Kontext**, optisch klar abgesetzt: Inklusionsrate mit n und CI, Trend, Synergie-Hinweise bezogen auf die *aktuelle* Liste | §3, §4 |
| 12 | Fußzeile: Quelle, Errata-Stand, MFM-Version, Deep-Link zu Wahapedia | `Source`, `Last_update` |

Abschnitt 11 steht bewusst unten und optisch getrennt: **Regeln sind Fakten, Statistik ist Meinung mit Fehlerbalken.** Beides im selben Panel zu vermischen wäre genau der Fehler, den §3 sonst überall vermeidet.

Die Abschnitte 6 bis 9 sind der eigentliche Gewinn gegenüber dem Nachschlagen auf einer Regelseite. Sie beantworten nicht „was kann diese Einheit", sondern „was kann diese Einheit **in dieser Liste**": Anschlussziele werden gegen den tatsächlichen Listeninhalt markiert („bereits enthalten"), Enhancements gegen das gewählte Detachment gefiltert, Stratagems gegen dessen Regeln.

### 6.3 Anzeigetiefe der Regeltexte — Volltext lokal, Schalter für den Ernstfall

**Entschieden: Der Inspektor zeigt die Regeltexte vollständig**, direkt aus dem Wahapedia-Export. `RULES_TEXT_MODE=full` ist der Default. Alles andere verfehlt den Zweck — ein Panel, das bei einer Fähigkeit nur den Namen zeigt, spart genau den Blick nicht ein, für den es gebaut wurde, und die halbe Lösung („Kurzform plus Link") wäre in der Praxis dauernd ein Klick zu wenig.

Zur Begründung, weil sie im Plan sonst falsch abgelegt wäre: Wahapedia schreibt die Regeln eigenständig aus, aber **daraus folgt keine Freigabe** — der Inhalt bleibt GW-IP, und Wahapedia selbst steht damit in einer Grauzone. Was den Fall trägt, ist der Nutzungsrahmen: eine **self-gehostete Instanz für den privaten Gebrauch** verbreitet nichts. Sie hält öffentlich angebotene Exportdaten lokal vor und zeigt sie einer Person — derjenigen, die sie betreibt. Das ist eine andere Lage als eine öffentliche Web-App, die dieselben Texte an Dritte ausliefert. Genau diese Unterscheidung war schon vorher die entscheidende Achse des Plans; sie ist jetzt beantwortet statt offen.

Der Schalter bleibt deshalb erhalten, nur mit umgekehrtem Default:

| | `full` — **Default**, private self-gehostete Instanz | `derived` — Pflicht, sobald öffentlich erreichbar |
|---|---|---|
| Profil- und Waffenwerte | ja | ja; ohne diese Zahlen ist ein Builder wertlos |
| Fähigkeiten | **Volltext** aus der lokalen DB | Name + generierte Kurzform aus den Effekt-Tags (§4.1), z. B. „Reroll Hits (Aura 6″)", „Lethal Hits", „+1 to Wound vs. CHAOS" |
| Stratagems / Enhancements | **Volltext**, mit CP- bzw. Punktkosten, Phase, Timing | Name, Kosten, Phase, Timing-Tag |
| in beiden Modi | Attributionszeile „powered by Wahapedia" sichtbar im Panel, Deep-Link auf die Quellseite samt Anker, `Source`- und Errata-Stand in der Fußzeile | dito |

Zwei Dinge, die daran hängen:

- **Der `derived`-Pfad verkümmert nicht zur toten Konfiguration.** Die Effekt-Tags entstehen für die Synergie-Erkennung (§4.1) ohnehin, und der Inspektor rendert sie im Meta-Abschnitt auch im `full`-Modus. Der Modus schaltet nur, ob daneben der Volltext steht. Damit ist `derived` jederzeit funktionsfähig, ohne dass er eigens gepflegt werden müsste.
- **Das Umlegen auf `derived` ist Bestandteil einer Veröffentlichung, nicht eine Aufgabe danach.** Sollte je eine öffentlich erreichbare Instanz entstehen, steht der Moduswechsel als Punkt in der Release-Checkliste von Phase 7 (§9) — zusammen mit Zugriffsschutz und Pseudonymisierung. Ein Default, der beim Deployment stillschweigend mitwandert, wäre die wahrscheinlichste Art, diese Entscheidung versehentlich zu kippen.

### 6.4 Datenweg: warum der Inspektor sofort aufgehen muss

Ein Panel, das nach dem Klick 400 ms lädt, wird nach dem dritten Mal nicht mehr geöffnet — damit wäre das Feature tot. Budget: **unter 100 ms vom Klick bis zum vollständig sichtbaren Regelteil**, im Normalfall ohne Netzwerkzugriff.

- **Ein denormalisiertes Read-Model statt zwölf Joins.** `datasheet_card(datasheet_id, ruleset_version, mfm_version, payload JSONB)` als materialisierte Gold-View (§2) — die Panel-Abschnitte 1–10 und 12 in einem Dokument, nächtlich mit dem ETL neu gebaut.
- **Prefetch pro Fraktion.** Sobald Fraktion und Detachment gewählt sind, wird der komplette Kartensatz dieser Fraktion einmal geladen (Größenordnung 60–120 Datasheets) und clientseitig gehalten (TanStack Query + IndexedDB). Jeder weitere Klick ist ein lokaler Lookup — und der Builder funktioniert nebenbei offline.
- **Kontextteile nachladen.** Abschnitt 11 (Meta, Synergie zur aktuellen Liste) kommt asynchron und füllt sich nach; das Panel wartet nie darauf. Skeleton statt Spinner, damit das Layout nicht springt.
- **Cache-Invalidierung über `ruleset_version` + `mfm_version` im Cache-Key.** Ein Dataslate macht alte Karten nicht falsch, sondern zu einer anderen Version — konsistent mit §2.

Ergänzende Endpunkte zum API-Entwurf in §8:

```
GET  /api/datasheets/{id}/card?ruleset=&mode=derived|full
GET  /api/factions/{id}/cards?detachment=&ruleset=     # Bulk-Prefetch für den Builder
GET  /api/datasheets/{id}/context?list=                # Meta + Synergie im Listenkontext
POST /api/lists/validate/incremental                   { list, patch }
```

### 6.5 Zustandsmodell

Die Liste ist ein explizites Dokument, kein Formularzustand — sonst gibt es weder Undo noch Teilen noch Diff:

```
BuilderList {
  ruleset_version, mfm_version, faction_id, detachment_id, points_limit,
  entries: [ { uid, datasheet_id, model_count, wargear[], enhancement_id,
               attached_to_uid,      # Leader an Bodyguard, gemäß leader_attach
               transported_in_uid } ]
}
```

Jede Änderung läuft als benannte Aktion durch einen Reducer (`ADD_UNIT`, `ATTACH_LEADER`, `SET_ENHANCEMENT`, …). Daraus folgt dreierlei fast geschenkt: Undo/Redo *ist* die Aktionshistorie, ein Generator-Vorschlag ist eine Liste von Aktionen (§6.1, „als Patch übernehmen"), und **derselbe Reducer läuft serverseitig im Generator** — Builder und Generator können die Liste damit gar nicht unterschiedlich interpretieren.

Das Validierungsergebnis ist **abgeleiteter Zustand und wird nie gespeichert.** Es hängt an `ruleset_version` und `mfm_version`; eine persistierte „ist legal"-Flagge wäre nach dem nächsten Dataslate schlicht eine Lüge.

### 6.6 Nicht-Ziele

Kein Spielsimulator und kein Würfelrechner in v1 — erwartete Schadenswerte kommen ausschließlich aus dem Rollenprofil (§5.2) und sind als Näherung gekennzeichnet. Keine Regel-Engine, die Spielzüge auflöst.

Auch kein Wahapedia-Klon — trotz Volltextanzeige (§6.3). Der Inspektor deckt ab, was am konkreten Datasheet hängt: Profile, Waffen, Fähigkeiten, Anschluss, Enhancements, Stratagems. Kernregeln, Missionen, Turnierpakete und alles Übrige bleiben verlinkt statt gespiegelt. Die Grenze verläuft an der Einheit, nicht am Regelwerk.

### 6.7 Abnahmekriterien

Testbar formuliert, weil „fühlt sich gut an" kein Kriterium ist:

1. **Vollständigkeit.** Contract-Test über *alle* Datasheets der Regel-DB: Jede Karte rendert, kein Pflichtabschnitt ist unbeabsichtigt leer, fehlende Quelldaten erscheinen als expliziter „keine Daten"-Zustand. Das fängt CSV-Überraschungen (§1.1) dort ab, wo sie sonst als leeres Panel beim Nutzer landen.
2. **Konsistenz Builder ↔ Validator.** Property-Test: Eine Folge zufälliger, vom UI angebotener Aktionen darf nie zu einer Liste führen, die der Validator (§5.1) als hart illegal ablehnt.
3. **Geschwindigkeit.** Klick bis sichtbarer Regelteil unter 100 ms bei gefülltem Cache, als Playwright-Messung in CI.
4. **Round-Trip.** Builder-Export → eigener Parser (§7) → identische `BuilderList`, fehlerfrei für 100 % der Beispiel-Listen.
5. **Bedienbarkeit.** Panel per Tastatur erreichbar und mit `Esc` schließbar, Fokus wird gefangen und beim Schließen zurückgegeben, Katalog mit Pfeiltasten navigierbar, keine Information allein über Farbe kodiert.

---

## 7. Das größte technische Risiko: Listen-Parsing

Turnierlisten kommen als Freitext aus mindestens vier Quellen (GW-App, New Recruit, BattleScribe, handgetippt) in unterschiedlichen Formaten, mit Tippfehlern, Spitznamen („Bricks", „Wraithlord x2"), fehlenden Punkten und abgeschnittenen Zeilen.

Pipeline: **Normalisieren** (Unicode, Casing, Sonderzeichen, Mengenangaben) → **Alias-Tabelle** (gepflegte Community-Synonyme) → **Fuzzy-Match** (`rapidfuzz`, Token-Set-Ratio) **fraktionsbeschränkt** (halbiert die Fehlerquote sofort) → **Punkte-Plausibilisierung** (Summe muss zum Limit passen; das ist ein starkes Korrektursignal) → **Review-Queue** für alles unter Schwellwert.

Strukturierte Formate (`.ros`/`.rosz`, New-Recruit-JSON) werden vorrangig geparst, wenn verfügbar — dort ist die Datasheet-ID direkt enthalten.

**Match-Rate ist eine Produktmetrik**, die im Dashboard steht (Ziel ≥ 95 %). Nicht zugeordnete Zeilen werden mitgezählt und verwässern sonst still alle Statistiken.

---

## 8. Technischer Stack

| Ebene | Wahl | Begründung |
|---|---|---|
| Backend/API | **Python 3.12 + FastAPI** | Die Statistik (statsmodels, pandas, scikit-learn) und der Solver (OR-Tools) sind Python-nativ. Alles in TypeScript zu bauen hieße, die Kernkompetenz der App in der schwächeren Umgebung zu schreiben. |
| DB | **PostgreSQL** (+ DuckDB für Analytics-Jobs) | JSONB für Bronze, relational für Silver, materialisierte Views für Gold |
| Jobs/ETL | APScheduler oder Prefect, idempotent, mit `content_hash`-Dedupe | Nächtlicher Ingest + Recompute |
| Cache/Queue | Redis | Rate-Limiting der Ingestion, teure Generator-Läufe |
| Frontend | **Next.js + TypeScript + Tailwind + shadcn/ui**, TanStack Query | Builder-State als Reducer mit IndexedDB-Persistenz (§6.5), Regel-Inspektor als Sheet/Drawer, `dnd-kit` für Leader- und Transport-Zuweisung |
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

# Builder und Regel-Inspektor (§6.4)
GET  /api/datasheets/{id}/card?ruleset=&mode=derived|full
GET  /api/factions/{id}/cards?detachment=&ruleset=  # Bulk-Prefetch
GET  /api/datasheets/{id}/context?list=             # Meta + Synergie im Listenkontext
POST /api/lists/validate/incremental                { list, patch }
```

---

## 9. Roadmap

| Phase | Inhalt | Ergebnis | Aufwand* |
|---|---|---|---|
| **0** | Repo, Docker, Schema, Wahapedia-ETL, 11ed-Datenvalidierung (§1.1) | Vollständige Regel-DB, per Cron aktuell | ~1 Woche |
| **1** | **ToS-Prüfung (§1.4) zuerst.** Dann Manuell-Import + `SourceAdapter`, Scraper nur bei grünem Ergebnis. Normalisierung, Fraktions-Ranking mit CI + Recency | Erste nutzbare Ranking-Seite | ~2 Wochen |
| **2** | Listen-Parser + Einheiten-Statistik, Match-Rate-Dashboard | Einheiten-Ebene wird auswertbar | ~2 Wochen |
| **3** | Skill-bereinigtes Modell (Bradley-Terry + Fraktionseffekt), Matchup-Matrix | Der eigentliche statistische Mehrwert | ~1,5 Wochen |
| **4** | Constraint-Validator als eigener Service + Listen-Import/-Prüfung | „Ist meine Liste legal?" — eigenständig nützlich | ~1 Woche |
| **4b** | **Listenbuilder-Grundgerüst + Regel-Inspektor (§6.1–6.5):** `datasheet_card`-Read-Model, Panel mit Klick auf Einheit, Regelvolltext, Live-Validierung, legalitätsgefilterte Zuweisungen, Undo/Redo, Export | Regeln vollständig nachschlagbar und Listen baubar — **ohne eine einzige Turnierzeile** | ~2 Wochen |
| **5** | Synergie-Engine: Regel-Extraktion + empirisches Mining | Synergie-Explorer im UI; liefert zugleich die Effekt-Tags, die `RULES_TEXT_MODE=derived` tragen (§6.3) | ~2,5 Wochen |
| **6** | **Generator v1 (Assistent), im Builder:** Rollenprofil, Lücken, Synergie-Hinweise, Restpunkte füllen, Vorschläge als übernehmbarer Patch | Der entschiedene v1-Funktionsumfang | ~2 Wochen |
| **7** | UI-Politur, Teilen/Export, Performance. **Release-Checkliste für den Fall einer öffentlich erreichbaren Instanz:** `RULES_TEXT_MODE=derived`, Zugriffsschutz, Pseudonymisierung der Spielernamen | **v1 ausgeliefert** | ~2 Wochen |
| **8** | **Generator v2 (Vollautomatik):** Archetyp-Clustering, CP-SAT, Local Search, Diversifizierung | Listen aus dem Nichts | ~2,5 Wochen |

\* Aufwand für eine Person, nebenbei; die Zahlen sind Größenordnungen, keine Zusagen.

**Sinnvoller MVP-Schnitt (Phase 0–2):** Regel-DB + Fraktionsranking mit ehrlichen Konfidenzintervallen + Einheiten-Inklusionsraten. Das ist für sich genommen schon nutzbar und liefert die Datenbasis, ohne die Phase 3–8 ohnehin nicht funktionieren.

Der Reihenfolge liegt eine Absicht zugrunde: Phase 4 zieht den Constraint-Validator **vor** die Synergie-Engine. Er ist die einzige Komponente, die beide Generator-Stufen zwingend brauchen, er ist vollständig aus Regeldaten baubar (unabhängig davon, wie die Turnierdatenfrage ausgeht) und er ist für sich allein schon ein benutzbares Feature.

Aus demselben Grund sitzt der Listenbuilder als Phase 4b direkt dahinter und nicht bei der UI-Politur: Er braucht ausschließlich die Regel-DB aus Phase 0 und den Validator aus Phase 4 — **keine einzige Turnierzeile**. Sollte der Datenzugang aus §1.4 scheitern, bleibt damit trotzdem ein vollständiges, benutzbares Produkt übrig: ein Builder, der legale Listen erzwingt und die Regeln jeder Einheit auf Klick zeigt. Die Meta-Anreicherung des Inspektors (Abschnitt 11 in §6.2) schaltet sich später einfach dazu.

---

## 10. Risiken und wie sie behandelt werden

| Risiko | Behandlung |
|---|---|
| **Turnierdaten-Zugang bricht weg** (ToS-Klausel, API-Änderung, Sperre) | `SourceAdapter`-Abstraktion; Manuell-Import von Tag 1; ToS-Prüfung als erste Aufgabe in Phase 1; Abschalter pro Quelle; parallel offizielle Anfrage |
| **GW-IP / Regeltexte** | Nutzung bleibt privat und self-gehostet — es wird nichts an Dritte ausgeliefert; Volltext existiert nur lokal (§6.3). Wahapedia-Attribution und Deep-Links durchgängig. Restrisiko wird bewusst getragen und ist an den privaten Rahmen gebunden |
| **Aus der privaten wird unbemerkt eine öffentliche Instanz** | Genau der Fall, in dem die Begründung aus §6.3 wegfällt. Gegenmittel: `RULES_TEXT_MODE=derived` als fester Punkt der Release-Checkliste in Phase 7 (§9), nicht als nachgelagerte Aufgabe; `derived` bleibt durch die Effekt-Tags aus §4.1 dauerhaft funktionsfähig |
| **Inspektor ist träge und wird deshalb nicht benutzt** | Denormalisiertes `datasheet_card`-Read-Model, Prefetch pro Fraktion, Kontextteile asynchron nachgeladen; 100-ms-Budget als CI-Test (§6.4, §6.7) |
| **Builder bietet an, was der Validator ablehnt** | Eine gemeinsame Regelquelle und derselbe Reducer für Builder und Generator; Property-Test als Abnahmekriterium (§6.7) |
| **Lückenhafte Wahapedia-Daten erzeugen leere Panel-Abschnitte** | Contract-Test über alle Datasheets vor Release; fehlende Daten als expliziter Zustand statt als leere Fläche (§6.7) |
| **Listen-Parsing unter 90 %** | Alias-Tabelle als gepflegte Repo-Datei, Review-Queue, strukturierte Formate bevorzugen; Match-Rate sichtbar machen |
| **Statistische Fehlschlüsse** (Confounds, kleine n) | Shrinkage, CIs, Mindest-n, skill-bereinigtes Modell, Einheiten-Stats nur innerhalb Fraktion+Detachment |
| **Regel-/Punkte-Churn** | `ruleset_version` überall im Schlüssel; Auswertungsfenster an Dataslates ausgerichtet |
| **Generator produziert legale, aber unsinnige Listen** | Archetyp-Seeding aus echten Top-Listen statt Generierung auf der grünen Wiese |
| **Scope-Explosion** | Phase 0–2 als eigenständig auslieferbarer MVP definiert |

---

## 11. Noch offen

Nichts davon blockiert Phase 0 — aber Punkt 1 sollte vor Phase 1 geklärt sein, weil er nachträglich teuer wird.

Die früher hier stehende Frage nach der **Zielgruppe** ist entschieden: privates, self-gehostetes Werkzeug (siehe Entscheidungstabelle oben). Damit sind zugleich `RULES_TEXT_MODE=full` (§6.3) und die Einordnung „private Auswertung" statt „Weiterveröffentlichung fremder Daten" in §1.4 festgelegt. Eine spätere Öffnung bleibt möglich, ist dann aber ein bewusster Schritt mit eigener Checkliste (Phase 7, §9) — keine stillschweigende Erweiterung.

1. **Umfang:** Nur 40k, oder soll die Architektur Age of Sigmar gleich mittragen? Wahapedia exportiert beides. Ein `game_system`-Feld in Phase 0 mitzuziehen kostet fast nichts, es nachträglich einzuführen ist eine Schema-Migration durch alle Tabellen. **Default: Feld einbauen, nur 40k befüllen.**
2. **Format-Fokus:** 2000 Pkt. GT/WTC als Standard gesetzt — sollen 1000 Pkt. und Combat Patrol als eigene Auswertungsfenster mitlaufen? (Das Datenmodell trägt es über `tournament.format` bereits.)

---

## Quellen

- [Wahapedia Data Export](https://wahapedia.ru/wh40k11ed/the-rules/data-export/) · [Export Data Specs](https://wahapedia.ru/wh40k10ed/Export%20Data%20Specs.xlsx)
- [BSData/wh40k-11e](https://github.com/BSData/wh40k-11e) · [BSData/wh40k-11e-mfm](https://github.com/BSData/wh40k-11e-mfm) · [BSData](https://www.bsdata.net/)
- [Best Coast Pairings](https://www.bestcoastpairings.com/) · [Community-Scraper (Referenz)](https://github.com/specialprocedures/best-coast-pairings)
- [TableTopTO](https://www.tabletopto.com/) · [Listhammer](https://listhammer.info/) · [Stat Check](https://www.stat-check.com/the-meta) · [Warp Friends Meta Stats](https://warpfriends.wordpress.com/)

*Regeldaten powered by Wahapedia. Warhammer 40.000 ist geistiges Eigentum von Games Workshop; dieses Projekt steht in keiner Verbindung zu Games Workshop.*
