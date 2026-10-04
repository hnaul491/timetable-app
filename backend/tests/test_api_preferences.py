import pytest

from tests.conftest import AUTH

DEFAULT = {"language": None, "shortcuts": {}, "single_key_shortcuts": True, "shortcut_hints": True}


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
    body = {"shortcuts": {"go-board": "g x", "cal-new": None, "search": "Mod+Shift+k", "cal-today": "Alt+t"}, "single_key_shortcuts": False, "shortcut_hints": True}
    assert put(client, body).json() == {**DEFAULT, **body}
    assert client.get("/api/preferences", headers=AUTH).json() == {**DEFAULT, **body}


def test_partial_put_keeps_other_fields(client):
    put(client, {"language": "vi", "shortcuts": {"help": "F1"}, "single_key_shortcuts": False})
    assert put(client, {"language": "en"}).json() == {"language": "en", "shortcuts": {"help": "F1"}, "single_key_shortcuts": False, "shortcut_hints": True}
    assert put(client, {"single_key_shortcuts": True}).json() == {"language": "en", "shortcuts": {"help": "F1"}, "single_key_shortcuts": True, "shortcut_hints": True}
    assert put(client, {"shortcuts": {}}).json() == {**DEFAULT, "language": "en"}
    assert put(client, {}).json() == {**DEFAULT, "language": "en"}


@pytest.mark.parametrize("keys", ["g x", "Mod+k", "Shift+ArrowLeft", "Alt+Shift+t", "?", "+", "Escape", "F1"])
def test_valid_keys_accepted(client, keys):
    assert put(client, {"shortcuts": {"a": keys}}).status_code == 200


@pytest.mark.parametrize("keys", ["", "Ctrl+k", "Mod+", "g x y", "Shift+Mod+k", "a" * 33, "Mod+Mod+k", "ab cd ef", "Mod+g x", "g  x", "F5", "F11"])
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


@pytest.mark.parametrize(
    "keys",
    ["Tab", "Enter", "Space", "Shift+Tab", "g Tab", "Tab g", "g Space", "Mod+1", "Mod+9", "Mod+0", "Mod+=", "Mod+-", "Mod+h", "Mod+m", "F12", "Mod+Shift+i", "Mod+Shift+j", "Mod+Shift+c", "Mod+Tab"],
)
def test_reserved_keys_rejected(client, keys):
    assert put(client, {"shortcuts": {"a": keys}}).status_code == 422


@pytest.mark.parametrize("keys", ["Mod+Enter", "Alt+Space", "Mod+Shift+k", "Mod+i", "Mod+j"])
def test_non_reserved_combos_accepted(client, keys):
    assert put(client, {"shortcuts": {"a": keys}}).status_code == 200


def test_get_drops_invalid_stored_entries(client, session):
    from app.models import AppSetting

    put(client, {"language": "vi"})
    session.add(AppSetting(key="shortcuts", value={"ok": "g x", "bad": "Tab", "Bad Id": "n", "off": None, "num": 5}))
    session.add(AppSetting(key="single_key_shortcuts", value="yes"))
    session.commit()
    assert client.get("/api/preferences", headers=AUTH).json() == {
        "language": "vi",
        "shortcuts": {"ok": "g x", "off": None},
        "single_key_shortcuts": True,
        "shortcut_hints": True,
    }


def test_get_survives_non_dict_shortcuts(client, session):
    from app.models import AppSetting

    session.add(AppSetting(key="shortcuts", value=["x"]))
    session.commit()
    assert client.get("/api/preferences", headers=AUTH).json()["shortcuts"] == {}


def test_shortcut_hints_round_trip_and_partial(client):
    assert put(client, {"shortcut_hints": False}).json() == {**DEFAULT, "shortcut_hints": False}
    assert client.get("/api/preferences", headers=AUTH).json()["shortcut_hints"] is False
    assert put(client, {"language": "en"}).json()["shortcut_hints"] is False
    assert put(client, {"shortcut_hints": True}).json()["shortcut_hints"] is True


def test_shortcut_hints_must_be_boolean_and_lenient_on_read(client, session):
    from app.models import AppSetting

    assert put(client, {"shortcut_hints": "no"}).status_code == 422
    session.add(AppSetting(key="shortcut_hints", value="nope"))
    session.commit()
    assert client.get("/api/preferences", headers=AUTH).json()["shortcut_hints"] is True
