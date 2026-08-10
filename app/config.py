"""Zentrale Konfiguration.

Alles, was zwischen "private Instanz auf dem eigenen Rechner" und "öffentlich
erreichbare Instanz" unterscheidet, wird hier festgelegt — an genau einer
Stelle, damit der Unterschied nicht über die Codebasis verstreut ist.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("WH_DATA_DIR", REPO_ROOT / "data"))

#: Wahapedia-Basis-URL. 11. Edition; ``wh40k10ed`` existiert parallel weiter.
WAHAPEDIA_BASE_URL = os.environ.get(
    "WH_WAHAPEDIA_BASE_URL", "https://wahapedia.ru/wh40k11ed"
)

#: Kennzeichnet, aus welchem Regelstand die Daten stammen. Teil des Schlüssels
#: jeder Karte (PLAN.md §2: "Alles trägt ruleset_version").
RULESET_VERSION = os.environ.get("WH_RULESET_VERSION", "wh40k11ed")

# --------------------------------------------------------------------------
# Anzeigetiefe der Regeltexte — PLAN.md §6.3
# --------------------------------------------------------------------------
#: ``full``    Volltext aus der lokalen DB. Default, gebunden an den
#:             entschiedenen Fall: private, self-gehostete Instanz.
#: ``derived`` Nur Werte, Namen und abgeleitete Effekt-Tags plus Deep-Link.
#:             Pflicht, sobald eine Instanz öffentlich erreichbar wäre.
RULES_TEXT_MODE = os.environ.get("WH_RULES_TEXT_MODE", "full")

VALID_TEXT_MODES = ("full", "derived")

#: Wird die App an eine andere Adresse als localhost gebunden, ist sie
#: potenziell öffentlich erreichbar — dann greift die Begründung aus §6.3
#: nicht mehr. Siehe :func:`check_public_exposure`.
LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# --------------------------------------------------------------------------
# Live-Updates
# --------------------------------------------------------------------------
#: Abstand zwischen zwei Update-Prüfungen in Stunden. ``0`` schaltet die
#: automatische Prüfung ab; von Hand geht sie dann weiter über
#: ``POST /api/updates/check``.
UPDATE_INTERVAL_HOURS = float(os.environ.get("WH_UPDATE_INTERVAL_HOURS", "24"))

#: Verzögerung der ersten Prüfung nach dem Start. Ein self-gehostetes
#: Werkzeug läuft nicht wochenlang durch — ohne frühe erste Prüfung würde
#: ein 24-Stunden-Intervall praktisch nie feuern. Der Start darf davon aber
#: nicht ausgebremst werden, deshalb passiert das nebenläufig.
UPDATE_INITIAL_DELAY_SECONDS = float(
    os.environ.get("WH_UPDATE_INITIAL_DELAY_SECONDS", "20")
)

#: Gefundene Updates automatisch übernehmen. Aus heißt: nur melden.
UPDATE_AUTO_APPLY = os.environ.get("WH_UPDATE_AUTO_APPLY", "1") not in ("0", "false")


@dataclass(frozen=True)
class Attribution:
    """Auflage aus PLAN.md §1.1 — durchgängig einzuhalten, nicht optional."""

    text: str = "Regeldaten powered by Wahapedia"
    url: str = "https://wahapedia.ru/wh40k11ed/the-rules/data-export/"
    notice: str = (
        "Warhammer 40.000 ist geistiges Eigentum von Games Workshop. "
        "Dieses Projekt steht in keiner Verbindung zu Games Workshop."
    )


ATTRIBUTION = Attribution()


def database_url() -> str:
    """SQLite-Pfad. SQLAlchemy hält den Weg zu PostgreSQL offen (PLAN.md §8)."""
    if url := os.environ.get("WH_DATABASE_URL"):
        return url
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{DATA_DIR / 'warhammer_meta.sqlite3'}"


def text_mode() -> str:
    mode = RULES_TEXT_MODE.strip().lower()
    if mode not in VALID_TEXT_MODES:
        raise ValueError(
            f"WH_RULES_TEXT_MODE={RULES_TEXT_MODE!r} ist ungültig. "
            f"Erlaubt: {', '.join(VALID_TEXT_MODES)}"
        )
    return mode


def check_public_exposure(host: str) -> str | None:
    """Warnt, wenn Volltextmodus und nicht-lokale Bindung zusammentreffen.

    PLAN.md §6.3 macht das Umlegen auf ``derived`` zum Bestandteil einer
    Veröffentlichung. Ein Default, der beim Deployment stillschweigend
    mitwandert, wäre die wahrscheinlichste Art, diese Entscheidung
    versehentlich zu kippen — deshalb wird hier laut gewarnt statt gehofft.

    Gibt den Warntext zurück oder ``None``, wenn alles stimmig ist.
    """
    if text_mode() == "full" and host not in LOCAL_HOSTS:
        return (
            f"RULES_TEXT_MODE=full, aber die App bindet auf {host!r} statt auf "
            "localhost. Der Volltextmodus ist laut PLAN.md §6.3 an eine "
            "private, self-gehostete Instanz gebunden. Für eine erreichbare "
            "Instanz WH_RULES_TEXT_MODE=derived setzen."
        )
    return None
