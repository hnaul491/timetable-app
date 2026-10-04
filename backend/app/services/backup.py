import json
import logging
import re
import time
from collections.abc import Callable
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.gcal.api import GoogleError
from app.gdrive.api import DriveFactory, GoogleDrive
from app.models import (AppSetting, Document, Event, MySection, Note, RecurringRule, Semester, Subject, Task,
                        WeekReview)
from app.services import documents as docs
from app.timeutil import iso_utc

logger = logging.getLogger(__name__)

FORMAT = "timetable-backup"
VERSION = 1
LAST_KEY = "backup_last_at"
FOLDER_KEY = "backup_folder_id"
FOLDER_NAME = "Backups"
EVERY = timedelta(days=7)
KEEP = 8
MIN_BUDGET_S = 10.0
MIME = "application/json"
_NAME = re.compile(r"^timetable-backup-\d{4}-\d{2}-\d{2}\.json$")
SETTING_KEYS = ("language",)  # the user's own app_setting rows; the rest are folder ids and the like


def file_name(now: datetime) -> str:
    return f"timetable-backup-{now.date().isoformat()}.json"


def _iso(value: object) -> str | None:
    if value is None:
        return None
    return iso_utc(value) if isinstance(value, datetime) else value.isoformat()  # type: ignore[attr-defined]


def build_backup(session: Session, now: datetime) -> dict:
    """Everything the user typed, as plain JSON. Secrets, tokens, Google ids, upload sessions, pending actions
    and chat messages are never read here."""
    sections = {row.subject_id: row.section for row in session.scalars(select(MySection))}
    zeus = {e.id: e for e in session.scalars(select(Event).where(Event.zeus_uid.is_not(None)))}
    zeus_uid = {event_id: e.zeus_uid for event_id, e in zeus.items()}
    notes = list(session.scalars(select(Note).order_by(Note.id)))
    tasks = list(session.scalars(select(Task).order_by(Task.id)))
    documents = list(session.scalars(select(Document).order_by(Document.id)))
    referenced = {x.event_id for x in (*notes, *tasks, *documents) if x.event_id in zeus}
    return {
        "format": FORMAT, "version": VERSION, "created_at": iso_utc(now),
        "semesters": [
            {"id": s.id, "code": s.code, "name": s.name, "zeus_group_id": s.zeus_group_id,
             "start_date": _iso(s.start_date), "end_date": _iso(s.end_date), "is_active": s.is_active}
            for s in session.scalars(select(Semester).order_by(Semester.id))],
        "subjects": [
            {"id": s.id, "semester_id": s.semester_id, "display_name": s.display_name, "color": s.color,
             "aliases": list(s.aliases or []), "hidden": s.hidden, "section": sections.get(s.id)}
            for s in session.scalars(select(Subject).order_by(Subject.id))],
        "events": [
            {"id": e.id, "semester_id": e.semester_id, "subject_id": e.subject_id, "title_raw": e.title_raw,
             "start_at": _iso(e.start_at), "end_at": _iso(e.end_at), "room": e.room, "description": e.description,
             "kind": e.kind, "status": e.status, "recurring_rule_id": e.recurring_rule_id}
            for e in session.scalars(select(Event).where(Event.source == "custom").order_by(Event.id))],
        "rules": [
            {"id": r.id, "semester_id": r.semester_id, "title": r.title, "kind": r.kind,
             "weekdays": list(r.weekdays or []), "start_time": r.start_time, "end_time": r.end_time,
             "from_date": _iso(r.from_date), "until_date": _iso(r.until_date), "location": r.location}
            for r in session.scalars(select(RecurringRule).order_by(RecurringRule.id))],
        "notes": [
            {"id": n.id, "event_id": n.event_id, "event_zeus_uid": zeus_uid.get(n.event_id), "tab": n.tab,
             "body": n.body, "important": n.important, "updated_at": _iso(n.updated_at)}
            for n in notes],
        "tasks": [
            {"id": t.id, "note_id": t.note_id, "event_id": t.event_id, "event_zeus_uid": zeus_uid.get(t.event_id),
             "subject_id": t.subject_id, "title": t.title, "status": t.status, "due_date": _iso(t.due_date),
             "important": t.important, "position": t.position, "source": t.source, "created_at": _iso(t.created_at)}
            for t in tasks],
        "week_review": [
            {"semester_id": w.semester_id, "week_start": _iso(w.week_start), "reviewed_at": _iso(w.reviewed_at)}
            for w in session.scalars(select(WeekReview).order_by(WeekReview.semester_id, WeekReview.week_start))],
        "settings": {row.key: row.value for row in session.scalars(
            select(AppSetting).where(AppSetting.key.in_(SETTING_KEYS)))},
        "zeus_events": [
            {"zeus_uid": e.zeus_uid, "semester_id": e.semester_id, "subject_id": e.subject_id,
             "title_raw": e.title_raw, "start_at": _iso(e.start_at), "end_at": _iso(e.end_at), "kind": e.kind,
             "room": e.room, "status": e.status}
            for event_id, e in sorted(zeus.items()) if event_id in referenced],
        "documents": [
            {"id": d.id, "subject_id": d.subject_id, "event_id": d.event_id, "event_zeus_uid": zeus_uid.get(d.event_id),
             "drive_file_id": d.drive_file_id, "name": d.name,
             "mime_type": d.mime_type, "size": d.size, "tag": d.tag, "created_at": _iso(d.created_at)}
            for d in documents],
    }


def last_backup_at(session: Session) -> datetime | None:
    row = session.get(AppSetting, LAST_KEY)
    try:
        return datetime.fromisoformat(row.value) if row is not None and isinstance(row.value, str) else None
    except ValueError:
        return None


def _set_setting(session: Session, key: str, value: str) -> None:
    row = session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def backup_folder(session: Session, drive: GoogleDrive) -> str:
    """The id of Timetable/Backups, creating whatever is missing. A deleted or trashed Timetable root also
    invalidates every cached folder id below it (Backups, semesters, subjects)."""
    root = docs._root_id(session)
    if root is not None and not drive.folder_exists(root):
        docs._set_root(session, None)
        session.query(AppSetting).filter(AppSetting.key == FOLDER_KEY).delete()
        for semester in session.scalars(select(Semester)):
            semester.drive_folder_id = None
        for subject in session.scalars(select(Subject)):
            subject.drive_folder_id = None
        root = None
        session.commit()
    row = session.get(AppSetting, FOLDER_KEY)
    if root is not None and row is not None and isinstance(row.value, str) and row.value \
            and drive.folder_exists(row.value):
        return row.value
    if root is None:
        root = drive.create_folder(docs.ROOT_NAME, None)
        docs._set_root(session, root)
        session.commit()
    folder = drive.create_folder(FOLDER_NAME, root)
    _set_setting(session, FOLDER_KEY, folder)
    session.commit()
    return folder


def prune(drive: GoogleDrive, folder: str) -> None:
    """Keep the newest KEEP backups (by the date in the name); other files in the folder are left alone."""
    ours = sorted((f for f in drive.list_files(folder) if _NAME.match(f.name)), key=lambda f: f.name, reverse=True)
    for old in ours[KEEP:]:
        drive.trash(old.id)


def upload_backup(session: Session, drive: GoogleDrive, now: datetime, deadline: float | None = None,
                  clock: Callable[[], float] = time.monotonic) -> str:
    """Upload one backup, record the time, then prune. Upload errors propagate; prune errors are only logged."""
    folder = backup_folder(session, drive)
    name = file_name(now)
    body = json.dumps(build_backup(session, now), ensure_ascii=False).encode("utf-8")
    drive.upload_file(name, MIME, body, folder)
    _set_setting(session, LAST_KEY, now.isoformat())
    session.commit()
    try:
        if deadline is None or deadline - clock() >= MIN_BUDGET_S:
            prune(drive, folder)
    except Exception as exc:  # noqa: BLE001 - the backup itself is safe in Drive
        logger.warning("Pruning old backups failed (%s)", type(exc).__name__)
    return name


def backup_now(session: Session, settings: Settings, factory: DriveFactory, now: datetime,
               deadline: float | None = None) -> str:
    """Back up to Drive: 409 without Drive, 502 when Google fails."""
    drive = docs.open_drive(session, settings, factory)
    try:
        return upload_backup(session, drive, now, deadline)
    except GoogleError as exc:
        session.rollback()
        raise docs.google_error(exc) from exc
    finally:
        docs.close_drive(drive)


def run_weekly_backup(session: Session, settings: Settings, factory: DriveFactory, now: datetime,
                      deadline: float, clock: Callable[[], float] = time.monotonic) -> None:
    """Called after the cron sync. Best effort: never raises, logs the error type only."""
    try:
        if deadline - clock() < MIN_BUDGET_S:
            return
        last = last_backup_at(session)
        if last is not None and now - last < EVERY - timedelta(hours=6):  # cron start times drift by minutes
            return
        try:
            backup_now(session, settings, factory, now, deadline)
        except HTTPException as exc:
            if exc.status_code != 409:
                logger.warning("Automatic backup failed (HTTP %s)", exc.status_code)
    except Exception as exc:  # noqa: BLE001 - the sync must not fail because of a backup
        logger.warning("Automatic backup failed (%s)", type(exc).__name__)
        try:
            session.rollback()
        except Exception:  # noqa: BLE001
            pass
