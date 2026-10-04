import time
from collections.abc import Callable, Iterator

from sqlalchemy.orm import Session

from app.ai.provider import AIModelMissing, AIRateLimited, LLMProvider, LLMReply, StreamPart, ToolDecl, Turn
from app.models import AppSetting

# Fallback order. Only these ids are ever sent to Google.
MODELS: list[dict[str, str | None]] = [
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "note": "best quality", "note_key": "best"},
    {"id": "gemini-3.7-flash", "label": "Gemini 3.7 Flash", "note": "", "note_key": None},
    {"id": "gemini-3.6-flash", "label": "Gemini 3.6 Flash", "note": "", "note_key": None},
    {"id": "gemini-3.5-flash", "label": "Gemini 3.5 Flash", "note": "", "note_key": None},
    {"id": "gemini-3-flash", "label": "Gemini 3 Flash", "note": "", "note_key": None},
    {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite", "note": "fastest", "note_key": "fastest"},
    {"id": "gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash-Lite", "note": "fastest", "note_key": "fastest"},
]
MODEL_IDS = [m["id"] for m in MODELS]
MODEL_KEY = "ai_model"
FALLBACK_KEY = "ai_auto_fallback"
MIN_ATTEMPT = 2.0  # seconds: below this a further attempt is not worth starting
MISSING_TTL = 6 * 3600.0

_missing: dict[str, float] = {}  # model id -> monotonic expiry, for ids Google answered 404 to (per process)


def _clock() -> float:
    return time.monotonic()


def missing_models() -> set[str]:
    now = _clock()
    for model, expires in list(_missing.items()):
        if expires <= now:
            del _missing[model]
    return set(_missing)


def selected_model(session: Session, configured: str) -> str:
    row = session.get(AppSetting, MODEL_KEY)
    if row is not None and row.value in MODEL_IDS:
        return row.value
    return configured if configured in MODEL_IDS else MODEL_IDS[0]


def auto_fallback(session: Session) -> bool:
    row = session.get(AppSetting, FALLBACK_KEY)
    return True if row is None else bool(row.value)


def save_setting(session: Session, key: str, value: object) -> None:
    row = session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=value))
    else:
        row.value = value


class FallbackProvider:
    """Tries the selected model, then the others in allowlist order, when a model is rate limited or missing.

    One instance lives for one request: a model that failed stays skipped for the rest of it. `timeout` is a
    total budget for the whole chain, not per attempt. Missing models are also remembered per process for a while.
    """

    def __init__(self, selected: str, make: Callable[[str], LLMProvider],
                 clock: Callable[[], float] | None = None):
        self._selected = selected
        self._order = [selected] + [m for m in MODEL_IDS if m != selected]
        self._make = make
        self._clock = clock or _clock
        self._limited: set[str] = set()
        self._rate_limited = False
        self._last: Exception | None = None

    def _candidates(self) -> list[str]:
        gone = missing_models()
        fresh = [m for m in self._order if m not in self._limited and m not in gone]
        if fresh or self._selected in self._limited:
            return fresh
        return [self._selected]  # everything left is cached as missing: let the selected one try again

    def _attempts(self, timeout: float | None) -> Iterator[tuple[str, float | None]]:
        """Yields (model, timeout for that attempt); the caller reports a failure through _failed()."""
        deadline = None if timeout is None else self._clock() + timeout
        tried = False
        for model in self._candidates():
            left = None
            if deadline is not None:
                left = deadline - self._clock()
                if tried and left < MIN_ATTEMPT:
                    return
            tried = True
            yield model, left

    def _failed(self, model: str, exc: Exception) -> None:
        self._limited.add(model)
        self._last = exc
        if isinstance(exc, AIRateLimited):
            self._rate_limited = True
        else:
            _missing[model] = _clock() + MISSING_TTL

    def _final(self) -> Exception:
        if self._rate_limited or self._last is None:
            return AIRateLimited("every model is rate limited")
        return self._last

    def _run(self, action: Callable[[LLMProvider, float | None], object], timeout: float | None):
        for model, left in self._attempts(timeout):
            try:
                return action(self._make(model), left)
            except (AIRateLimited, AIModelMissing) as exc:
                self._failed(model, exc)
        raise self._final()

    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl],
                 timeout: float | None = None) -> LLMReply:
        return self._run(lambda p, t: p.generate(system, turns, tools, t), timeout)

    def generate_json(self, system: str, prompt: str, schema: dict, timeout: float | None = None) -> dict | list:
        return self._run(lambda p, t: p.generate_json(system, prompt, schema, t), timeout)

    def stream(self, system: str, turns: list[Turn], tools: list[ToolDecl],
               timeout: float | None = None) -> Iterator[StreamPart]:
        for model, left in self._attempts(timeout):
            started = False
            try:
                for part in self._make(model).stream(system, turns, tools, left):
                    started = True
                    yield part
                return
            except (AIRateLimited, AIModelMissing) as exc:
                if started:
                    raise
                self._failed(model, exc)
        raise self._final()
