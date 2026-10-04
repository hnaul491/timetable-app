import pytest

from tests.conftest import AUTH

DEFAULT = {"language": None, "shortcuts": {}, "single_key_shortcuts": True}


def test_requires_login(client):
    assert client.get("/api/preferences").status_code == 401
    assert client.put("/api/preferences", json={"language": "vi"}).status_code == 401


def test_default_is_no_language(client):
    assert client.get("/api/preferences", headers=AUTH).json() == DEFAULT


def test_set_read_and_clear_language(client):
    assert client.put("/api/preferences", headers=AUTH, json={"language": "vi"}).json() == {**DEFAULT, "language": "vi"}
    assert client.get("/api/preferences", headers=AUTH).json() == {**DEFAULT, "language": "vi"}
    assert client.put("/api/preferences", headers=AUTH, json={"language": "en"}).json() == {**DEFAULT, "language": "en"}
    assert client.put("/api/preferences", headers=AUTH, json={"language": None}).json() == DEFAULT
    assert client.get("/api/preferences", headers=AUTH).json() == DEFAULT


def test_unknown_language_is_rejected(client):
    assert client.put("/api/preferences", headers=AUTH, json={"language": "fr"}).status_code == 422


def put(client, body):
    return client.put("/api/preferences", headers=AUTH, json=body)


def test_shortcuts_round_trip_and_off(client):
    body = {"shortcuts": {"go-board": "g x", "cal-new": None, "search": "Mod+Shift+k", "cal-today": "Alt+t"}, "single_key_shortcuts": False}
    assert put(client, body).json() == {**DEFAULT, **body}
    assert client.get("/api/preferences", headers=AUTH).json() == {**DEFAULT, **body}


def test_partial_put_keeps_other_fields(client):
    put(client, {"language": "vi", "shortcuts": {"help": "F1"}, "single_key_shortcuts": False})
    assert put(client, {"language": "en"}).json() == {"language": "en", "shortcuts": {"help": "F1"}, "single_key_shortcuts": False}
    assert put(client, {"single_key_shortcuts": True}).json() == {"language": "en", "shortcuts": {"help": "F1"}, "single_key_shortcuts": True}
    assert put(client, {"shortcuts": {}}).json() == {**DEFAULT, "language": "en"}
    assert put(client, {}).json() == {**DEFAULT, "language": "en"}


@pytest.mark.parametrize("keys", ["g x", "Mod+k", "Shift+ArrowLeft", "Alt+Shift+t", "?", "+", "Escape", "F5"])
def test_valid_keys_accepted(client, keys):
    assert put(client, {"shortcuts": {"a": keys}}).status_code == 200


@pytest.mark.parametrize("keys", ["", "Ctrl+k", "Mod+", "g x y", "Shift+Mod+k", "a" * 33, "Mod+Mod+k", "ab cd ef", "Mod+g x", "g  x"])
def test_invalid_keys_rejected(client, keys):
    assert put(client, {"shortcuts": {"a": keys}}).status_code == 422


@pytest.mark.parametrize("shortcut_id", ["", "Upper", "has space", "x" * 41, "under_score"])
def test_invalid_ids_rejected(client, shortcut_id):
    assert put(client, {"shortcuts": {shortcut_id: "g"}}).status_code == 422


def test_entry_cap(client):
    assert put(client, {"shortcuts": {f"s{i}": "g" for i in range(200)}}).status_code == 200
    assert put(client, {"shortcuts": {f"s{i}": "g" for i in range(201)}}).status_code == 422


def test_single_key_flag_must_be_boolean(client):
    assert put(client, {"single_key_shortcuts": "no"}).status_code == 422
