from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AppSecret

ZEUS_KEY_NAME = "zeus_ics_key"


class SecretStore:
    def __init__(self, session: Session, encryption_key: str) -> None:
        if not encryption_key:
            raise ValueError("TOKEN_ENCRYPTION_KEY is not set")
        self._session = session
        self._fernet = Fernet(encryption_key.encode())

    def set(self, name: str, value: str) -> None:
        token = self._fernet.encrypt(value.encode()).decode()
        row = self._session.get(AppSecret, name)
        if row is None:
            self._session.add(AppSecret(name=name, value_encrypted=token))
        else:
            row.value_encrypted = token
        self._session.flush()

    def get(self, name: str) -> str | None:
        row = self._session.get(AppSecret, name)
        if row is None:
            return None
        try:
            return self._fernet.decrypt(row.value_encrypted.encode()).decode()
        except InvalidToken:
            return None


def encrypt_text(encryption_key: str, value: str) -> str:
    """A Fernet token for `value`, for columns that must not hold the plain text."""
    if not encryption_key:
        raise ValueError("TOKEN_ENCRYPTION_KEY is not set")
    return Fernet(encryption_key.encode()).encrypt(value.encode()).decode()


def decrypt_text(encryption_key: str, token: str) -> str | None:
    """The text inside a token made by `encrypt_text`; None when it is not one (e.g. a legacy plain value)."""
    if not encryption_key:
        raise ValueError("TOKEN_ENCRYPTION_KEY is not set")
    try:
        return Fernet(encryption_key.encode()).decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def get_zeus_key(session: Session, settings: Settings) -> str | None:
    if settings.token_encryption_key:
        stored = SecretStore(session, settings.token_encryption_key).get(ZEUS_KEY_NAME)
        if stored:
            return stored
    return settings.zeus_ics_key or None
