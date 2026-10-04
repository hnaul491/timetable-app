import json
import logging

import httpx

from app.ai.provider import AIRateLimited, AIUnavailable, FunctionCall, LLMReply, ToolDecl, Turn

logger = logging.getLogger(__name__)


def _log_google_error(resp: httpx.Response) -> None:
    """Log Gemini's error status and message (never the key or the request) so failures can be diagnosed."""
    try:
        error = resp.json().get("error", {})
        status, message = error.get("status", ""), str(error.get("message", ""))[:300]
    except (ValueError, AttributeError):
        status, message = "", ""
    logger.warning("Gemini request failed: HTTP %s %s %s", resp.status_code, status, message)

BASE = "https://generativelanguage.googleapis.com/v1beta/models"
RATE_MSG = "AI limit reached, try again later"
UNAVAILABLE_MSG = "The assistant is not available right now"
# an empty candidate that finished normally is an empty answer, not an outage
_EMPTY_FINISH = ("STOP", None)


def _content(turn: Turn) -> dict:
    if turn.role == "tool":
        return {"role": "user", "parts": [{"functionResponse": {"name": name, "response": {"content": result}}}
                                          for name, result in turn.results]}
    parts: list[dict] = []
    if turn.text:
        parts.append({"text": turn.text})
    for c in turn.calls:
        part: dict = {"functionCall": {"name": c.name, "args": c.args}}
        if c.thought_signature:
            part["thoughtSignature"] = c.thought_signature
        parts.append(part)
    return {"role": turn.role, "parts": parts}


class GeminiProvider:
    def __init__(self, api_key: str, model: str, http: httpx.Client | None = None):
        self._key = api_key
        self._model = model
        self._http = http or httpx.Client(timeout=30)

    def _post(self, body: dict, timeout: float | None = None) -> dict:
        # Errors are re-raised without cause/context so no URL, header or response text leaks the key.
        failure: Exception | None = None
        try:
            resp = self._http.post(
                f"{BASE}/{self._model}:generateContent",
                headers={"x-goog-api-key": self._key},
                json=body,
                **({"timeout": timeout} if timeout is not None else {}),
            )
        except httpx.HTTPError:
            failure = AIUnavailable(UNAVAILABLE_MSG)
        else:
            if resp.status_code == 429:
                failure = AIRateLimited(RATE_MSG)
            elif resp.status_code >= 400:
                _log_google_error(resp)
                failure = AIUnavailable(UNAVAILABLE_MSG)
            else:
                try:
                    data = resp.json()
                    candidate = data["candidates"][0]
                    content = candidate.get("content")
                    parts = content.get("parts") if isinstance(content, dict) else None
                    if parts is None and candidate.get("finishReason") in _EMPTY_FINISH:
                        candidate["content"] = {"parts": []}
                        return data
                    if not isinstance(parts, list):
                        raise TypeError
                    return data
                except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                    failure = AIUnavailable(UNAVAILABLE_MSG)
        raise failure from None

    @staticmethod
    def _parts(data: dict) -> list[dict]:
        return data["candidates"][0]["content"]["parts"]

    def _config(self) -> dict:
        if self._model.startswith("gemini-2.5-flash"):
            return {"thinkingConfig": {"thinkingBudget": 0}}
        return {}

    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl],
                 timeout: float | None = None) -> LLMReply:
        body: dict = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [_content(t) for t in turns],
        }
        if self._config():
            body["generationConfig"] = self._config()
        if tools:
            body["tools"] = [{"functionDeclarations": [
                {"name": t.name, "description": t.description, "parameters": t.parameters} for t in tools]}]
        parts = self._parts(self._post(body, timeout))
        texts = [p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]
        calls = [
            FunctionCall(p["functionCall"]["name"], p["functionCall"].get("args") or {},
                         thought_signature=p.get("thoughtSignature") if isinstance(p.get("thoughtSignature"), str) else None)
            for p in parts
            if isinstance(p, dict) and isinstance(p.get("functionCall"), dict) and "name" in p["functionCall"]
        ]
        return LLMReply("".join(texts) if texts else None, calls)

    def generate_json(self, system: str, prompt: str, schema: dict, timeout: float | None = None) -> dict | list:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema,
                                 **self._config()},
        }
        parts = self._parts(self._post(body, timeout))
        try:
            return json.loads(parts[0]["text"])
        except (ValueError, KeyError, IndexError, TypeError):
            raise AIUnavailable(UNAVAILABLE_MSG) from None
