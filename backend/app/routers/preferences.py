from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.models import AppSetting
from app.schemas import Preferences, clean_shortcuts

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
LANGUAGE_KEY = "language"
SHORTCUTS_KEY = "shortcuts"
SINGLE_KEY_KEY = "single_key_shortcuts"
HINTS_KEY = "shortcut_hints"


def _read(session: Session) -> Preferences:
    language = session.get(AppSetting, LANGUAGE_KEY)
    shortcuts = session.get(AppSetting, SHORTCUTS_KEY)
    single = session.get(AppSetting, SINGLE_KEY_KEY)
    hints = session.get(AppSetting, HINTS_KEY)
    # Lenient: stored data that no longer validates is dropped rather than failing the whole read.
    return Preferences(
        language=language.value if language and language.value in ("en", "vi") else None,
        shortcuts=clean_shortcuts(shortcuts.value if shortcuts else {}),
        single_key_shortcuts=single.value if single and isinstance(single.value, bool) else True,
        shortcut_hints=hints.value if hints and isinstance(hints.value, bool) else True,
    )


def _write(session: Session, key: str, value: object | None) -> None:
    row = session.get(AppSetting, key)
    if value is None:
        if row is not None:
            session.delete(row)
    elif row is None:
        session.add(AppSetting(key=key, value=value))
    else:
        row.value = value


@router.get("/preferences", response_model=Preferences)
def get_preferences(session: Session = Depends(get_session)) -> Preferences:
    return _read(session)


@router.put("/preferences", response_model=Preferences)
def put_preferences(body: Preferences, session: Session = Depends(get_session)) -> Preferences:
    # Partial update: only the fields the client sent are touched.
    sent = body.model_fields_set
    if "language" in sent:
        _write(session, LANGUAGE_KEY, body.language)
    if "shortcuts" in sent:
        _write(session, SHORTCUTS_KEY, body.shortcuts or None)
    if "single_key_shortcuts" in sent:
        _write(session, SINGLE_KEY_KEY, None if body.single_key_shortcuts else False)
    if "shortcut_hints" in sent:
        _write(session, HINTS_KEY, None if body.shortcut_hints else False)
    session.commit()
    return _read(session)
