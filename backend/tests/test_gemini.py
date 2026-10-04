import json

import httpx
import pytest

from app.ai.gemini import GeminiProvider
from app.ai.provider import AIError, AIRateLimited, AIUnavailable, FunctionCall, ToolDecl, Turn

KEY = "sekret-key-123"


def make(handler, model="gemini-2.5-flash"):
    seen = []

    def wrapped(request: httpx.Request):
        seen.append(request)
        return handler(request)

    return GeminiProvider(KEY, model, http=httpx.Client(transport=httpx.MockTransport(wrapped))), seen


def ok(parts):
    return lambda r: httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": parts}}]})


def test_request_url_header_and_body_shapes():
    p, seen = make(ok([{"text": "hi"}]), model="m-1")
    tools = [ToolDecl("get_events", "List events", {"type": "object", "properties": {}})]
    turns = [
        Turn("user", text="hello"),
        Turn("model", calls=[FunctionCall("get_events", {"a": 1})]),
        Turn("tool", tool_name="get_events", tool_result={"events": []}),
        Turn("model", text="done"),
    ]
    p.generate("SYS", turns, tools)
    req = seen[0]
    assert str(req.url) == "https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent"
    assert req.headers["x-goog-api-key"] == KEY
    assert KEY not in str(req.url)
    body = json.loads(req.content)
    assert body["systemInstruction"] == {"parts": [{"text": "SYS"}]}
    assert body["contents"] == [
        {"role": "user", "parts": [{"text": "hello"}]},
        {"role": "model", "parts": [{"functionCall": {"name": "get_events", "args": {"a": 1}}}]},
        {"role": "user", "parts": [{"functionResponse": {"name": "get_events", "response": {"content": {"events": []}}}}]},
        {"role": "model", "parts": [{"text": "done"}]},
    ]
    assert body["tools"] == [{"functionDeclarations": [
        {"name": "get_events", "description": "List events", "parameters": {"type": "object", "properties": {}}}]}]


def test_no_tools_omits_tools_key():
    p, seen = make(ok([{"text": "hi"}]))
    p.generate("S", [Turn("user", text="x")], [])
    assert "tools" not in json.loads(seen[0].content)


def test_text_reply_joined():
    p, _ = make(ok([{"text": "a"}, {"text": "b"}]))
    r = p.generate("S", [Turn("user", text="x")], [])
    assert r.text == "ab" and r.calls == []


def test_function_call_reply():
    p, _ = make(ok([{"functionCall": {"name": "f", "args": {"x": 2}}}]))
    r = p.generate("S", [Turn("user", text="x")], [])
    assert r.text is None
    assert r.calls == [FunctionCall("f", {"x": 2})]


def test_generate_json_parses_text():
    p, seen = make(ok([{"text": '[{"title": "T"}]'}]))
    out = p.generate_json("S", "prompt", {"type": "array"})
    assert out == [{"title": "T"}]
    body = json.loads(seen[0].content)
    assert body["generationConfig"] == {"responseMimeType": "application/json", "responseSchema": {"type": "array"},
                                         "thinkingConfig": {"thinkingBudget": 0}}
    assert body["contents"] == [{"role": "user", "parts": [{"text": "prompt"}]}]


def test_generate_json_bad_json_is_unavailable():
    p, _ = make(ok([{"text": "not json"}]))
    with pytest.raises(AIUnavailable):
        p.generate_json("S", "p", {})


def test_rate_limit_maps_to_AIRateLimited():
    p, _ = make(lambda r: httpx.Response(429, json={"error": {"message": f"quota {KEY}"}}))
    with pytest.raises(AIRateLimited) as e:
        p.generate("S", [Turn("user", text="x")], [])
    assert str(e.value) == "AI limit reached, try again later"
    assert isinstance(e.value, AIError)


@pytest.mark.parametrize("status", [400, 403, 500, 503])
def test_http_errors_are_unavailable(status):
    p, _ = make(lambda r: httpx.Response(status, text=f"boom {KEY}"))
    with pytest.raises(AIUnavailable) as e:
        p.generate("S", [Turn("user", text="x")], [])
    assert str(e.value) == "The assistant is not available right now"
    assert KEY not in str(e.value)


def test_timeout_is_unavailable_without_key():
    def boom(request):
        raise httpx.ReadTimeout(f"timed out {request.url} {KEY}", request=request)

    p, _ = make(boom)
    with pytest.raises(AIUnavailable) as e:
        p.generate("S", [Turn("user", text="x")], [])
    assert KEY not in str(e.value) and KEY not in repr(e.value)
    assert e.value.__cause__ is None


def test_empty_candidates_is_unavailable():
    p, _ = make(lambda r: httpx.Response(200, json={"candidates": []}))
    with pytest.raises(AIUnavailable):
        p.generate("S", [Turn("user", text="x")], [])


def test_default_client_has_30s_timeout():
    assert GeminiProvider(KEY, "m")._http.timeout.read == 30


def test_parallel_tool_results_are_one_user_content():
    p, seen = make(ok([{"text": "ok"}]))
    turns = [
        Turn("user", text="q"),
        Turn("model", calls=[FunctionCall("a", {}), FunctionCall("b", {})]),
        Turn("tool", results=[("a", {"x": 1}), ("b", {"y": 2})]),
    ]
    p.generate("S", turns, [])
    contents = json.loads(seen[0].content)["contents"]
    assert len(contents) == 3
    assert contents[2] == {"role": "user", "parts": [
        {"functionResponse": {"name": "a", "response": {"content": {"x": 1}}}},
        {"functionResponse": {"name": "b", "response": {"content": {"y": 2}}}}]}


def test_thinking_disabled_for_25_flash_only():
    p, seen = make(ok([{"text": '[]'}]), model="gemini-2.5-flash-lite")
    p.generate("S", [Turn("user", text="x")], [])
    p.generate_json("S", "p", {})
    for req in seen:
        assert json.loads(req.content)["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}
    p2, seen2 = make(ok([{"text": "hi"}]), model="gemini-3-pro")
    p2.generate("S", [Turn("user", text="x")], [])
    assert "thinkingConfig" not in json.loads(seen2[0].content).get("generationConfig", {})


def test_empty_stop_candidate_is_empty_reply_but_safety_is_unavailable():
    p, _ = make(lambda r: httpx.Response(200, json={"candidates": [{"finishReason": "STOP"}]}))
    assert p.generate("S", [Turn("user", text="x")], []).text is None
    p, _ = make(lambda r: httpx.Response(200, json={"candidates": [{"finishReason": "SAFETY"}]}))
    with pytest.raises(AIUnavailable):
        p.generate("S", [Turn("user", text="x")], [])


def test_google_error_is_logged_without_the_key(caplog):
    import httpx as _httpx

    from app.ai.gemini import GeminiProvider
    from app.ai.provider import AIUnavailable

    def handler(request):
        return _httpx.Response(400, json={"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": "API key not valid."}})

    provider = GeminiProvider("secret-key-123", "gemini-2.5-flash", http=_httpx.Client(transport=_httpx.MockTransport(handler)))
    with caplog.at_level("WARNING"):
        try:
            provider.generate("sys", [], [])
        except AIUnavailable:
            pass
    assert "INVALID_ARGUMENT" in caplog.text and "API key not valid." in caplog.text
    assert "secret-key-123" not in caplog.text
