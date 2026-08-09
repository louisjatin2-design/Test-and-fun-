"""Der Schalter aus PLAN.md §6.3 und seine Schutzwarnung."""

import importlib

import pytest


def _config(monkeypatch, mode):
    monkeypatch.setenv("WH_RULES_TEXT_MODE", mode)
    from app import config

    return importlib.reload(config)


def test_default_ist_volltext(monkeypatch):
    monkeypatch.delenv("WH_RULES_TEXT_MODE", raising=False)
    from app import config

    assert importlib.reload(config).text_mode() == "full"


def test_ungueltiger_modus_wirft(monkeypatch):
    config = _config(monkeypatch, "halbvoll")
    with pytest.raises(ValueError, match="ungültig"):
        config.text_mode()


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
def test_lokale_bindung_mit_volltext_ist_still(monkeypatch, host):
    config = _config(monkeypatch, "full")
    assert config.check_public_exposure(host) is None


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.10"])
def test_volltext_auf_offener_bindung_warnt(monkeypatch, host):
    """Genau der Fall, in dem die Begründung aus §6.3 wegfällt."""
    config = _config(monkeypatch, "full")
    message = config.check_public_exposure(host)
    assert message is not None
    assert "derived" in message


def test_derived_darf_ueberall_binden(monkeypatch):
    config = _config(monkeypatch, "derived")
    assert config.check_public_exposure("0.0.0.0") is None


def test_attribution_ist_nicht_abschaltbar():
    from app import config

    assert "Wahapedia" in config.ATTRIBUTION.text
    assert "Games Workshop" in config.ATTRIBUTION.notice
