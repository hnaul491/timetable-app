from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator


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


CustomKind = Literal["work", "french_ext", "other"]
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class CustomEventIn(BaseModel):
    title: Title
    kind: CustomKind
    start: datetime
    end: datetime
    room: str = Field(default="", max_length=200)


class RecurringRuleIn(BaseModel):
    title: Title
    kind: CustomKind
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start_time: str = Field(pattern=HHMM)
    end_time: str = Field(pattern=HHMM)
    from_date: date
    until_date: date
    location: str = Field(default="", max_length=200)

    @field_validator("weekdays")
    @classmethod
    def _valid_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("weekdays must be 0 (Monday) to 6 (Sunday)")
        return sorted(set(value))

    @model_validator(mode="after")
    def _valid_range(self) -> "RecurringRuleIn":
        if self.until_date < self.from_date:
            raise ValueError("until_date must be on or after from_date")
        if (self.until_date - self.from_date).days > 400:
            raise ValueError("a repeating event can span at most 400 days")
        if self.start_time == self.end_time:
            raise ValueError("start and end time must differ")
        return self


class RecurringRuleOut(BaseModel):
    id: int
    title: str
    kind: str
    weekdays: list[int]
    start_time: str
    end_time: str
    from_date: date
    until_date: date
    location: str
    occurrences: int


class Deleted(BaseModel):
    deleted: bool


TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class TaskCreate(BaseModel):
    title: TaskTitle
    due_date: date | None = None
    subject_id: int | None = None
    important: bool = False


class TaskPatch(BaseModel):
    status: Literal["todo", "doing", "done"] | None = None
    due_date: date | None = None
    title: TaskTitle | None = None
    important: bool | None = None


Color = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


class SubjectSummaryOut(BaseModel):
    id: int
    display_name: str
    color: str
    hidden: bool
    aliases: list[str]
    sessions: int
    sessions_done: int
    next_start: str | None
    exam_start: str | None
    exam_room: str | None
    open_tasks: int
    note_count: int


class SessionOut(BaseModel):
    id: int
    start: str
    end: str
    room: str
    kind: str
    status: str
    section: str | None
    note_snippet: str | None
    note_count: int
    open_tasks: int
    important: bool


class SubjectDetailOut(BaseModel):
    subject: SubjectSummaryOut
    sessions: list[SessionOut]
    tasks: list[TaskOut]


class SubjectPatch(BaseModel):
    display_name: Title | None = None
    color: Color | None = None
    hidden: bool | None = None


class MergeIn(BaseModel):
    into_id: int


class SemesterPatch(BaseModel):
    zeus_group_id: int | None = Field(default=None, gt=0)
    start_date: date | None = None
    end_date: date | None = None


class ImportantNoteOut(BaseModel):
    event_id: int
    title: str
    start: str
    tab: str
    body: str


class ReviewOut(BaseModel):
    week_start: date
    week_end: date
    reviewed_at: str | None
    overdue: list[TaskOut]
    due_this_week: list[TaskOut]
    important: list[ImportantNoteOut]
    without_notes: list[EventOut]
    changes: list[EventOut]
    week: list[EventOut]
    hours: dict[str, float]


class ReviewMarkOut(BaseModel):
    week_start: date
    reviewed_at: str
