"""Ableitungen aus Freitext und das Sanitizing der Regeltexte."""

import pytest

from app import derive


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("This model has a transport capacity of 6 Test Infantry models.", 6),
        ("This model has a transport capacity of 12 Adeptus Custodes Infantry models.", 12),
        ("", 0),
        ("Kein Transport.", 0),
    ],
)
def test_transportkapazitaet(text, expected):
    assert derive.transport_capacity(text) == expected


def test_zusatzklausel_wird_nicht_addiert():
    """Sonderfälle mit eigenen Bedingungen dürfen die Kapazität nicht erhöhen."""
    text = (
        "This model has a transport capacity of 12 Infantry models. "
        "This model can also transport 1 Dreadnought."
    )
    assert derive.transport_capacity(text) == 12


@pytest.mark.parametrize(
    ("description", "expected"),
    [("1 model", 1), ("5 models", 5), ("10 models", 10), ("", 1)],
)
def test_modellzahl(description, expected):
    assert derive.model_count(description) == expected


def test_effekt_tags():
    tags = derive.effect_tags(
        'Verbündete Einheiten within 6" können re-roll the hit roll '
        "und haben Lethal Hits."
    )
    assert "Reroll Hits" in tags
    assert "Lethal Hits" in tags
    assert 'Aura 6"' in tags


def test_effekt_tags_erfinden_nichts():
    assert derive.effect_tags("Ein völlig eigener Regeltext ohne Muster.") == []
    assert derive.effect_tags("") == []


def test_sanitizer_behaelt_formatierung():
    html = derive.sanitize_html("<b>Fett</b> und <i>kursiv</i><br><ul><li>Punkt</li></ul>")
    assert "<b>Fett</b>" in html
    assert "<li>Punkt</li>" in html
    assert "<br>" in html


def test_sanitizer_entfernt_scripts():
    """Die Quelldaten sind fremd — sie dürfen kein Markup einschleusen."""
    html = derive.sanitize_html('Harmlos <script>alert("xss")</script> Ende')
    assert "<script>" not in html
    assert "alert" in html  # Text bleibt, das Tag ist weg
    assert "&lt;script&gt;" not in html  # das Tag wurde verworfen, nicht escaped


def test_sanitizer_entfernt_attribute():
    html = derive.sanitize_html('<b onclick="böse()">Text</b>')
    assert "onclick" not in html
    assert "<b>Text</b>" in html


def test_sanitizer_schliesst_offene_tags():
    assert derive.sanitize_html("<b>offen") == "<b>offen</b>"


def test_sanitizer_escaped_rohe_spitzklammern():
    assert "&lt;" in derive.sanitize_html("5 < 6")


def test_strip_html():
    assert derive.strip_html("<b>A</b><br><li>B</li>") == "A B"


def test_to_int():
    assert derive.to_int("42") == 42
    assert derive.to_int("") == 0
    assert derive.to_int("keine Zahl", default=7) == 7


def test_blocktags_kleben_woerter_nicht_zusammen():
    """Wahapedia verpackt Regeltexte in <div>-Gerüste."""
    html = derive.sanitize_html("<div>Erster Satz.</div><div>Zweiter Satz.</div>")
    assert "Satz.&nbsp;Zweiter" not in html
    assert "Satz. Zweiter" in derive.strip_html(html)
    assert "<div>" not in html


def test_span_wird_verworfen_text_bleibt():
    html = derive.sanitize_html('Fraktion <span class="kwb">TYRANIDS</span> gilt')
    assert "<span" not in html
    assert "TYRANIDS" in html
