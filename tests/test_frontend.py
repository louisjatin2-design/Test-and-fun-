"""Die Oberfläche auf fremden Geräten.

Was hier geprüft wird, ist nicht "sieht gut aus", sondern die Handvoll
Regeln, deren Verlust die App auf einem Gerät *unbenutzbar* macht — und die
man beim Aufräumen im Stylesheet versehentlich mitnimmt, weil man sie für
Kosmetik hält. Jeder Test hält einen konkreten Fehler fest, der schon
dagewesen ist oder unmittelbar droht.

Ein echter Browser wäre gründlicher. Er ist hier bewusst nicht im Spiel:
Playwright samt Chromium als Testabhängigkeit für vier Zusicherungen steht
in keinem Verhältnis, und `pytest` soll ohne Netz durchlaufen.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parent.parent / "app" / "static"

INDEX = (STATIC / "index.html").read_text(encoding="utf-8")
CSS = (STATIC / "styles.css").read_text(encoding="utf-8")


def _media_block(bedingung: str) -> str:
    """Der Inhalt eines `@media`-Blocks, Klammern mitgezählt."""
    start = CSS.find(f"@media {bedingung}")
    assert start != -1, f"Kein @media-Block für '{bedingung}'"
    tiefe = 0
    for index in range(CSS.find("{", start), len(CSS)):
        if CSS[index] == "{":
            tiefe += 1
        elif CSS[index] == "}":
            tiefe -= 1
            if tiefe == 0:
                return CSS[start:index]
    pytest.fail(f"@media {bedingung} ist nicht geschlossen")


# --------------------------------------------------------------- Verweise

def test_jeder_static_verweis_existiert():
    """Ein Tippfehler im Pfad fällt sonst niemandem auf.

    Ein fehlendes `apple-touch-icon.png` macht keinen Fehler sichtbar — iOS
    legt dann still ein Bildschirmfoto der Seite als Symbol an.
    """
    verweise = set(re.findall(r'href="/static/([^"]+)"', INDEX))
    verweise |= set(re.findall(r'src="/static/([^"]+)"', INDEX))
    assert verweise, "index.html verweist auf gar nichts unter /static/"

    fehlend = sorted(name for name in verweise if not (STATIC / name).exists())
    assert not fehlend, f"index.html verweist auf fehlende Dateien: {fehlend}"


def test_manifest_macht_die_app_installierbar():
    """Ohne Manifest bietet Chrome auf Android kein "App installieren" an.

    Chrome verlangt dafür Name, Start-URL, `display` und ein Symbol von
    mindestens 192 px. Fehlt eins davon, verschwindet der Menüpunkt
    kommentarlos — und die README verspricht ihn.
    """
    manifest = json.loads(
        (STATIC / "manifest.webmanifest").read_text(encoding="utf-8"))

    assert manifest["name"]
    assert manifest["start_url"] == "/"
    assert manifest["scope"] == "/"
    assert manifest["display"] == "standalone"

    groessen = set()
    for symbol in manifest["icons"]:
        datei = STATIC / symbol["src"].removeprefix("/static/")
        assert datei.exists(), f"Manifest nennt fehlendes Symbol {symbol['src']}"
        groessen.update(
            int(teil.split("x")[0])
            for teil in symbol["sizes"].split()
            if "x" in teil
        )

    assert max(groessen, default=0) >= 192, (
        "Chrome verlangt für die Installation ein Symbol ab 192 px")


# ------------------------------------------------------------------ Viewport

def test_viewport_erlaubt_zoomen():
    """Zoom zu sperren ist die naheliegendste und schlechteste Abkürzung.

    `user-scalable=no` beseitigt auf einen Schlag alle Zoom-Probleme auf
    iOS — und nimmt gleichzeitig jedem die Lupe weg, der sie braucht. Die
    Antwort auf das Zoomen beim Antippen steht stattdessen im Stylesheet
    (16 px in Eingabefeldern), nicht hier.
    """
    viewport = re.search(r'<meta name="viewport" content="([^"]+)"', INDEX)
    assert viewport, "index.html hat kein Viewport-Meta"
    inhalt = viewport.group(1)

    assert "user-scalable=no" not in inhalt
    assert "maximum-scale" not in inhalt
    # Ohne diese Angabe endet die Seite auf dem iPhone über dem Home-Indikator
    # statt darunter; die sicheren Ränder holt das CSS zurück.
    assert "viewport-fit=cover" in inhalt


# ------------------------------------------------------- Bedienung am Finger

def test_plus_knopf_ist_ohne_maus_sichtbar():
    """Der Fehler, der auf dem iPad das Hinzufügen unmöglich machte.

    Das Plus einer Katalogzeile steht auf `opacity: 0` und erscheint bei
    `:hover`. Ein Touchscreen kennt kein `:hover` — der Knopf blieb dort für
    immer unsichtbar. Wer die Regel unten entfernt, stellt genau das wieder
    her, ohne dass es am Schreibtisch auffiele.
    """
    assert ".cat-item .add" in CSS and "opacity: 0" in CSS

    ohne_hover = _media_block("(hover: none)")
    assert re.search(r"\.cat-item \.add\s*\{[^}]*opacity:\s*1", ohne_hover), (
        "Ohne Hover-Fähigkeit muss das Plus dauerhaft sichtbar sein")


def test_eingabefelder_zoomen_auf_ios_nicht_herein():
    """Unter 16 px zoomt Safari beim Fokus die ganze Seite heran.

    Zurück zoomt es nicht von selbst. Danach ist die Bedienung verschoben,
    bis der Nutzer von Hand herauszoomt — deshalb ist die Schriftgröße in
    Eingabefeldern am Touchscreen eine Funktion und keine Geschmacksfrage.
    """
    grob = _media_block("(pointer: coarse)")
    assert re.search(
        r"input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px", grob), (
        "Am Touchscreen brauchen input/select/textarea 16px")


def test_trefferflaechen_erreichen_44_pixel():
    """44 px ist die Zahl aus den Apple HIG; Android nennt 48 dp."""
    grob = _media_block("(pointer: coarse)")
    assert "--touch" in CSS
    assert "min-height: var(--touch)" in grob


# --------------------------------------------------------------- Höhenmaß

def test_layout_misst_in_dvh():
    """`100vh` zählt auf dem Telefon die Browserleiste mit.

    Das Fußende der App — Attribution und letzte Listenzeile — liegt damit
    dauerhaft hinter der Leiste. `dvh` misst, was gerade sichtbar ist; die
    `vh`-Zeile darf als Rückfall für ältere Browser stehen bleiben.
    """
    assert "height: 100dvh" in CSS
    assert re.search(r"height:\s*100vh;\s*\n\s*height:\s*100dvh", CSS), (
        "Die vh-Zeile gehört unmittelbar vor die dvh-Zeile als Rückfall")


def test_sichere_raender_werden_beruecksichtigt():
    """Mit `viewport-fit=cover` liegt die Seite unter Notch und Home-Indikator."""
    for seite in ("top", "right", "bottom", "left"):
        assert f"env(safe-area-inset-{seite}" in CSS, (
            f"safe-area-inset-{seite} wird nirgends eingerechnet")


# ---------------------------------------------------------- Offline-Datei

def test_offline_datei_laedt_nichts_nach():
    """Sie wird per Doppeltipp aus dem Dateisystem geöffnet.

    Dort gibt es kein `/static/`. Jeder verbliebene Verweis wäre ein
    Ladefehler auf einem Gerät ohne Netz — also genau dort, wo niemand
    nachsehen kann, woran es liegt.
    """
    from app.build_offline import render

    html = render({"meta": {}, "cards": {}})

    assert "/static/" not in html
    assert "<script src=" not in html
    assert '<script type="application/json" id="wh-data">' in html


def test_offline_datei_nimmt_das_stylesheet_mit():
    """Auf dem Telefon läuft meist die Offline-Datei, nicht der Server.

    Wenn die Geräteanpassungen unterwegs verloren gingen, wäre ausgerechnet
    dort die alte Darstellung — die Datei ist ja *für* das Telefon gebaut.
    """
    from app.build_offline import render

    html = render({"meta": {}, "cards": {}})

    assert "100dvh" in html
    assert "@media (hover: none)" in html
    assert "@media (pointer: coarse)" in html


def test_daten_stehen_nicht_im_selben_script_wie_der_code():
    """Der Fehler, der die Datei auf iPad und iPhone unbrauchbar machte.

    Daten und Programm lagen in *einem* `<script>`: erst ein Objektliteral
    mit allen Regeldaten, dann rules.js und app.js. Bei allen Fraktionen sind
    das rund 13 MB, die der JavaScript-Parser vollständig verarbeiten muss,
    bevor die erste Zeile Code läuft. Reicht der Speicher dafür nicht, fällt
    das ganze Element aus — und übrig bleibt eine Seite, die aussieht wie die
    App und in der die Fraktionsauswahl leer ist, weil app.js sie füllt.

    Getrennt kann das nicht mehr passieren: Für den JavaScript-Parser sind
    die Daten gar nicht da, und ein Fehler beim Einlesen ist ein normaler
    Laufzeitfehler, den der Startbildschirm anzeigt.
    """
    from app.build_offline import render

    marke = "ZZ-Erkennungsmarke-4711"
    html = render({"meta": {"attribution": marke}, "cards": {}, "factions": []})

    daten = html.index('<script type="application/json" id="wh-data">')
    datenende = html.index("</script>", daten)
    code = html.index("<script>\n")
    assert daten < datenende < code, "Die Daten müssen vor dem Programm stehen"

    # Zwischen Datenende und Programmanfang darf nichts liegen.
    assert html[datenende:code + len("<script>\n")].strip() == "</script>\n<script>"

    # Und die Nutzdaten stehen genau einmal, nämlich im Datenelement.
    assert html.count(marke) == 1
    assert daten < html.index(marke) < datenende


def test_offline_daten_koennen_das_script_element_nicht_beenden():
    """Regeltexte sind fremde Daten und enthalten HTML.

    `</script>` mitten in einer Fähigkeit würde das Datenelement beenden; der
    Rest der Datei landete dann als Text im Dokument. `<!--` bringt den
    Tokenizer in einen Zustand, in dem ein späteres `<script` dasselbe von
    der anderen Seite anrichtet. Beides sind gültige JSON-Escapes — nach dem
    Einlesen steht wieder der Originaltext da.
    """
    import json

    from app.build_offline import _payload

    boesartig = {"a": "Ende: </script><script>alert(1)</script>",
                 "b": "Kommentar: <!-- und <script>"}
    text = _payload(boesartig)

    assert "</script" not in text
    assert "<!--" not in text
    assert json.loads(text) == boesartig


def test_startbildschirm_erklaert_den_fehlstart():
    """Ohne ihn scheitert die App auf einem fremden Gerät stumm.

    Genau das war die Meldung vom iPad: „keine Fraktion auswählbar". Die
    Auswahlfelder füllt JavaScript — läuft es nicht, bleiben sie leer, und
    nichts auf dem Bildschirm sagt warum.
    """
    assert "<noscript>" in INDEX, "Ohne <noscript> bleibt JavaScript-aus stumm"
    assert 'id="boot"' in INDEX

    # Der Hinweis muss den iOS-Fall benennen — er ist der wahrscheinlichste.
    noscript = INDEX[INDEX.index("<noscript>"):INDEX.index("</noscript>")]
    assert "iPad" in noscript

    # Erst nach einer Frist sichtbar: Beim normalen Start entfernt app.js ihn
    # vorher, und niemand sieht ihn aufblitzen.
    assert re.search(r"\.boot\s*\{[^}]*animation:\s*boot-appear[^}]*\}", CSS)
    assert re.search(r"\.boot\s*\{[^}]*visibility:\s*hidden", CSS), (
        "Unsichtbar allein reicht nicht — die Fläche finge sonst jeden Tipp ab")

    app_js = (STATIC / "app.js").read_text(encoding="utf-8")
    assert 'bootDone' in app_js and 'init().catch(bootFailed)' in app_js


def test_helles_thema_mit_dunkler_variante():
    """Weiß ist die Vorgabe, nicht die Ausnahme.

    Wer das Farbschema umbaut, soll die Zeile hier vor sich haben: `dark`
    allein im `color-scheme` und ein Browser färbt Auswahlfelder,
    Bildlaufleisten und die Fläche hinter der Seite dunkel — auch wenn im
    Stylesheet nichts Dunkles mehr steht.
    """
    assert re.search(r":root\s*\{[^}]*color-scheme:\s*light", CSS)
    assert "@media (prefers-color-scheme: dark)" in CSS
    assert 'content="light dark"' in INDEX

    # Die Holzmaserung ist ein Verlauf, kein Bild: Die Offline-Datei darf
    # nichts nachladen, und fremde Bildrechte gibt es so gar nicht erst.
    assert re.search(r"--wood:\s*linear-gradient", CSS)
    assert "url(http" not in CSS and "url('http" not in CSS and 'url("http' not in CSS
