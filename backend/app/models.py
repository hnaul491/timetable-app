from datetime import date, datetime

from sqlalchemy import (JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, String,
                        Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Semester(Base):
    __tablename__ = "semester"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    zeus_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    drive_folder_id: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Subject(Base):
    __tablename__ = "subject"
    __table_args__ = (UniqueConstraint("semester_id", "display_name", name="uq_subject_semester_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id"))
    display_name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(7), default="#2E55E6")
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    drive_folder_id: Mapped[str | None] = mapped_column(String(255), nullable=True)


class MySection(Base):
    __tablename__ = "my_section"

    subject_id: Mapped[int] = mapped_column(ForeignKey("subject.id"), primary_key=True)
    section: Mapped[str] = mapped_column(String(16))


class Event(Base):
    __tablename__ = "event"
    __table_args__ = (Index("ix_event_semester_start", "semester_id", "start_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(16))
    zeus_uid: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id"))
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subject.id"), nullable=True)
    section: Mapped[str | None] = mapped_column(String(16), nullable=True)
    title_raw: Mapped[str] = mapped_column(String(300))
    start_at: Mapped[datetime] = mapped_column(DateTime)
    end_at: Mapped[datetime] = mapped_column(DateTime)
    room: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="normal")
    changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    recurring_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_rule.id", name="fk_event_recurring_rule"), nullable=True
    )
    gcal_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gcal_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class SyncRun(Base):
    __tablename__ = "sync_run"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    fetched: Mapped[int] = mapped_column(Integer, default=0)
    inserted: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    cancelled: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AppSecret(Base):
    __tablename__ = "app_secret"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_encrypted: Mapped[str] = mapped_column(Text)


class RecurringRule(Base):
    __tablename__ = "recurring_rule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id"))
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))
    weekdays: Mapped[list[int]] = mapped_column(JSON, default=list)
    start_time: Mapped[str] = mapped_column(String(5))
    end_time: Mapped[str] = mapped_column(String(5))
    from_date: Mapped[date] = mapped_column(Date)
    until_date: Mapped[date] = mapped_column(Date)
    location: Mapped[str] = mapped_column(String(200), default="")


class Note(Base):
    __tablename__ = "note"
    __table_args__ = (UniqueConstraint("event_id", "tab", name="uq_note_event_tab"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("event.id"))
    tab: Mapped[str] = mapped_column(String(8))
    body: Mapped[str] = mapped_column(Text, default="")
    important: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class Task(Base):
    __tablename__ = "task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int | None] = mapped_column(ForeignKey("note.id"), nullable=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("event.id"), nullable=True)
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subject.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(8), default="todo")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    important: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class WeekReview(Base):
    __tablename__ = "week_review"

    week_start: Mapped[date] = mapped_column(Date, primary_key=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime)


class GoogleAccount(Base):
    __tablename__ = "google_account"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    calendar_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kinds: Mapped[list[str]] = mapped_column(JSON, default=list)
    needs_reconnect: Mapped[bool] = mapped_column(Boolean, default=False)
    connected_at: Mapped[datetime] = mapped_column(DateTime)
    last_push_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_push_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    push_lock_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scopes: Mapped[str] = mapped_column(Text, default="", server_default="")


class GcalTombstone(Base):
    __tablename__ = "gcal_tombstone"

    gcal_event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class AppSetting(Base):
    __tablename__ = "app_setting"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[object] = mapped_column(JSON)


class Document(Base):
    __tablename__ = "document"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subject.id"), index=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("event.id"), nullable=True, index=True)
    drive_file_id: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(BigInteger)
    tag: Mapped[str] = mapped_column(String(16))
    web_view_link: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime)


class DocumentUpload(Base):
    __tablename__ = "document_upload"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_uri: Mapped[str] = mapped_column(Text)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subject.id"))
    event_id: Mapped[int | None] = mapped_column(ForeignKey("event.id"), nullable=True)
    tag: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(BigInteger)
    received: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class PendingAction(Base):
    __tablename__ = "pending_action"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class ChatMessage(Base):
    __tablename__ = "chat_message"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    actions: Mapped[list[int]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime)
