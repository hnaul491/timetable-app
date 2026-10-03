import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.deps import get_gcal_factory, get_now
from app.gcal.api import (ACCOUNT_ID, ALL_KINDS, CALENDAR_NAME, DEFAULT_KINDS, REFRESH_TOKEN_NAME, TIME_ZONE,
                          GcalFactory, GoogleError)
from app.gcal.push import _close, plan_ops, reset_calendar, run_push
from app.models import AppSecret, GoogleAccount
from app.schemas import GoogleConnectIn, GoogleKindsIn, GoogleStatusOut, PushResultOut
from app.secret_store import SecretStore
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

PUSH_BUDGET_S = 35.0


def _status(session: Session, settings: Settings, now: datetime) -> GoogleStatusOut:
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None:
        return GoogleStatusOut(configured=settings.google_configured, connected=False, email=None,
                               kinds=list(DEFAULT_KINDS), needs_reconnect=False, last_push_at=None,
                               last_push_error=None, pending=0)
    return GoogleStatusOut(
        configured=settings.google_configured, connected=True, email=account.email, kinds=list(account.kinds),
        needs_reconnect=account.needs_reconnect,
        last_push_at=iso_utc(account.last_push_at) if account.last_push_at else None,
        last_push_error=account.last_push_error,
        pending=len(plan_ops(session, account, now, settings.app_url)),
    )


@router.get("/google", response_model=GoogleStatusOut)
def google_status(session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
                  now: datetime = Depends(get_now)) -> GoogleStatusOut:
    return _status(session, settings, now)


@router.post("/google/connect", response_model=GoogleStatusOut)
def connect(body: GoogleConnectIn, user: CurrentUser = Depends(require_user),
            session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
            factory: GcalFactory = Depends(get_gcal_factory), now: datetime = Depends(get_now)) -> GoogleStatusOut:
    if not settings.google_configured:
        raise HTTPException(status_code=400, detail="Google Calendar is not set up on the server yet "
                                                    "(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)")
    refresh_token = body.refresh_token.strip()
    if not 10 <= len(refresh_token) <= 2048:
        raise HTTPException(status_code=422, detail="That Google token is not valid")
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None:
        account = GoogleAccount(id=ACCOUNT_ID, email=user.email, kinds=list(DEFAULT_KINDS), connected_at=now)
        session.add(account)
    account.email, account.needs_reconnect, account.connected_at = user.email, False, now
    account.last_push_error = None
    gcal = factory(refresh_token)
    try:
        if account.calendar_id is None:
            account.calendar_id = gcal.create_calendar(CALENDAR_NAME, TIME_ZONE)
    except GoogleError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=f"Google Calendar refused the connection: {exc}") from None
    finally:
        _close(gcal)
    SecretStore(session, settings.token_encryption_key).set(REFRESH_TOKEN_NAME, refresh_token)
    session.commit()
    return _status(session, settings, now)


@router.put("/google/kinds", response_model=GoogleStatusOut)
def set_kinds(body: GoogleKindsIn, session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
              now: datetime = Depends(get_now)) -> GoogleStatusOut:
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None:
        raise HTTPException(status_code=404, detail="Google Calendar is not connected")
    account.kinds = [kind for kind in ALL_KINDS if kind in set(body.kinds)]
    session.commit()
    return _status(session, settings, now)


@router.post("/google/push", response_model=PushResultOut)
def push_now(session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
             factory: GcalFactory = Depends(get_gcal_factory), now: datetime = Depends(get_now)) -> PushResultOut:
    result = run_push(session, settings, factory, now, time.monotonic() + PUSH_BUDGET_S)
    return PushResultOut(status=result.status, done=result.done, failed=result.failed, remaining=result.remaining,
                         error=result.error)


@router.delete("/google", status_code=204)
def disconnect(session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
               factory: GcalFactory = Depends(get_gcal_factory)) -> Response:
    if settings.google_configured:
        _revoke_quietly(session, settings, factory)
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is not None:
        reset_calendar(session, account)
        session.delete(account)
    session.execute(delete(AppSecret).where(AppSecret.name == REFRESH_TOKEN_NAME))
    session.commit()
    return Response(status_code=204)


def _revoke_quietly(session: Session, settings: Settings, factory: GcalFactory) -> None:
    """Tell Google to forget the stored refresh token. Best effort: never raises."""
    try:
        token = SecretStore(session, settings.token_encryption_key).get(REFRESH_TOKEN_NAME)
        if not token:
            return
        gcal = factory(token)
        try:
            revoke = getattr(gcal, "revoke", None)
            if callable(revoke):
                revoke()
        finally:
            _close(gcal)
    except Exception:  # noqa: BLE001
        session.rollback()
