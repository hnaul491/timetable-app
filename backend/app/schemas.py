from datetime import date

from pydantic import BaseModel, Field


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
    note_count: int = 0
    open_tasks: int = 0
    important: bool = False


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


class NoteOut(BaseModel):
    tab: str
    body: str
    important: bool
    updated_at: str | None


class TaskOut(BaseModel):
    id: int
    title: str
    status: str
    due_date: date | None
    important: bool
    source: str
    note_id: int | None
    event_id: int | None
    subject_id: int | None
    subject_name: str | None
    event_start: str | None
    position: int


class EventDetailOut(BaseModel):
    event: EventOut
    notes: dict[str, NoteOut]
    tasks: list[TaskOut]
    next_event_id: int | None
    next_event_start: str | None
    recurring_rule_id: int | None


class NoteUpdate(BaseModel):
    body: str = Field(default="", max_length=20000)
    important: bool = False
