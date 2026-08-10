"""Ableitungen aus den Rohdaten: Zahlen aus Freitext, Tags, sicheres HTML."""

from __future__ import annotations

import re
from html.parser import HTMLParser

# ---------------------------------------------------------------------------
# Transportkapazität
# ---------------------------------------------------------------------------
# ``Datasheets.transport`` ist Freitext, z. B.:
#   "This model has a transport capacity of 12 Adeptus Custodes Infantry models."
# Zusatzsätze ("This model can also transport 1 ... Dreadnought") werden
# bewusst NICHT addiert — sie beschreiben Sonderfälle mit eigenen Bedingungen.
_CAPACITY = re.compile(r"transport capacity of\s+(\d+)", re.IGNORECASE)


def transport_capacity(text: str) -> int:
    """Kapazität in Modellen, 0 wenn keine erkennbar ist."""
    if not text:
        return 0
    match = _CAPACITY.search(text)
    return int(match.group(1)) if match else 0


# ---------------------------------------------------------------------------
# Punkte und Truppgrößen
# ---------------------------------------------------------------------------
# ``Datasheets_models_cost.description`` ist z. B. "1 model", "5 models",
# "10 models" — die Modellzahl ist der Schlüssel für die Auswahl im Builder.
_MODEL_COUNT = re.compile(r"(\d+)\s+model")


def model_count(description: str) -> int:
    match = _MODEL_COUNT.search(description or "")
    return int(match.group(1)) if match else 1


def to_int(value: str, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Effekt-Tags — PLAN.md §4.1
# ---------------------------------------------------------------------------
# Bewusst konservativ: Nur Formulierungen, die im Export hochgradig
# standardisiert sind. Was hier nicht greift, bleibt ohne Tag — der Inspektor
# zeigt dann "nur auf Wahapedia" statt einer erfundenen Zusammenfassung
# (PLAN.md §6.3).
_TAG_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Lethal Hits", re.compile(r"\blethal hits\b", re.I)),
    ("Sustained Hits", re.compile(r"\bsustained hits\b", re.I)),
    ("Devastating Wounds", re.compile(r"\bdevastating wounds\b", re.I)),
    ("Deep Strike", re.compile(r"\bdeep strike\b", re.I)),
    ("Scouts", re.compile(r"\bscouts\b", re.I)),
    ("Infiltrators", re.compile(r"\binfiltrators\b", re.I)),
    ("Stealth", re.compile(r"\bstealth\b", re.I)),
    ("Fights First", re.compile(r"\bfights first\b", re.I)),
    ("Feel No Pain", re.compile(r"\bfeel no pain\b", re.I)),
    ("Leader", re.compile(r"\bleader\b", re.I)),
    ("Reroll Hits", re.compile(r"re-?roll(ing)?\s+(the\s+)?hit\s+roll", re.I)),
    ("Reroll Wounds", re.compile(r"re-?roll(ing)?\s+(the\s+)?wound\s+roll", re.I)),
    ("Reroll Charge", re.compile(r"re-?roll(ing)?\s+(the\s+)?charge\s+roll", re.I)),
    ("+1 to Hit", re.compile(r"add\s+1\s+to\s+the\s+hit\s+roll", re.I)),
    ("+1 to Wound", re.compile(r"add\s+1\s+to\s+the\s+wound\s+roll", re.I)),
    ("-1 to Hit", re.compile(r"subtract\s+1\s+from\s+the\s+hit\s+roll", re.I)),
    ("-1 to Wound", re.compile(r"subtract\s+1\s+from\s+the\s+wound\s+roll", re.I)),
    ("Invulnerable Save", re.compile(r"invulnerable save", re.I)),
]

_AURA = re.compile(r"within\s+(\d+)\"", re.I)


def effect_tags(text: str) -> list[str]:
    """Kurzform einer Fähigkeit für den ``derived``-Modus."""
    if not text:
        return []
    plain = strip_html(text)
    tags: list[str] = []
    for label, pattern in _TAG_PATTERNS:
        if pattern.search(plain):
            tags.append(label)
    if aura := _AURA.search(plain):
        tags.append(f'Aura {aura.group(1)}"')
    # Reihenfolge stabil halten, Duplikate raus.
    seen: set[str] = set()
    return [t for t in tags if not (t in seen or seen.add(t))]


# ---------------------------------------------------------------------------
# HTML aus den Beschreibungen
# ---------------------------------------------------------------------------
# Die Beschreibungen enthalten Markup (<br>, <ul>, <li>, <b>, <i>). Es zu
# escapen macht die Regeln unlesbar, es roh einzusetzen wäre eine
# Injection-Lücke über fremde Daten. Also: Allowlist.
ALLOWED_TAGS = frozenset({"br", "b", "strong", "i", "em", "ul", "ol", "li", "p", "sup"})
VOID_TAGS = frozenset({"br"})
#: Nicht erlaubte Blockelemente werden verworfen — aber sie trennen Wörter.
#: Ohne Ersatzleerzeichen klebt "…FaktionTYRANIDS…" zusammen.
BLOCK_TAGS = frozenset({"div", "table", "tr", "td", "th", "h1", "h2", "h3", "h4"})


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._open: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in VOID_TAGS:
            self.parts.append(f"<{tag}>")
        elif tag in ALLOWED_TAGS:
            self.parts.append(f"<{tag}>")
            self._open.append(tag)
        elif tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS and tag in self._open:
            # Bis zum passenden offenen Tag schließen.
            while self._open:
                current = self._open.pop()
                self.parts.append(f"</{current}>")
                if current == tag:
                    break

    def handle_data(self, data: str) -> None:
        self.parts.append(_escape(data))

    def close_all(self) -> str:
        while self._open:
            self.parts.append(f"</{self._open.pop()}>")
        return "".join(self.parts)


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def sanitize_html(text: str) -> str:
    """Lässt nur die Formatierung durch, die in den Regeltexten vorkommt."""
    if not text:
        return ""
    parser = _Sanitizer()
    parser.feed(text)
    return parser.close_all()


class _Stripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {"br", "li", "p"} | BLOCK_TAGS:
            self.parts.append(" ")


def strip_html(text: str) -> str:
    if not text:
        return ""
    parser = _Stripper()
    parser.feed(text)
    return re.sub(r"\s+", " ", "".join(parser.parts)).strip()
