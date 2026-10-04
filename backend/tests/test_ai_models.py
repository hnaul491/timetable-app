import pytest

from app.ai.models import MODEL_IDS, FallbackProvider
from app.ai.provider import AIModelMissing, AIRateLimited, AIUnavailable, LLMReply, TextDelta
from app.config import Settings
from app.deps import get_llm
from tests.ai_fakes import FakeProvider
from tests.conftest import AUTH

A, B = MODEL_IDS[0], MODEL_IDS[1]
C = MODEL_IDS[-1]


def test_allowlist_order():
    assert MODEL_IDS == ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash",
                         "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"]


# ---- API ---------------------------------------------------------------------------------------------

def test_status_defaults(client):
    body = client.get("/api/ai/status", headers=AUTH).json()
    assert body["model"] == A and body["auto_fallback"] is True
    assert [m["id"] for m in body["models"]] == MODEL_IDS
    assert body["models"][0] == {"id": A, "label": "Gemini 3.8 Flash", "note": "best quality"}


def test_put_settings_persists(client):
    r = client.put("/api/ai/settings", headers=AUTH, json={"model": C})
    assert r.status_code == 200 and r.json()["model"] == C and r.json()["auto_fallback"] is True
    r = client.put("/api/ai/settings", headers=AUTH, json={"auto_fallback": False})
    assert r.json()["model"] == C and r.json()["auto_fallback"] is False
    body = client.get("/api/ai/status", headers=AUTH).json()
    assert body["model"] == C and body["auto_fallback"] is False


def test_put_settings_rejects_unknown_model(client):
    assert client.put("/api/ai/settings", headers=AUTH, json={"model": "gpt-5"}).status_code == 422
    assert client.get("/api/ai/status", headers=AUTH).json()["model"] == A


def test_put_settings_requires_login(client):
    assert client.put("/api/ai/settings", json={"model": A}).status_code == 401


def test_get_llm_uses_selected_model_and_flag(session):
    settings = Settings(gemini_api_key="k")
    from app.ai.models import save_setting
    save_setting(session, "ai_model", B)
    session.commit()
    gen = get_llm(settings, session)
    assert isinstance(next(gen), FallbackProvider)
    gen.close()
    save_setting(session, "ai_auto_fallback", False)
    session.commit()
    gen = get_llm(settings, session)
    llm = next(gen)
    assert llm._model == B
    gen.close()


# ---- fallback wrapper ------------------------------------------------------------------------------------

def make_fb(plans, selected=A):
    providers = {m: FakeProvider(**plans.get(m, {})) for m in MODEL_IDS}
    made: list[str] = []

    def make(model):
        made.append(model)
        return providers[model]

    return FallbackProvider(selected, make), providers, made


def ok(text):
    return LLMReply(text=text, calls=[])


def test_generate_falls_back_on_429():
    fb, p, _ = make_fb({A: {"script": [AIRateLimited("x")]}, B: {"script": [ok("b")]}})
    assert fb.generate("s", [], [], 5.0).text == "b"
    assert p[B].calls[0]["timeout"] == 5.0


def test_selected_model_goes_first_and_others_in_order():
    fb, p, made = make_fb({B: {"script": [AIRateLimited("x")]}, A: {"script": [AIRateLimited("x")]},
                           MODEL_IDS[2]: {"script": [ok("c")]}}, selected=B)
    assert fb.generate("s", [], []).text == "c"
    assert made == [B, A, MODEL_IDS[2]]


def test_unavailable_does_not_fall_back():
    fb, p, _ = make_fb({A: {"script": [AIUnavailable("x")]}, B: {"script": [ok("b")]}})
    with pytest.raises(AIUnavailable):
        fb.generate("s", [], [])
    assert p[B].calls == []


def test_all_rate_limited_raises():
    fb, _, _ = make_fb({m: {"script": [AIRateLimited(m)]} for m in MODEL_IDS})
    with pytest.raises(AIRateLimited):
        fb.generate("s", [], [])
    with pytest.raises(AIRateLimited):  # every model stays skipped
        fb.generate("s", [], [])


def test_generate_json_falls_back():
    fb, _, _ = make_fb({A: {"json_result": AIRateLimited("x")}, B: {"json_result": {"ok": 1}}})
    assert fb.generate_json("s", "p", {}) == {"ok": 1}


def test_sticky_skip_within_request():
    fb, p, _ = make_fb({A: {"script": [AIRateLimited("x")]}, B: {"script": [ok("1"), ok("2")]}})
    fb.generate("s", [], [])
    assert fb.generate("s", [], []).text == "2"
    assert len(p[A].calls) == 1


def test_stream_falls_back_before_first_part():
    fb, p, _ = make_fb({A: {"stream_script": [[AIRateLimited("x")]]}, B: {"stream_script": [[TextDelta("hi")]]}})
    assert list(fb.stream("s", [], [])) == [TextDelta("hi")]


def test_stream_reraises_after_first_part():
    fb, p, _ = make_fb({A: {"stream_script": [[TextDelta("a"), AIRateLimited("x")]]},
                        B: {"stream_script": [[TextDelta("b")]]}})
    got = []
    with pytest.raises(AIRateLimited):
        for part in fb.stream("s", [], []):
            got.append(part)
    assert got == [TextDelta("a")] and p[B].calls == []


def test_stream_all_limited_and_sticky():
    fb, p, _ = make_fb({m: {"stream_script": [[AIRateLimited(m)]]} for m in MODEL_IDS})
    with pytest.raises(AIRateLimited):
        list(fb.stream("s", [], []))
    with pytest.raises(AIRateLimited):
        list(fb.stream("s", [], []))
    assert all(len(x.calls) == 1 for x in p.values())


def test_missing_model_falls_back_and_is_skipped():
    fb, p, _ = make_fb({A: {"script": [AIModelMissing("x")]}, B: {"script": [ok("1"), ok("2")]}})
    assert fb.generate("s", [], []).text == "1"
    assert fb.generate("s", [], []).text == "2"
    assert len(p[A].calls) == 1


def test_stream_missing_model_falls_back():
    fb, _, _ = make_fb({A: {"stream_script": [[AIModelMissing("x")]]}, B: {"stream_script": [[TextDelta("hi")]]}})
    assert list(fb.stream("s", [], [])) == [TextDelta("hi")]


def test_all_missing_raises_last():
    fb, _, _ = make_fb({m: {"script": [AIModelMissing(m)]} for m in MODEL_IDS})
    with pytest.raises(AIModelMissing, match=MODEL_IDS[-1]):
        fb.generate("s", [], [])
