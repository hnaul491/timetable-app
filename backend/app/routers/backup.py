import json
from datetime import datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.auth import require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.deps import get_drive_factory, get_now
from app.gcal.api import ACCOUNT_ID
from app.gdrive.api import DriveFactory
from app.models import GoogleAccount
from app.schemas import BackupDriveOut, BackupStatusOut
from app.services import backup as service
from app.services.documents import drive_enabled
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


@router.get("/backup")
def download(session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> Response:
    body = json.dumps(service.build_backup(session, now), ensure_ascii=False, indent=2)
    return Response(content=body, media_type="application/json", headers={
        "Content-Disposition": f'attachment; filename="{service.file_name(now)}"', "Cache-Control": "no-store"})


@router.get("/backup/status", response_model=BackupStatusOut)
def status(session: Session = Depends(get_session)) -> BackupStatusOut:
    last = service.last_backup_at(session)
    return BackupStatusOut(drive_available=drive_enabled(session.get(GoogleAccount, ACCOUNT_ID)),
                           last_at=iso_utc(last) if last else None)


@router.post("/backup/drive", response_model=BackupDriveOut)
def back_up_to_drive(session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
                     factory: DriveFactory = Depends(get_drive_factory),
                     now: datetime = Depends(get_now)) -> BackupDriveOut:
    name = service.backup_now(session, settings, factory, now)
    return BackupDriveOut(file_name=name, created_at=iso_utc(now))
