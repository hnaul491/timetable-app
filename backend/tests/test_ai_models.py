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
    assert body["models"][0] == {"id": A, "label": "Gemini 3.8 Flash", "note": "best quality", "note_key": "best",
                                 "available": True}
    assert [m["note_key"] for m in body["models"]] == ["best", None, None, None, None, "fastest", "fastest"]


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


def test_put_settings_empty_or_null_model_changes_nothing(client):
    client.put("/api/ai/settings", headers=AUTH, json={"model": C, "auto_fallback": False})
    for payload in ({}, {"model": None}):
        r = client.put("/api/ai/settings", headers=AUTH, json=payload)
        assert r.status_code == 200 and r.json()["model"] == C and r.json()["auto_fallback"] is False


def test_put_settings_rejects_non_bool_fallback(client):
    assert client.put("/api/ai/settings", headers=AUTH, json={"auto_fallback": "no"}).status_code == 422
    assert client.put("/api/ai/settings", headers=AUTH, json={"auto_fallback": 0}).status_code == 422
    assert client.get("/api/ai/status", headers=AUTH).json()["auto_fallback"] is True


def test_status_marks_missing_models_unavailable(client):
    from app.ai import models
    models._missing[B] = models._clock() + 100
    body = client.get("/api/ai/status", headers=AUTH).json()
    assert {m["id"]: m["available"] for m in body["models"]} == {m: m != B for m in MODEL_IDS}


def test_put_settings_requires_login(client):
    assert client.put("/api/ai/settings", json={"model": A}).status_code == 401


def test_get_llm_uses_selected_model_and_flag(session, monkeypatch):
    import app.deps
    built: list[str] = []

    class Recorder(FakeProvider):
        def __init__(self, api_key, model, http=None):
            super().__init__()
            built.append(model)

    monkeypatch.setattr(app.deps, "GeminiProvider", Recorder)
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
    assert isinstance(llm, Recorder) and built == [B]
    gen.close()


# ---- fallback wrapper ------------------------------------------------------------------------------------

def make_fb(plans, selected=A):
    providers = {m: FakeProvider(**plans.get(m, {})) for m in MODEL_IDS}
    made: list[str] = []

    def make(model):
        made.append(model)
        return providers[model]

    # a frozen clock: with the real one each attempt's timeout is a few microseconds short of the budget on Linux CI
    return FallbackProvider(selected, make, clock=lambda: 1000.0), providers, made


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


# ---- total budget, error choice, remembered missing models --------------------------------------------------

class FakeClock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def burning(clock, seen, cost, exc=AIRateLimited("x")):
    """Providers whose every call records its timeout, burns `cost` fake seconds and raises exc."""
    providers = {m: FakeProvider() for m in MODEL_IDS}

    def generate(system, turns, tools, timeout=None):
        seen.append(timeout)
        clock.t += cost
        raise exc

    def stream(system, turns, tools, timeout=None):
        seen.append(timeout)
        clock.t += cost
        raise exc
        yield

    def generate_json(system, prompt, schema, timeout=None):
        seen.append(timeout)
        clock.t += cost
        raise exc

    for p in providers.values():
        p.generate, p.stream, p.generate_json = generate, stream, generate_json
    return FallbackProvider(A, lambda m: providers[m], clock=clock)


def test_total_budget_shrinks_per_attempt():
    clock, seen = FakeClock(), []
    fb = burning(clock, seen, 10)
    with pytest.raises(AIRateLimited):
        fb.generate("s", [], [], 35.0)
    assert seen == [35.0, 25.0, 15.0, 5.0]
    assert len(seen) < len(MODEL_IDS)  # the chain stopped on the budget, not on running out of models


def test_chain_stops_below_two_seconds_left():
    clock, seen = FakeClock(), []
    fb = burning(clock, seen, 9.5)
    with pytest.raises(AIRateLimited):
        fb.generate("s", [], [], 20.0)
    assert seen == [20.0, 10.5]  # 1 s left after the second attempt: stop


def test_first_attempt_is_made_even_with_a_tiny_budget():
    clock, seen = FakeClock(), []
    with pytest.raises(AIRateLimited):
        burning(clock, seen, 0.5).generate("s", [], [], 1.0)
    assert seen[0] == 1.0


def test_budget_applies_to_stream_and_json():
    clock, seen = FakeClock(), []
    with pytest.raises(AIRateLimited):
        list(burning(clock, seen, 10).stream("s", [], [], 25.0))
    assert seen == [25.0, 15.0, 5.0]
    seen.clear()
    with pytest.raises(AIRateLimited):
        burning(clock, seen, 10).generate_json("s", "p", {}, 25.0)
    assert seen == [25.0, 15.0, 5.0]


def test_budget_exhausted_with_only_missing_models_raises_that_error():
    clock, seen = FakeClock(), []
    with pytest.raises(AIModelMissing):
        burning(clock, seen, 9, AIModelMissing("gone")).generate("s", [], [], 15.0)


def test_no_timeout_means_no_budget():
    fb, p, _ = make_fb({m: {"script": [AIRateLimited(m)]} for m in MODEL_IDS})
    with pytest.raises(AIRateLimited):
        fb.generate("s", [], [])
    assert all(len(x.calls) == 1 for x in p.values())


def test_rate_limit_error_wins_over_later_missing():
    plans = {m: {"script": [AIModelMissing(m)]} for m in MODEL_IDS[1:]}
    fb, _, _ = make_fb({A: {"script": [AIRateLimited("x")]}, **plans})
    with pytest.raises(AIRateLimited):
        fb.generate("s", [], [])


def test_missing_remembered_across_requests_and_expires(monkeypatch):
    from app.ai import models
    clock = FakeClock()
    monkeypatch.setattr(models, "_clock", clock)
    fb, p, made = make_fb({A: {"script": [AIModelMissing("x")]}, B: {"script": [ok("1")]}})
    assert fb.generate("s", [], []).text == "1"
    fb2, p2, made2 = make_fb({B: {"script": [ok("2")]}})
    assert fb2.generate("s", [], []).text == "2"
    assert made2 == [B]  # A skipped: remembered as missing
    clock.t += models.MISSING_TTL + 1
    fb3, p3, made3 = make_fb({A: {"script": [ok("3")]}})
    assert fb3.generate("s", [], []).text == "3"
    assert made3 == [A]


def test_rate_limited_is_not_remembered_across_requests():
    fb, _, _ = make_fb({A: {"script": [AIRateLimited("x")]}, B: {"script": [ok("1")]}})
    fb.generate("s", [], [])
    fb2, p2, made2 = make_fb({A: {"script": [ok("again")]}})
    assert fb2.generate("s", [], []).text == "again" and made2 == [A]


def test_all_cached_missing_still_tries_selected_once():
    from app.ai import models
    for m in MODEL_IDS:
        models._missing[m] = models._clock() + 1000
    fb, p, made = make_fb({B: {"script": [ok("recovered")]}}, selected=B)
    assert fb.generate("s", [], []).text == "recovered"
    assert made == [B]
    assert B in models._missing  # still remembered until its TTL runs out
