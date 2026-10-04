from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.models import AppSetting
from app.schemas import Preferences

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
LANGUAGE_KEY = "language"


def _read(session: Session) -> Preferences:
    row = session.get(AppSetting, LANGUAGE_KEY)
    return Preferences(language=row.value if row else None)


@router.get("/preferences", response_model=Preferences)
def get_preferences(session: Session = Depends(get_session)) -> Preferences:
    return _read(session)


@router.put("/preferences", response_model=Preferences)
def put_preferences(body: Preferences, session: Session = Depends(get_session)) -> Preferences:
    row = session.get(AppSetting, LANGUAGE_KEY)
    if body.language is None:
        if row is not None:
            session.delete(row)
    elif row is None:
        session.add(AppSetting(key=LANGUAGE_KEY, value=body.language))
    else:
        row.value = body.language
    session.commit()
    return _read(session)
