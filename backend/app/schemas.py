import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StrictBool, StringConstraints, field_validator, model_validator


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


class ZeusGroupMismatch(BaseModel):
    link_group: int
    semester_group: int


class ZeusKeyStatus(BaseModel):
    configured: bool
    group_mismatch: ZeusGroupMismatch | None = None


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
    important: bool | None = None  # None keeps the current star


class ImportantIn(BaseModel):
    important: bool


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
    event_id: int | None = None
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


GoogleKind = Literal["class", "exam", "holiday", "work", "french_ext", "other"]


class GoogleStatusOut(BaseModel):
    configured: bool
    connected: bool
    email: str | None
    kinds: list[str]
    needs_reconnect: bool
    last_push_at: str | None
    last_push_error: str | None
    pending: int
    drive_enabled: bool = False


class GoogleConnectIn(BaseModel):
    refresh_token: str


class GoogleKindsIn(BaseModel):
    kinds: list[GoogleKind]


class PushResultOut(BaseModel):
    status: str
    done: int
    failed: int
    remaining: int
    error: str | None


Language = Literal["en", "vi"]


_KEY = r"(?:[A-Za-z][A-Za-z0-9]{1,15}|\S)"
SHORTCUT_KEYS = re.compile(rf"(?:(?:Mod\+)?(?:Alt\+)?(?:Shift\+)?{_KEY}|{_KEY} {_KEY})")
MAX_SHORTCUTS = 200
SHORTCUT_ID = re.compile(r"[a-z0-9-]{1,40}")
_PREFIX = re.compile(r"^(Mod\+)?(Alt\+)?(Shift\+)?")
# Keys the browser or OS owns, plus plain Tab/Enter/Space; mirrors frontend/src/lib/shortcutKeys.ts.
_RESERVED_WITH_MOD = {"w", "t", "n", "l", "r", "q", "f", "p", "h", "m", "=", "-", "tab", *"0123456789"}
_RESERVED_MOD_SHIFT = {"i", "j", "c"}


def shortcut_keys_ok(keys: object) -> bool:
    """True for a well-formed, allowed key string in the engine's syntax."""
    if not isinstance(keys, str) or len(keys) > 32 or not SHORTCUT_KEYS.fullmatch(keys):
        return False
    match = _PREFIX.match(keys)
    mod, alt, shift = (bool(g) for g in match.groups())
    rest = keys[match.end():]
    steps = [rest] if (mod or alt or shift) else rest.split(" ")
    if not (mod or alt) and any(step in ("Tab", "Enter", "Space") for step in steps):
        return False
    if len(steps) == 1:
        key = steps[0].lower() if len(steps[0]) == 1 else steps[0]
        if mod and (key in _RESERVED_WITH_MOD or key.lower() == "tab" or (shift and key in _RESERVED_MOD_SHIFT)):
            return False
        if key in ("F5", "F11", "F12") or (alt and key in ("ArrowLeft", "ArrowRight")):
            return False
    return True


def clean_shortcuts(raw: object) -> dict[str, str | None]:
    """Stored overrides without anything invalid, so one bad entry never breaks reading."""
    if not isinstance(raw, dict):
        return {}
    kept = {k: v for k, v in raw.items() if isinstance(k, str) and SHORTCUT_ID.fullmatch(k) and (v is None or shortcut_keys_ok(v))}
    return dict(list(kept.items())[:MAX_SHORTCUTS])


class Preferences(BaseModel):
    language: Language | None = None
    # id -> keys in the frontend engine's syntax; null turns that shortcut off.
    shortcuts: dict[str, str | None] = Field(default_factory=dict)
    single_key_shortcuts: StrictBool = True
    shortcut_hints: StrictBool = True

    @field_validator("shortcuts")
    @classmethod
    def _valid_shortcuts(cls, value: dict[str, str | None]) -> dict[str, str | None]:
        if len(value) > MAX_SHORTCUTS:
            raise ValueError(f"at most {MAX_SHORTCUTS} shortcuts")
        for key, keys in value.items():
            if not SHORTCUT_ID.fullmatch(key):
                raise ValueError("invalid shortcut id")
            if keys is not None and not shortcut_keys_ok(keys):
                raise ValueError("invalid shortcut keys")
        return value


class DocumentOut(BaseModel):
    id: int
    subject_id: int
    event_id: int | None
    event_start: str | None
    name: str
    mime_type: str
    size: int
    tag: str
    web_view_link: str
    preview_url: str | None = None
    created_at: str


class DocSubjectOut(BaseModel):
    id: int
    name: str
    color: str
    hidden: bool


class DocEventOut(BaseModel):
    id: int
    title: str
    start: str


class DocListItem(BaseModel):
    id: int
    subject: DocSubjectOut
    event: DocEventOut | None
    tag: str
    name: str
    mime_type: str
    size: int
    web_view_link: str
    preview_url: str | None = None
    created_at: str


class DocFolderSubject(DocSubjectOut):
    folder_url: str | None


class AllDocumentsOut(BaseModel):
    documents: list[DocListItem]
    subjects: list[DocFolderSubject]
    root_url: str | None
    semester_url: str | None


class UploadStartIn(BaseModel):
    subject_id: int
    event_id: int | None = None
    tag: Literal["slides", "exercises", "other"]
    name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(pattern=r"^[ -~]{1,255}$")
    size: int = Field(ge=0, le=104857600)


class UploadStartOut(BaseModel):
    upload_id: str
    chunk_size: int


class UploadChunkOut(BaseModel):
    received: int
    document: DocumentOut | None


class DocumentPatch(BaseModel):
    tag: Literal["slides", "exercises", "other"] | None = None
    event_id: int | None = None


class AiModelOut(BaseModel):
    id: str
    label: str
    note: str
    note_key: Literal["best", "fastest"] | None = None
    available: bool = True


class AiStatus(BaseModel):
    enabled: bool
    model: str
    models: list[AiModelOut]
    auto_fallback: bool


class AiSettingsIn(BaseModel):
    model: str | None = None
    auto_fallback: StrictBool | None = None


class SuggestIn(BaseModel):
    event_id: int
    tab: Literal["after", "before"]
    locale: Literal["en", "vi"] | None = None


class Suggestion(BaseModel):
    title: str
    due_date: date | None = None


class SuggestOut(BaseModel):
    suggestions: list[Suggestion]


class ChatContext(BaseModel):
    path: str | None = Field(default=None, max_length=200)
    event_id: int | None = None
    subject_id: int | None = None
    date: str | None = Field(default=None, max_length=10)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    context: ChatContext = Field(default_factory=ChatContext)
    locale: Literal["en", "vi"] | None = None


class PendingActionOut(BaseModel):
    id: int
    kind: str
    status: str
    summary: str
    payload: dict
    result: dict | None = None
    expires_at: str


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    actions: list[PendingActionOut]


class ChatHistory(BaseModel):
    messages: list[ChatMessageOut]


class ChatReply(BaseModel):
    message: ChatMessageOut


class ActionResult(BaseModel):
    status: str
    result: dict | None = None


class SearchEvent(BaseModel):
    id: int
    title: str
    start: str
    end: str
    room: str | None = None
    cancelled: bool = False
    title_raw: str | None = None


class SearchSubject(BaseModel):
    id: int
    name: str


class SearchNote(BaseModel):
    id: int
    event_id: int
    event_title: str
    snippet: str


class SearchTask(BaseModel):
    id: int
    title: str
    done: bool
    due: date | None = None
    event_id: int | None = None


class SearchDocument(BaseModel):
    id: int
    name: str
    subject_id: int
    web_view_link: str | None = None


class SearchResponse(BaseModel):
    events: list[SearchEvent]
    subjects: list[SearchSubject]
    notes: list[SearchNote]
    tasks: list[SearchTask]
    documents: list[SearchDocument]


class BackupStatusOut(BaseModel):
    drive_available: bool
    last_at: str | None


class BackupDriveOut(BaseModel):
    file_name: str
    created_at: str
