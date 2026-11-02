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

## Einrichtung (einmalig, ca. 10 Minuten, kostenlos)

1. **Cloudflare-Konto** anlegen: <https://dash.cloudflare.com/sign-up>
2. **Datenbank:** *Storage & Databases → D1 → Create* → Name `aos-kampagne`.
3. **Schema einspielen:** Datenbank öffnen → *Console* → Inhalt von [`sql/001_schema.sql`](sql/001_schema.sql) einfügen → *Execute*.
4. **Seite verbinden:** *Workers & Pages → Create → Pages → Connect to Git* → Repo `test-and-fun-` wählen.
   - Production branch: `claude/wh40k-tournament-ranker-5shjc8` (der Standard-Branch des Repos)
   - Framework preset: *None*
   - Build command: *leer lassen*
   - **Root directory:** `aos-kampagne`
   - **Build output directory:** `public`
   - *Save and Deploy*
5. **Datenbank anbinden:** Pages-Projekt → *Settings → Bindings → Add → D1 database* → Variable name `DB`, Datenbank `aos-kampagne` → speichern → unter *Deployments* einmal *Retry deployment*.
6. Die Seite öffnen (`https://<projektname>.pages.dev`) → **Master-Login anlegen** (nur beim allerersten Besuch möglich).

## Lokal entwickeln

```bash
cd aos-kampagne
cp wrangler.example.toml wrangler.toml
npx wrangler d1 execute aos-kampagne --local --file sql/001_schema.sql
npx wrangler pages dev public
```

## Aufbau

```
public/            Statische Seite (HTML, CSS, JS ohne Build-Schritt)
  js/packs.js      Battlepacks: Karte, Zonen, Routen, Freischaltung (auch vom Server genutzt)
  js/rules.js      Regeldaten & Tabellen (deutsche Kurzfassungen)
  data/units.json  Einheiten & Punkte (aus den GW-Schlachtprofilen Oktober 2026)
functions/api/     Cloudflare Pages Function – leitet an src/server.js weiter
src/server.js      Schnittstelle: Login, Kampagnen, Züge, Begegnungen, Ergebnisse
sql/               Datenbankschema für D1
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
- Kampagnen-Hausregeln dieser App: geheime gleichzeitige Züge, Paarung Alleinstehender, Gastspieler bei ungerader Zahl, eroberte Felder ohne Bonus. In Blighted Wilds entdeckt ein Spieler die *Concealed Trails* eines Schlachtplans, sobald er mit ihm gewonnen hat.
