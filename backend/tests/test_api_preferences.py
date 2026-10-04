from tests.conftest import AUTH


def test_requires_login(client):
    assert client.get("/api/preferences").status_code == 401
    assert client.put("/api/preferences", json={"language": "vi"}).status_code == 401


def test_default_is_no_language(client):
    assert client.get("/api/preferences", headers=AUTH).json() == {"language": None}


def test_set_read_and_clear_language(client):
    assert client.put("/api/preferences", headers=AUTH, json={"language": "vi"}).json() == {"language": "vi"}
    assert client.get("/api/preferences", headers=AUTH).json() == {"language": "vi"}
    assert client.put("/api/preferences", headers=AUTH, json={"language": "en"}).json() == {"language": "en"}
    assert client.put("/api/preferences", headers=AUTH, json={"language": None}).json() == {"language": None}
    assert client.get("/api/preferences", headers=AUTH).json() == {"language": None}


def test_unknown_language_is_rejected(client):
    assert client.put("/api/preferences", headers=AUTH, json={"language": "fr"}).status_code == 422
