import json
import logging
from collections.abc import Iterator

import httpx

from app.ai.provider import (AIRateLimited, AIUnavailable, CallPart, FunctionCall, LLMReply, StreamPart, TextDelta,
                             ToolDecl, Turn)

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
# a stream ending with any other finishReason (SAFETY, MALFORMED_FUNCTION_CALL, ...) is a failure
_OK_FINISH = ("STOP", None, "MAX_TOKENS")


def _sse_payloads(lines: Iterator[str]) -> Iterator[str]:
    """Join the consecutive `data:` lines of each SSE event with "\n" (per the SSE spec); a blank line ends an event."""
    data: list[str] = []
    for line in lines:
        if line == "":
            if data:
                yield "\n".join(data)
                data = []
        elif line.startswith("data:"):
            data.append(line[5:].removeprefix(" "))
    if data:
        yield "\n".join(data)


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

    def _chat_body(self, system: str, turns: list[Turn], tools: list[ToolDecl]) -> dict:
        body: dict = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [_content(t) for t in turns],
        }
        if self._config():
            body["generationConfig"] = self._config()
        if tools:
            body["tools"] = [{"functionDeclarations": [
                {"name": t.name, "description": t.description, "parameters": t.parameters} for t in tools]}]
        return body

    @staticmethod
    def _call(part: dict) -> FunctionCall | None:
        fc = part.get("functionCall") if isinstance(part, dict) else None
        if not isinstance(fc, dict) or "name" not in fc:
            return None
        sig = part.get("thoughtSignature")
        return FunctionCall(fc["name"], fc.get("args") or {}, thought_signature=sig if isinstance(sig, str) else None)

    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl],
                 timeout: float | None = None) -> LLMReply:
        parts = self._parts(self._post(self._chat_body(system, turns, tools), timeout))
        texts = [p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]
        calls = [c for c in (self._call(p) for p in parts) if c is not None]
        return LLMReply("".join(texts) if texts else None, calls)

    @staticmethod
    def _stream_error(error) -> Exception:
        """An in-band {"error": {...}} chunk: log its status and message (never the key), map like an HTTP error."""
        error = error if isinstance(error, dict) else {}
        status, message = str(error.get("status", "")), str(error.get("message", ""))[:300]
        logger.warning("Gemini stream error: %s %s %s", error.get("code", ""), status, message)
        if status == "RESOURCE_EXHAUSTED" or error.get("code") == 429:
            return AIRateLimited(RATE_MSG)
        return AIUnavailable(UNAVAILABLE_MSG)

    def stream(self, system: str, turns: list[Turn], tools: list[ToolDecl],
               timeout: float | None = None) -> Iterator[StreamPart]:
        """Yield text deltas and function calls as Gemini produces them. Errors map like generate(), raised before
        or during iteration, without cause/context so nothing can leak the key."""
        body = self._chat_body(system, turns, tools)
        failure: Exception | None = None
        try:
            with self._http.stream(
                "POST", f"{BASE}/{self._model}:streamGenerateContent?alt=sse",
                headers={"x-goog-api-key": self._key}, json=body,
                **({"timeout": timeout} if timeout is not None else {}),
            ) as resp:
                if resp.status_code == 429:
                    failure = AIRateLimited(RATE_MSG)
                elif resp.status_code >= 400:
                    resp.read()
                    _log_google_error(resp)
                    failure = AIUnavailable(UNAVAILABLE_MSG)
                else:
                    finish = None
                    for payload in _sse_payloads(resp.iter_lines()):
                        payload = payload.strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            data = json.loads(payload)
                            if "error" in data:
                                failure = self._stream_error(data["error"])
                                break
                            block = (data.get("promptFeedback") or {}).get("blockReason")
                            candidates = data.get("candidates")
                            if block or not candidates:
                                logger.warning("Gemini stream blocked: blockReason=%s", block)
                                failure = AIUnavailable(UNAVAILABLE_MSG)
                                break
                            finish = candidates[0].get("finishReason") or finish
                            content = candidates[0].get("content")
                            parts = content.get("parts") if isinstance(content, dict) else None
                            if parts is None:
                                continue  # e.g. a final chunk carrying only finishReason/usage
                            if not isinstance(parts, list):
                                raise TypeError
                        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                            failure = AIUnavailable(UNAVAILABLE_MSG)
                            break
                        for p in parts:
                            if not isinstance(p, dict):
                                continue
                            if isinstance(p.get("text"), str) and p["text"]:
                                yield TextDelta(p["text"])
                            call = self._call(p)
                            if call is not None:
                                yield CallPart(call)
                    if failure is None and finish not in _OK_FINISH:
                        logger.warning("Gemini stream ended with finishReason=%s", finish)
                        failure = AIUnavailable(UNAVAILABLE_MSG)
        except httpx.HTTPError:
            failure = AIUnavailable(UNAVAILABLE_MSG)
        if failure is not None:
            raise failure from None

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
