from collections.abc import Callable, Iterator

from sqlalchemy.orm import Session

from app.ai.provider import AIModelMissing, AIRateLimited, LLMProvider, LLMReply, StreamPart, ToolDecl, Turn
from app.models import AppSetting

# Fallback order. Only these ids are ever sent to Google.
MODELS: list[dict[str, str]] = [
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "note": "best quality"},
    {"id": "gemini-3.7-flash", "label": "Gemini 3.7 Flash", "note": ""},
    {"id": "gemini-3.6-flash", "label": "Gemini 3.6 Flash", "note": ""},
    {"id": "gemini-3.5-flash", "label": "Gemini 3.5 Flash", "note": ""},
    {"id": "gemini-3-flash", "label": "Gemini 3 Flash", "note": ""},
    {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite", "note": "fastest"},
    {"id": "gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash-Lite", "note": "fastest"},
]
MODEL_IDS = [m["id"] for m in MODELS]
MODEL_KEY = "ai_model"
FALLBACK_KEY = "ai_auto_fallback"


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
    """Tries the selected model, then the others in allowlist order, when a model is rate limited.

    One instance lives for one request: a model that was rate limited stays skipped for the rest of it.
    """

    def __init__(self, selected: str, make: Callable[[str], LLMProvider]):
        self._order = [selected] + [m for m in MODEL_IDS if m != selected]
        self._make = make
        self._limited: set[str] = set()

    def _run(self, action: Callable[[LLMProvider], object]):
        last: Exception | None = None
        for model in self._order:
            if model in self._limited:
                continue
            try:
                return action(self._make(model))
            except (AIRateLimited, AIModelMissing) as exc:
                self._limited.add(model)
                last = exc
        raise last or AIRateLimited("every model is rate limited")

    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl],
                 timeout: float | None = None) -> LLMReply:
        return self._run(lambda p: p.generate(system, turns, tools, timeout))

    def generate_json(self, system: str, prompt: str, schema: dict, timeout: float | None = None) -> dict | list:
        return self._run(lambda p: p.generate_json(system, prompt, schema, timeout))

    def stream(self, system: str, turns: list[Turn], tools: list[ToolDecl],
               timeout: float | None = None) -> Iterator[StreamPart]:
        last: Exception | None = None
        for model in self._order:
            if model in self._limited:
                continue
            started = False
            try:
                for part in self._make(model).stream(system, turns, tools, timeout):
                    started = True
                    yield part
                return
            except (AIRateLimited, AIModelMissing) as exc:
                if started:
                    raise
                self._limited.add(model)
                last = exc
        raise last or AIRateLimited("every model is rate limited")
