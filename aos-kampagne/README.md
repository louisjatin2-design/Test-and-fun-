# ⚔ Path to Glory – Kampagnen-Manager (Age of Sigmar 4)

Webapp als Game Master für eure Age-of-Sigmar-Kampagne mit 2–4 Spielern. Zwei Battlepacks:

- **Ravaged Coast** – Karte mit 4 Zonen (Scorched Outskirts → Gnaw's Edge → Hateful Shores → Hel's Claw), Emberstone-Splitter, Emberstone-Schmiede, Twists.
- **Blighted Wilds** – Die Karte ist das Schlachtplan-Netz (Thyrian Paths / Concealed Trails), Ruhmespunkte (GP), Ruhm (Renown) pro Einheit, Belohnungen, Verseuchung, ruhende Einheiten, Zutaten & Tränke.

## Was die App kann

- **Startseite:** Jeder kann eine Kampagne starten und das Battlepack wählen. Daraus entsteht ein Einladungslink mit 4 Plätzen (Name + PIN + Fraktion).
- **Master-Login:** sieht alle Kampagnen, kann Spieler rauswerfen, PINs zurücksetzen, Roster wieder öffnen, Züge aufdecken, Runden weiterschalten, Kampagnen löschen.
- **Armee:** Path-to-Glory-Roster mit allen 945 Einheiten aus den GW-Schlachtprofilen (Oktober 2026), Regimenter, Hilfseinheiten, Verstärken, Pfade & Ränge mit Fähigkeitswahl, Verbesserungen, Arcane Tome, Kampfwunden & Narben, Prüfung der Aufstellungsregeln.
- **Karte & geheime Züge:** Alle ziehen verdeckt; wenn alle gezogen haben, deckt die App auf. Gleiches Feld = Spieler gegen Spieler. Allein = Paarung mit einem anderen Alleinstehenden, bei ungerader Zahl Gastspieler.
- **Spiel:** Schlachtplan auswürfeln/wählen, Twist, Feld-Übersicht (Feld / Reserve / Ruhend) mit Übermacht-Berechnung, Ergebnis mit Verlusten.
- **Aftermath-Assistent:** Schritt für Schritt, Würfel per App oder echtes Ergebnis eintippen, Währung und Wunden werden automatisch verrechnet.
- **Rangliste, Spielverlauf, Regelwerk** zum Nachschlagen (deutsche Kurzfassungen), Live-Stand alle 5 Sekunden, Handy-Ansicht.

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

## Aufbau

```
public/            Statische Seite (HTML, CSS, JS ohne Build-Schritt)
  js/packs.js      Battlepacks: Karte, Zonen, Routen, Freischaltung (auch vom Server genutzt)
  js/rules.js      Regeldaten & Tabellen (deutsche Kurzfassungen)
  data/units.json  Einheiten & Punkte (aus den GW-Schlachtprofilen Oktober 2026)
src/worker.js      Einstieg für Cloudflare Workers (/api → Schnittstelle, sonst statische Dateien)
functions/api/     Alternative für Cloudflare Pages – leitet an src/server.js weiter
src/server.js      Schnittstelle: Login, Kampagnen, Züge, Begegnungen, Ergebnisse
sql/               Datenbankschema für D1 (src/schema.js wird daraus erzeugt und beim ersten Aufruf ausgeführt)
tools/parse_bp.py  Erzeugt units.json aus der Schlachtprofile-PDF
```

## Sicherheit

- PINs und Master-Passwort werden nur als PBKDF2-Hash gespeichert, Sitzungen per HttpOnly-Cookie.
- Der Browser spricht nie direkt mit der Datenbank; jede Anfrage prüft die Sitzung und liefert nur Daten der eigenen Kampagne.
- Keine Secrets im Repo.

## Punkte aktualisieren

Neue Schlachtprofile-PDF herunterladen und `python3 tools/parse_bp.py <pdf> public/data/units.json` ausführen.

## Hinweise

- Regeltexte sind eigene, gekürzte Zusammenfassungen. Vollständige Texte: Wahapedia bzw. eure Bücher. Nur für den privaten Gebrauch.
- **Hausregeln Aufträge & Versorgung:** Zu Beginn jeder Runde Einheiten zum Erholen, Schürfen oder Nahrungssammeln schicken (sie verpassen die Schlacht). Gestorbene Modelle: je W6, bei 1 dauerhaft tot; Erholen holt sie gegen Gold (Ravaged Coast) bzw. GP (Blighted Wilds) zurück (je Modell W6, bei 1 kein Erfolg). Nahrung: Start = Startpunkte, Beute = Punkte getöteter feindlicher Modelle, Bedarf = Punkte der lebenden Modelle minus Feld-Anteil; eine Einheit übersteht eine Hungerrunde, beim zweiten Mal verlässt sie die Armee.
- Kampagnen-Hausregeln dieser App: geheime gleichzeitige Züge, Paarung Alleinstehender, Gastspieler bei ungerader Zahl, eroberte Felder ohne Bonus. In Blighted Wilds entdeckt ein Spieler die *Concealed Trails* eines Schlachtplans, sobald er mit ihm gewonnen hat.
