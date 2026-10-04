import json

from sqlalchemy import func, select

from app.ai.assistant import LIMIT_REPLY, stream_chat
from app.ai.provider import AIRateLimited, AIUnavailable, CallPart, FunctionCall, TextDelta
from app.deps import get_llm
from app.models import ChatMessage, PendingAction
from app.schemas import ChatContext
from tests.ai_fakes import FakeProvider
from tests.conftest import AUTH, NOW
from tests.test_api_ai import seed


def call(name, **args):
    return CallPart(FunctionCall(name=name, args=args, thought_signature="sig"))


def run(session, llm, text="hi", **kw):
    return list(stream_chat(session, llm, text, ChatContext(), "en", NOW, **kw))


def names(events):
    return [e["event"] for e in events]


def n_messages(session):
    return session.scalar(select(func.count()).select_from(ChatMessage))


def test_text_only_order_and_persistence(session, semester):
    llm = FakeProvider(stream_script=[[TextDelta("Hel"), TextDelta("lo")]])
    ev = run(session, llm)
    assert names(ev) == ["delta", "delta", "done"]
    assert [e["data"]["text"] for e in ev[:2]] == ["Hel", "lo"]
    msg = ev[-1]["data"]["message"]
    assert msg["role"] == "assistant" and msg["content"] == "Hello" and msg["actions"] == []
    rows = session.scalars(select(ChatMessage).order_by(ChatMessage.id)).all()
    assert [(r.role, r.content) for r in rows] == [("user", "hi"), ("assistant", "Hello")]
    assert msg["id"] == rows[-1].id


def test_tool_round_then_text(session, semester):
    seed(session, semester)
    llm = FakeProvider(stream_script=[
        [TextDelta("Let me look. "), call("get_tasks"), call("get_events", from_date="2026-10-19", to_date="2026-10-19")],
        [TextDelta("You have "), TextDelta("2 tasks.")],
    ])
    ev = run(session, llm)
    assert names(ev) == ["delta", "status", "status", "delta", "delta", "done"]
    assert [e["data"]["step"] for e in ev if e["event"] == "status"] == ["tasks", "events"]
    assert ev[-1]["data"]["message"]["content"] == "You have 2 tasks."
    second = llm.calls[1]["turns"]
    assert second[-2].role == "model" and second[-2].calls[0].thought_signature == "sig"
    assert second[-1].role == "tool" and [n for n, _ in second[-1].results] == ["get_tasks", "get_events"]


def test_step_mapping(session, semester):
    from app.ai.assistant import STEPS
    assert STEPS["get_notes"] == "notes" and STEPS["get_subjects"] == "subjects"
    assert STEPS["find_free_slots"] == "free_slots"
    assert all(STEPS[n] == "proposal" for n in ("propose_task", "propose_event", "propose_note",
                                                  "propose_study_blocks"))


def test_proposal_becomes_action_in_done(session, semester):
    llm = FakeProvider(stream_script=[
        [call("propose_task", title="Revise joins", due_date="2026-10-20")],
        [TextDelta("Proposed.")],
    ])
    ev = run(session, llm)
    assert names(ev) == ["status", "delta", "done"] and ev[0]["data"] == {"step": "proposal"}
    actions = ev[-1]["data"]["message"]["actions"]
    assert len(actions) == 1 and actions[0]["status"] == "pending" and actions[0]["kind"] == "task"
    assert session.scalar(select(func.count()).select_from(PendingAction)) == 1


def test_budget_exhausted_limit_reply(session, semester):
    llm = FakeProvider(stream_script=[])
    ev = run(session, llm, budget=5)
    assert names(ev) == ["delta", "done"] and ev[0]["data"]["text"] == LIMIT_REPLY["en"]
    assert ev[-1]["data"]["message"]["content"] == LIMIT_REPLY["en"] and llm.calls == []


def test_too_many_tool_calls_limit_reply(session, semester):
    rounds = [[call("get_subjects")] for _ in range(6)]
    ev = run(session, FakeProvider(stream_script=rounds))
    assert names(ev)[-2:] == ["delta", "done"]
    assert ev[-1]["data"]["message"]["content"] == LIMIT_REPLY["en"]
    assert names(ev).count("status") == 5


def test_empty_answer_uses_fallback(session, semester):
    ev = run(session, FakeProvider(stream_script=[[]]))
    assert names(ev) == ["delta", "done"]
    assert ev[-1]["data"]["message"]["content"] == "I have nothing to add."


def test_ai_error_before_data_persists_nothing(session, semester):
    ev = run(session, FakeProvider(stream_script=[[AIRateLimited("secret detail")]]))
    assert names(ev) == ["error"] and ev[0]["data"]["message"] == "AI limit reached, try again later"
    assert n_messages(session) == 0


def test_ai_error_mid_stream_persists_nothing(session, semester):
    ev = run(session, FakeProvider(stream_script=[[TextDelta("Par"), AIUnavailable("boom")]]))
    assert names(ev) == ["delta", "error"]
    assert ev[-1]["data"]["message"] == "The assistant is not available right now"
    assert n_messages(session) == 0


def test_error_after_tool_round_keeps_pending_action_out_of_history(session, semester):
    llm = FakeProvider(stream_script=[[call("propose_task", title="x")], [AIUnavailable("boom")]])
    ev = run(session, llm)
    assert names(ev) == ["status", "error"] and n_messages(session) == 0


# ---- HTTP ---------------------------------------------------------------------------------------------

def frames(body: str):
    out = []
    for block in body.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.split("\n"))
        out.append((fields["event"], json.loads(fields["data"])))
    return out


def test_http_stream_sse(client, session, semester):
    client.app.dependency_overrides[get_llm] = lambda: FakeProvider(
        stream_script=[[call("get_subjects")], [TextDelta("Hel"), TextDelta("lo")]])
    r = client.post("/api/chat/stream", headers=AUTH, json={"message": "hi", "context": {}})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache" and r.headers["x-accel-buffering"] == "no"
    fr = frames(r.text)
    assert [e for e, _ in fr] == ["status", "delta", "delta", "done"]
    assert fr[-1][1]["message"]["content"] == "Hello"
    assert client.get("/api/chat", headers=AUTH).json()["messages"][-1]["content"] == "Hello"


def test_http_stream_error_event(client, session, semester):
    client.app.dependency_overrides[get_llm] = lambda: FakeProvider(stream_script=[[AIUnavailable("x")]])
    r = client.post("/api/chat/stream", headers=AUTH, json={"message": "hi", "context": {}})
    assert r.status_code == 200 and frames(r.text) == [("error", {"message": "The assistant is not available right now"})]


def test_http_stream_ai_off_is_503_json(client):
    client.app.dependency_overrides[get_llm] = lambda: None
    r = client.post("/api/chat/stream", headers=AUTH, json={"message": "hi", "context": {}})
    assert (r.status_code, r.json()["detail"]) == (503, "AI is not set up on the server")


def test_http_stream_requires_auth(client):
    assert client.post("/api/chat/stream", json={"message": "hi", "context": {}}).status_code in (401, 403)
