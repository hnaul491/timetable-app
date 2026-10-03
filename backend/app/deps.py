from datetime import datetime, timezone

from fastapi import Depends
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session
from app.models import Semester
from app.secret_store import get_zeus_key
from app.zeus.ics_client import ZeusFetchError, build_ics_url, fetch_ics
from app.zeus.sync import Fetcher


def get_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_fetcher(
    session: Session = Depends(get_session), settings: Settings = Depends(get_settings)
) -> Fetcher:
    def fetch(semester: Semester) -> str:
        key = get_zeus_key(session, settings)
        if not key:
            raise ZeusFetchError("no Zeus ICS link configured")
        if semester.zeus_group_id is None:
            raise ZeusFetchError("active semester has no Zeus group id")
        return fetch_ics(build_ics_url(settings.zeus_base_url, semester.zeus_group_id, key))

    return fetch
