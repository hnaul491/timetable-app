import json

import httpx

from app.ai.provider import AIRateLimited, AIUnavailable, FunctionCall, LLMReply, ToolDecl, Turn

BASE = "https://generativelanguage.googleapis.com/v1beta/models"
RATE_MSG = "AI limit reached, try again later"
UNAVAILABLE_MSG = "The assistant is not available right now"


def _content(turn: Turn) -> dict:
    if turn.role == "tool":
        return {"role": "user", "parts": [{"functionResponse": {
            "name": turn.tool_name, "response": {"content": turn.tool_result}}}]}
    parts: list[dict] = []
    if turn.text:
        parts.append({"text": turn.text})
    for c in turn.calls:
        parts.append({"functionCall": {"name": c.name, "args": c.args}})
    return {"role": turn.role, "parts": parts}


class GeminiProvider:
    def __init__(self, api_key: str, model: str, http: httpx.Client | None = None):
        self._key = api_key
        self._model = model
        self._http = http or httpx.Client(timeout=30)

    def _post(self, body: dict) -> dict:
        # Errors are re-raised without cause/context so no URL, header or response text leaks the key.
        failure: Exception | None = None
        try:
            resp = self._http.post(
                f"{BASE}/{self._model}:generateContent",
                headers={"x-goog-api-key": self._key},
                json=body,
            )
        except httpx.HTTPError:
            failure = AIUnavailable(UNAVAILABLE_MSG)
        else:
            if resp.status_code == 429:
                failure = AIRateLimited(RATE_MSG)
            elif resp.status_code >= 400:
                failure = AIUnavailable(UNAVAILABLE_MSG)
            else:
                try:
                    data = resp.json()
                    parts = data["candidates"][0]["content"]["parts"]
                    if not isinstance(parts, list):
                        raise TypeError
                    return data
                except (ValueError, KeyError, IndexError, TypeError):
                    failure = AIUnavailable(UNAVAILABLE_MSG)
        raise failure from None

    @staticmethod
    def _parts(data: dict) -> list[dict]:
        return data["candidates"][0]["content"]["parts"]

    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl]) -> LLMReply:
        body: dict = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [_content(t) for t in turns],
        }
        if tools:
            body["tools"] = [{"functionDeclarations": [
                {"name": t.name, "description": t.description, "parameters": t.parameters} for t in tools]}]
        parts = self._parts(self._post(body))
        texts = [p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]
        calls = [
            FunctionCall(p["functionCall"]["name"], p["functionCall"].get("args") or {})
            for p in parts
            if isinstance(p, dict) and isinstance(p.get("functionCall"), dict) and "name" in p["functionCall"]
        ]
        return LLMReply("".join(texts) if texts else None, calls)

    def generate_json(self, system: str, prompt: str, schema: dict) -> dict | list:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema},
        }
        parts = self._parts(self._post(body))
        try:
            return json.loads(parts[0]["text"])
        except (ValueError, KeyError, IndexError, TypeError):
            raise AIUnavailable(UNAVAILABLE_MSG) from None
