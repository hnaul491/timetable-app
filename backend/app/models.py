from datetime import date, datetime

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, String,
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


class Subject(Base):
    __tablename__ = "subject"
    __table_args__ = (UniqueConstraint("semester_id", "display_name", name="uq_subject_semester_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id"))
    display_name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(7), default="#2E55E6")
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)


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
