from collections.abc import Iterator
from datetime import datetime, timezone

import httpx
from fastapi import Depends
from sqlalchemy.orm import Session

from app.ai.gemini import GeminiProvider
from app.ai.models import FallbackProvider, auto_fallback, selected_model
from app.ai.provider import LLMProvider
from app.config import Settings, get_settings
from app.db import get_session
from app.gcal.api import GcalFactory, GoogleCalendar
from app.gcal.http_client import GoogleSession, HttpGoogleCalendar
from app.gdrive.api import DriveFactory, GoogleDrive
from app.gdrive.http_client import HttpGoogleDrive
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


def get_gcal_factory(settings: Settings = Depends(get_settings)) -> GcalFactory:
    def make(refresh_token: str) -> GoogleCalendar:
        return HttpGoogleCalendar(settings.google_client_id, settings.google_client_secret, refresh_token)

    return make


def get_drive_factory(settings: Settings = Depends(get_settings)) -> DriveFactory:
    def make(refresh_token: str) -> GoogleDrive:
        return HttpGoogleDrive(GoogleSession(settings.google_client_id, settings.google_client_secret, refresh_token))

    return make


def get_llm(settings: Settings = Depends(get_settings),
            session: Session = Depends(get_session)) -> Iterator[LLMProvider | None]:
    if not settings.ai_enabled:
        yield None
        return
    model = selected_model(session, settings.gemini_model)
    fallback = auto_fallback(session)
    http = httpx.Client(timeout=30)

    def make(model_id: str) -> LLMProvider:
        return GeminiProvider(settings.gemini_api_key, model_id, http=http)

    try:
        yield FallbackProvider(model, make) if fallback else make(model)
    finally:
        http.close()
