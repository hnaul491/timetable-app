from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_cron_or_user, require_user
from app.db import get_session
from app.deps import get_fetcher, get_now
from app.models import SyncRun
from app.schemas import SyncRunOut, SyncStatusOut
from app.timeutil import iso_utc
from app.zeus.sync import Fetcher, run_sync

router = APIRouter(prefix="/api")


def to_out(run: SyncRun) -> SyncRunOut:
    return SyncRunOut(
        status=run.status, started_at=iso_utc(run.started_at),
        finished_at=iso_utc(run.finished_at) if run.finished_at else None,
        fetched=run.fetched, inserted=run.inserted, updated=run.updated,
        cancelled=run.cancelled, skipped=run.skipped, error=run.error,
    )


@router.post("/sync", response_model=SyncRunOut)
def trigger_sync(
    _caller: str = Depends(require_cron_or_user),
    session: Session = Depends(get_session),
    fetch: Fetcher = Depends(get_fetcher),
    now: datetime = Depends(get_now),
) -> SyncRunOut:
    return to_out(run_sync(session, fetch, now))


@router.get("/sync/status", response_model=SyncStatusOut, dependencies=[Depends(require_user)])
def sync_status(session: Session = Depends(get_session)) -> SyncStatusOut:
    last = session.scalar(select(SyncRun).order_by(SyncRun.id.desc()).limit(1))
    last_ok = session.scalar(
        select(SyncRun).where(SyncRun.status == "ok").order_by(SyncRun.id.desc()).limit(1)
    )
    return SyncStatusOut(
        last_run=to_out(last) if last else None,
        last_success_at=iso_utc(last_ok.finished_at) if last_ok and last_ok.finished_at else None,
    )
