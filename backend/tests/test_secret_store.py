from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import Settings
from app.models import AppSecret
from app.secret_store import ZEUS_KEY_NAME, SecretStore, get_zeus_key

KEY = Fernet.generate_key().decode()


def test_round_trip_and_ciphertext_differs(session):
    store = SecretStore(session, KEY)
    store.set("x", "secret-value")
    store.set("x", "secret-value-2")
    session.commit()
    row = session.scalar(select(AppSecret))
    assert "secret-value" not in row.value_encrypted
    assert store.get("x") == "secret-value-2"


def test_wrong_key_returns_none(session):
    SecretStore(session, KEY).set("x", "v")
    session.commit()
    assert SecretStore(session, Fernet.generate_key().decode()).get("x") is None


def test_get_zeus_key_prefers_db_then_env(session):
    settings = Settings(token_encryption_key=KEY, zeus_ics_key="fromenv")
    assert get_zeus_key(session, settings) == "fromenv"
    SecretStore(session, KEY).set(ZEUS_KEY_NAME, "fromdb")
    assert get_zeus_key(session, settings) == "fromdb"


def test_get_zeus_key_none_when_unset(session):
    assert get_zeus_key(session, Settings(token_encryption_key=KEY, zeus_ics_key="")) is None
