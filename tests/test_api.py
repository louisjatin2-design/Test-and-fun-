"""API-Endpunkte aus PLAN.md §6.4 und §8."""

import pytest


def test_meta(client):
    data = client.get("/api/meta").json()
    assert data["has_data"] is True
    assert data["rules_text_mode"] == "full"
    assert data["last_update"] == "2026-05-09 23:42:21"
    assert data["attribution"]["text"] == "Regeldaten powered by Wahapedia"


def test_meta_liefert_die_herkunft_jeder_regel(client):
    """Das UI muss Annahme und belegte Regel unterscheiden können."""
    rules = {r["key"]: r for r in client.get("/api/meta").json()["rules"]}
    assert rules["leader_attach"]["basis"] == "DATA"
    assert rules["rule_of_three"]["basis"] == "ASSUMPTION"
    assert rules["rule_of_three"]["note"]


def test_factions(client):
    factions = client.get("/api/factions").json()
    assert {"id": "TT", "name": "Testfraktion"} in factions


def test_detachments(client):
    detachments = client.get("/api/factions/TT/detachments").json()
    assert {"id": "D1", "name": "Testdetachment"} in detachments
    assert {"id": "D2", "name": "Anderesdetachment"} in detachments


def test_bulk_prefetch(client):
    """Ein Aufruf lädt den ganzen Kartensatz — danach ist Klicken lokal."""
    data = client.get("/api/factions/TT/cards").json()
    assert data["count"] == 5
    assert data["rules_text_mode"] == "full"
    assert [c["name"] for c in data["cards"]] == sorted(
        c["name"] for c in data["cards"]
    )


def test_einzelne_karte(client):
    card = client.get("/api/datasheets/DS001/card").json()
    assert card["name"] == "Testkommandant"
    assert card["min_cost"] == 80
    assert card["is_character"] is True
    assert card["profiles"][0]["Sv"] == "3+"


def test_unbekanntes_datasheet(client):
    assert client.get("/api/datasheets/GIBTESNICHT/card").status_code == 404


def test_volltextmodus_liefert_regeltexte(client):
    card = client.get("/api/datasheets/DS001/card?mode=full").json()
    assert "<b>Testaura:</b>" in card["abilities"][0]["description"]
    assert card["stratagems"][0]["description"]
    assert card["enhancements"][0]["description"]


def test_derived_modus_ersetzt_text_durch_tags(client):
    """PLAN.md §6.3: Werte und Namen bleiben, Fließtext geht raus."""
    card = client.get("/api/datasheets/DS001/card?mode=derived").json()

    # Zahlen bleiben — ohne sie ist ein Builder wertlos.
    assert card["profiles"][0]["T"] == "4"
    assert card["weapons"]["ranged"][0]["S"] == "4"
    assert card["min_cost"] == 80
    assert card["name"] == "Testkommandant"

    # Fließtext verschwindet, die abgeleiteten Tags bleiben.
    assert card["abilities"][0]["description"] == ""
    assert card["abilities"][0]["name"] == "Testaura"
    assert "Reroll Hits" in card["abilities"][0]["tags"]
    assert card["stratagems"][0]["description"] == ""
    assert card["enhancements"][0]["description"] == ""
    assert card["legend"] == ""

    # Der Deep-Link bleibt in beiden Modi.
    assert card["link"] == "https://example.invalid/ds001"


def test_derived_modus_laesst_kapazitaet_stehen(client):
    """Die Zahl ist ein Wert, kein Regeltext."""
    card = client.get("/api/datasheets/DS003/card?mode=derived").json()
    assert card["transport"]["text"] == ""
    assert card["transport"]["capacity"] == 6
    assert card["transport_capacity"] == 6


def test_validate(client):
    payload = {
        "list": {
            "faction_id": "TT", "detachment_id": "D1", "points_limit": 2000,
            "entries": [{"uid": "a", "datasheet_id": "DS001", "model_count": 1}],
        }
    }
    result = client.post("/api/lists/validate", json=payload).json()
    assert result["points_used"] == 80
    assert result["points_free"] == 1920
    assert result["legal"] is True


def test_incremental_wendet_aktionen_an_und_prueft(client):
    """Ein Roundtrip: Aktion anwenden und validieren."""
    response = client.post("/api/lists/validate/incremental", json={
        "list": {"faction_id": "TT", "detachment_id": "D1", "points_limit": 2000,
                 "entries": []},
        "patch": [
            {"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": "chef"},
            {"type": "ADD_UNIT", "datasheet_id": "DS002", "uid": "trupp"},
            {"type": "ATTACH_LEADER", "uid": "chef", "target_uid": "trupp"},
        ],
    })
    data = response.json()
    assert len(data["list"]["entries"]) == 2
    assert data["list"]["entries"][0]["attached_to_uid"] == "trupp"
    assert data["validation"]["points_used"] == 170


def test_mehrere_requests_ueber_denselben_kontext(client):
    """Der Regelkontext wird über Requests gehalten.

    Er darf deshalb keine ORM-Objekte enthalten: Nach dem Commit ihrer
    Session sind die abgelöst und jeder Attributzugriff schlägt fehl.
    """
    liste = {
        "faction_id": "TT", "detachment_id": "D1", "points_limit": 2000,
        "entries": [],
    }
    for i in range(3):
        response = client.post("/api/lists/validate/incremental", json={
            "list": liste,
            "patch": [{"type": "ADD_UNIT", "datasheet_id": "DS001", "uid": f"u{i}"}],
        })
        assert response.status_code == 200, response.text
        liste = response.json()["list"]

    assert client.post("/api/lists/validate", json={"list": liste}).json()[
        "points_used"
    ] == 240


def test_incremental_meldet_kaputte_aktion(client):
    response = client.post("/api/lists/validate/incremental", json={
        "list": {"faction_id": "TT", "entries": []},
        "patch": [{"type": "REMOVE_UNIT", "uid": "gibtesnicht"}],
    })
    assert response.status_code == 400


def test_kontext_endpunkt_ist_ehrlich_leer(client):
    """Abschnitt 11 braucht Turnierdaten, die es noch nicht gibt."""
    data = client.get("/api/datasheets/DS001/context").json()
    assert data["available"] is False
    assert "Phase" in data["reason"]


def test_startseite_wird_ausgeliefert(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Listenbuilder" in response.text


@pytest.mark.parametrize("mode", ["quatsch", "FULL "])
def test_ungueltiger_modus_wird_abgelehnt(client, mode):
    assert client.get(f"/api/datasheets/DS001/card?mode={mode}").status_code == 422
