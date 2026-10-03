from datetime import date

from pydantic import BaseModel


class EventOut(BaseModel):
    id: int
    title: str
    subject_id: int | None
    subject_name: str | None
    color: str | None
    section: str | None
    start: str
    end: str
    room: str
    kind: str
    status: str
    source: str


class EventsResponse(BaseModel):
    events: list[EventOut]
    missing_sections: list[str]


class SemesterOut(BaseModel):
    id: int
    code: str
    name: str
    zeus_group_id: int | None
    start_date: date | None
    end_date: date | None
    is_active: bool


class SectionChoiceOut(BaseModel):
    subject_id: int
    subject_name: str
    sections: list[str]
    chosen: str | None


class SectionUpdate(BaseModel):
    subject_id: int
    section: str


class ZeusKeyUpdate(BaseModel):
    value: str


class ZeusKeyStatus(BaseModel):
    configured: bool


class SyncRunOut(BaseModel):
    status: str
    started_at: str
    finished_at: str | None
    fetched: int
    inserted: int
    updated: int
    cancelled: int
    skipped: int
    error: str | None


class SyncStatusOut(BaseModel):
    last_run: SyncRunOut | None
    last_success_at: str | None
