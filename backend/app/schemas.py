from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


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


class CustomEventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: CustomKind
    start: datetime
    end: datetime
    room: str = Field(default="", max_length=200)


class RecurringRuleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
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
