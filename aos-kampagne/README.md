# ⚔ Path to Glory – Kampagnen-Manager (Age of Sigmar 4)

Webapp als Game Master für eure Age-of-Sigmar-Kampagne mit 2–4 Spielern. Zwei Battlepacks:

- **Ravaged Coast** – Karte mit 4 Zonen (Scorched Outskirts → Gnaw's Edge → Hateful Shores → Hel's Claw), Emberstone-Splitter, Emberstone-Schmiede, Twists.
- **Blighted Wilds** – Die Karte ist das Schlachtplan-Netz (Thyrian Paths / Concealed Trails), Ruhmespunkte (GP), Ruhm (Renown) pro Einheit, Belohnungen, Verseuchung, ruhende Einheiten, Zutaten & Tränke.

## Was die App kann

- **Startseite:** Eine Kampagne starten und das Battlepack wählen. Daraus entsteht ein Einladungslink mit 2–4 Plätzen (Name + PIN + Fraktion). Der Master kann einstellen, dass nur er Kampagnen anlegen darf.
- **Master-Login:** sieht alle Kampagnen, kann Spieler rauswerfen, PINs zurücksetzen, Roster wieder öffnen, Züge aufdecken, Runden weiterschalten, Ergebnisse korrigieren, Vorräte anpassen, Kampagnen löschen.
- **Armee:** Path-to-Glory-Roster mit allen 945 Einheiten aus den GW-Schlachtprofilen (Oktober 2026), Regimenter, Hilfseinheiten, Verstärken, Pfade & Ränge mit Fähigkeitswahl, Verbesserungen, Arcane Tome, Kampfwunden & Narben, Prüfung der Aufstellungsregeln.
- **Karte & geheime Züge:** Alle ziehen verdeckt; wenn alle gezogen haben, deckt die App auf. Gleiches Feld = Spieler gegen Spieler. Allein = Paarung mit einem anderen Alleinstehenden, bei ungerader Zahl Gastspieler.
- **Spiel:** Schlachtplan auswürfeln/wählen (nur aus der passenden Tabelle bzw. den gemeinsam freigeschalteten Plänen), Twist, Checkliste vor der Schlacht, Feld-Übersicht (Feld / Reserve / Ruhend) mit Übermacht-Berechnung, Ergebnis mit Verlusten. Vertippt? Das Ergebnis lässt sich korrigieren, solange noch kein Aftermath begonnen hat (danach durch den Master).
- **Aftermath-Assistent:** Schritt für Schritt, Würfel per App oder echtes Ergebnis eintippen, Währung und Wunden werden automatisch verrechnet. Ein App-Wurf zählt (kein Neuwürfeln), Doppeltippen bucht nichts doppelt.
- **Regelwerk zum Nachlesen:** deutsche Kurzfassungen beider Battlepacks, mit Wahapedia abgeglichen – durchsuchbar, mit Glossar der Grundbegriffe und Direktlinks zum Originaltext jedes Abschnitts, Schlachtplans und Pfads. Aus Spiel und Aftermath öffnet „📖 Regeln dazu“ das passende Kapitel, ohne die Seite zu verlassen.
- **Rangliste, Spielverlauf**, Live-Stand alle 5 Sekunden, Handy-Ansicht.

## Einrichtung bei Cloudflare (Workers, kostenlos)

1. Cloudflare-Konto → *Workers & Pages → Create → Import a repository* → Repo `test-and-fun-` wählen.
   - Deploy command: `npx wrangler deploy` (Standard), Root directory: leer lassen (Hauptordner).
2. Fertig. Beim Deploy liest wrangler die Datei `wrangler.jsonc` im Hauptordner, legt die D1-Datenbank `aos-kampagne` an (oder verknüpft eine vorhandene gleichen Namens) und lädt die Seite hoch. Die Tabellen legt die App beim ersten Aufruf selbst an.
3. Die Worker-Adresse öffnen (`https://<name>.<konto>.workers.dev`) → **Master-Login anlegen**.

Wichtig: `"name"` in `wrangler.jsonc` muss genau dem Namen des Workers im Cloudflare-Dashboard entsprechen.

Alternativ geht es weiterhin mit Cloudflare Pages: Root directory `aos-kampagne`, Build output `public`, D1-Binding `DB` im Dashboard. Das Schema steht in [`sql/001_schema.sql`](sql/001_schema.sql), wird aber auch automatisch angelegt.

## Lokal entwickeln

```bash
# im Hauptordner des Repos
npx wrangler dev
```

## Nach einem Update

Nichts zu tun: Beim ersten Aufruf ergänzt die App ihre Datenbank selbst (neue Tabellen `rate_limits` und `settings`, neue Spalte `campaigns.options`). Laufende Kampagnen bleiben erhalten. Wer es lieber von Hand macht, findet die Schritte in [`sql/002_sicherheit.sql`](sql/002_sicherheit.sql).

## Aufbau

```
public/            Statische Seite (HTML, CSS, JS ohne Build-Schritt)
  js/packs.js      Battlepacks: Karte, Zonen, Routen, Schlachtplan-Tabellen, Freischaltung (auch vom Server genutzt)
  js/core.js       Rechenlogik für Browser UND Server: Armeepunkte, Verluste, Kampagnen-Fortschritt
  js/rules.js      Regeldaten & Tabellen (deutsche Kurzfassungen) und das Regelwerk
  data/units.json  Einheiten & Punkte (aus den GW-Schlachtprofilen Oktober 2026)
  fonts/           Schriften Cinzel und Inter (SIL Open Font License, Lizenztexte liegen bei)
  _headers         Sicherheits-Header (Content-Security-Policy usw.)
src/worker.js      Einstieg für Cloudflare Workers (/api → Schnittstelle, sonst statische Dateien)
functions/api/     Alternative für Cloudflare Pages – leitet an src/server.js weiter
src/server.js      Schnittstelle: Login, Kampagnen, Züge, Begegnungen, Ergebnisse
sql/               Datenbankschema für D1 (src/schema.js wird daraus mit `npm run schema` erzeugt)
tests/             Automatische Tests (siehe unten)
tools/parse_bp.py  Erzeugt units.json aus der Schlachtprofile-PDF
```

## Sicherheit

**Was geschützt ist**

- **Zugriff:** Der Browser spricht nie direkt mit der Datenbank. Jede Anfrage prüft die Sitzung; ohne Anmeldung gibt es keine Kampagnendaten, Spieler sehen und ändern nur ihre eigene Kampagne und nur ihr eigenes Roster. Der geheime Zug bleibt bis zum Aufdecken geheim.
- **Logins:** PINs und Master-Passwort werden nur als PBKDF2-Hash gespeichert, Sitzungen per `HttpOnly`-/`Secure`-/`SameSite`-Cookie. Durchprobieren ist gesperrt: Nach 5 falschen PINs ist ein Platz 5 Minuten zu, jede weitere Sperre dauert doppelt so lange (bis 24 Stunden) – egal von welchem Gerät. Dasselbe gilt für den Master-Login (pro IP); auch Kampagnen-Codes lassen sich nicht durchraten. Der Master kann eine PIN jederzeit zurücksetzen.
- **Kampagnen-Fortschritt:** Bilanz, freigeschaltete Zonen und Routen, Feldbesitz, Finale und Kampagnensieg berechnet ausschließlich der Server aus den eingetragenen Ergebnissen. Ein Schlachtplan muss zur Begegnung passen – das Finale lässt sich nicht „erfinden“.
- **Fremde Webseiten:** Anfragen von anderen Seiten werden abgelehnt (Origin-Prüfung, nur JSON). Die Seite selbst lädt nur eigene Skripte, Stile und Schriften (strenge Content-Security-Policy, keine Verbindung zu Google Fonts o. Ä.) und lässt sich nicht in fremde Seiten einbetten.
- **Missbrauch:** Größenlimits für Anfragen, Wertebereiche für alle Zahlen, höchstens 6 neue Kampagnen pro Stunde und IP. Im Master-Bereich lässt sich einstellen, dass nur der Master Kampagnen anlegt.
- **Gleichzeitigkeit:** Züge aufdecken, Runde weiterschalten und Kampagne starten laufen atomar – auch wenn zwei Spieler im selben Moment tippen, entstehen keine doppelten Spiele oder übersprungenen Runden.
- Keine Secrets im Repo.

**Was auf Vertrauen läuft (wie am Spieltisch)**

- Würfel und die Buchhaltung im Aftermath: Wer will, kann echte Würfel werfen und das Ergebnis eintippen – die App kann das nicht nachprüfen. Dafür steht **jede Änderung an Währung und Vorräten mit dem echten Betrag im Verlauf** (der Betrag kommt vom Server, nicht vom Browser), und App-Würfe sind als solche gekennzeichnet.
- Ein Ergebnis trägt ein Beteiligter ein; der Verlauf nennt, wer es war.

**Wichtig beim ersten Start:** Wer die frisch veröffentlichte Seite zuerst öffnet, legt den Master-Login an. Mach das direkt nach dem ersten Deploy selbst und wähle ein Passwort (mind. 8 Zeichen), das du sonst nirgends benutzt.

## Tests

```bash
cd aos-kampagne
npm test          # 38 Tests: Sicherheit, Rundenlogik, Regeln, Datenbank-Update (braucht nur Node ≥ 22.13, keine Installation)
```

Die Tests rufen die Schnittstelle direkt auf und bilden die D1-Datenbank mit `node:sqlite` nach. Zusätzlich gibt es zwei Durchläufe im echten Browser (Playwright, nicht Teil von `npm test`) gegen eine **lokale** Testdatenbank:

```bash
npx wrangler dev                                           # im Hauptordner
node aos-kampagne/tests/browser/ravaged_coast.cjs          # komplette Runde Ravaged Coast, 2 Spieler
node aos-kampagne/tests/browser/blighted_wilds.cjs         # Blighted Wilds, 3 Spieler inkl. Gastspiel
```

## Punkte aktualisieren

Neue Schlachtprofile-PDF herunterladen und `python3 tools/parse_bp.py <pdf> public/data/units.json` ausführen.

## Hinweise

- Regeltexte sind eigene, gekürzte Zusammenfassungen, mit Wahapedia abgeglichen. Vollständige Texte: Wahapedia bzw. eure Bücher. Nur für den privaten Gebrauch.
- **So setzt die App die Battlepack-Regeln auf der Karte um:**
  - *Ravaged Coast:* Die Schlachtplan-Tabelle richtet sich nach der am weitesten fortgeschrittenen Zone der beiden Spieler (laut Battlepack reicht es für Gnaw's Edge und Hateful Shores, wenn **einer** sie freigeschaltet hat). Das Finale „Raid on Hel's Claw“ gibt es nur, wenn **beide** in Hel's Claw stehen – also beide mit einem Hateful-Shores-Schlachtplan gewonnen haben.
  - *Blighted Wilds:* Gewählt wird aus den Schlachtplänen, die beide freigeschaltet haben. Thyrian Paths entdeckt, wer mit dem Plan gekämpft hat; Concealed Trails, wer mit ihm gewonnen hat.
  - *Finale gegen Gastspieler:* standardmäßig nicht möglich (Battlepack: Finale zwischen zwei Kampagnenspielern). Der Master kann es pro Kampagne in den Einstellungen erlauben.
- **Hausregeln Aufträge & Versorgung:** Zu Beginn jeder Runde Einheiten zum Erholen, Schürfen oder Nahrungssammeln schicken (sie verpassen die Schlacht). Gestorbene Modelle: je W6, bei 1 dauerhaft tot; Erholen holt sie gegen Gold (Ravaged Coast) bzw. GP (Blighted Wilds) zurück (je Modell W6, bei 1 kein Erfolg). Nahrung: Start = Startpunkte, Beute = Punkte getöteter feindlicher Modelle, Bedarf = Punkte der lebenden Modelle minus Feld-Anteil; eine Einheit übersteht eine Hungerrunde, beim zweiten Mal verlässt sie die Armee.
- Kampagnen-Hausregeln dieser App: geheime gleichzeitige Züge, Paarung Alleinstehender, Gastspieler bei ungerader Zahl, eroberte Felder ohne Bonus.
