from datetime import date, datetime, time

from app.ai.tools import execute_tool
import pytest

from app.models import Event, MySection, Semester, Subject
from app.services.free_time import BusyItem, FreeTimeParams, compute_free_time
from tests.conftest import AUTH, NOW

BASE = "from=06:00&to=08:00&start=2026-10-05&end=2026-10-09"  # Mon 5 .. Fri 9 Oct 2026 (CEST, UTC+2)


@pytest.fixture
def semester(session) -> Semester:
    sem = Semester(code="S1", name="SE S1 2026", zeus_group_id=802, start_date=date(2026, 1, 1),
                   end_date=date(2027, 1, 31), is_active=True)
    session.add(sem)
    session.commit()
    return sem


def add(session, semester, uid, start, end, subject=None, section=None, kind="class", status="normal", source="zeus"):
    session.add(Event(source=source, zeus_uid=uid, semester_id=semester.id,
                      subject_id=subject.id if subject else None, section=section, title_raw=uid,
                      start_at=start, end_at=end, room="", kind=kind, status=status))
    session.commit()


def get(client, query=BASE):
    return client.get(f"/api/free-time?{query}", headers=AUTH)


def day(body, d):
    return next(x for x in body["days"] if x["date"] == d)


def test_requires_login(client):
    assert client.get(f"/api/free-time?{BASE}").status_code == 401
    assert client.get(f"/api/free-time?{BASE}", headers={"Authorization": "Bearer other"}).status_code == 403


def test_empty_period_is_all_free(client, semester):
    body = get(client).json()
    assert body["window"] == {"from": "06:00", "to": "08:00"}
    assert (body["counted_days"], body["free_days"], body["buffer"], body["min_free"]) == (5, 5, 0, None)
    assert [d["status"] for d in body["days"]] == ["free"] * 5
    assert body["days"][0]["free_minutes"] == 120 and body["days"][0]["longest_free"] == 120
    assert len(body["by_weekday"]) == 7 and body["by_weekday"][0] == {"weekday": 0, "free": 1, "total": 1}
    assert body["by_weekday"][5] == {"weekday": 5, "free": 0, "total": 0}


def test_free_partial_busy_and_blocker_shape(client, session, semester):
    subject = Subject(semester_id=semester.id, display_name="Databases", aliases=[])
    session.add(subject)
    session.flush()
    add(session, semester, "p", datetime(2026, 10, 6, 5, 30), datetime(2026, 10, 6, 7, 0), subject)  # 07:30-09:00 local
    add(session, semester, "b", datetime(2026, 10, 7, 3, 0), datetime(2026, 10, 7, 7, 0), subject)  # 05:00-09:00 local
    add(session, semester, "edge", datetime(2026, 10, 8, 6, 0), datetime(2026, 10, 8, 7, 0))  # starts at 08:00: no overlap
    body = get(client).json()
    assert day(body, "2026-10-05")["status"] == "free"
    partial = day(body, "2026-10-06")
    assert (partial["status"], partial["free_minutes"], partial["longest_free"]) == ("partial", 90, 90)
    assert partial["blockers"] == [{"event_id": partial["blockers"][0]["event_id"], "title": "Databases",
                                    "start": "2026-10-06T05:30:00Z", "end": "2026-10-06T07:00:00Z", "kind": "class"}]
    busy = day(body, "2026-10-07")
    assert (busy["status"], busy["free_minutes"], busy["counts"]) == ("busy", 0, False)
    assert day(body, "2026-10-08")["status"] == "free"
    assert (body["free_days"], body["counted_days"]) == (3, 5)


def test_title_falls_back_to_raw(client, session, semester):
    add(session, semester, "Raw title", datetime(2026, 10, 6, 4, 0), datetime(2026, 10, 6, 5, 0))
    assert day(get(client).json(), "2026-10-06")["blockers"][0]["title"] == "Raw title"


def test_buffer_and_manual_value(client, session, semester):
    add(session, semester, "c", datetime(2026, 10, 6, 5, 40), datetime(2026, 10, 6, 8, 0))  # 07:40-10:00 local
    assert day(get(client).json(), "2026-10-06")["free_minutes"] == 100
    assert day(get(client, BASE + "&buffer=15").json(), "2026-10-06")["free_minutes"] == 85
    at30 = day(get(client, BASE + "&buffer=30").json(), "2026-10-06")
    assert (at30["status"], at30["free_minutes"]) == ("partial", 70)
    at25 = get(client, BASE + "&buffer=25").json()
    assert (day(at25, "2026-10-06")["free_minutes"], at25["buffer"]) == (75, 25)
    assert day(get(client, BASE + "&buffer=240").json(), "2026-10-06")["status"] == "busy"


def test_buffer_pulls_in_class_after_window(client, session, semester):
    add(session, semester, "late", datetime(2026, 10, 6, 6, 30), datetime(2026, 10, 6, 7, 30))  # 08:30 local
    assert day(get(client, BASE + "&buffer=30").json(), "2026-10-06")["status"] == "free"
    partial = day(get(client, BASE + "&buffer=31").json(), "2026-10-06")
    assert (partial["status"], partial["free_minutes"]) == ("partial", 119)
    # the blocker keeps its real times, not the buffered ones
    assert partial["blockers"][0]["start"] == "2026-10-06T06:30:00Z"


def test_min_free_counts_partial_days(client, session, semester):
    add(session, semester, "p", datetime(2026, 10, 6, 5, 30), datetime(2026, 10, 6, 7, 0))  # leaves 06:00-07:30
    add(session, semester, "q", datetime(2026, 10, 7, 4, 30), datetime(2026, 10, 7, 5, 30))  # 06:30-07:30: gaps 30 and 30
    assert get(client).json()["free_days"] == 3
    body = get(client, BASE + "&min_free=60").json()
    assert body["min_free"] == 60 and body["free_days"] == 4
    assert day(body, "2026-10-06")["counts"] is True and day(body, "2026-10-06")["status"] == "partial"
    assert day(body, "2026-10-07")["counts"] is False and day(body, "2026-10-07")["longest_free"] == 30
    assert get(client, BASE + "&min_free=30").json()["free_days"] == 5


def test_weekday_filter_and_off_days(client, session, semester):
    add(session, semester, "sat", datetime(2026, 10, 10, 4, 0), datetime(2026, 10, 10, 6, 0))
    body = get(client, "from=06:00&to=08:00&start=2026-10-05&end=2026-10-11&weekdays=5,6,0").json()
    statuses = {d["date"]: d["status"] for d in body["days"]}
    assert statuses["2026-10-06"] == "off" and statuses["2026-10-10"] == "busy" and statuses["2026-10-05"] == "free"
    off = day(body, "2026-10-06")
    assert (off["counts"], off["blockers"], off["free_minutes"]) == (False, [], 0)
    assert (body["counted_days"], body["free_days"]) == (3, 2)
    assert body["by_weekday"][1] == {"weekday": 1, "free": 0, "total": 0}
    assert body["by_weekday"][5] == {"weekday": 5, "free": 0, "total": 1}


def test_default_weekdays_are_mon_to_fri(client):
    body = get(client, "from=06:00&to=08:00&start=2026-10-05&end=2026-10-11").json()
    assert body["counted_days"] == 5
    assert [d["status"] for d in body["days"][5:]] == ["off", "off"]


def test_section_and_hidden_subject_visibility(client, session, semester):
    chosen = Subject(semester_id=semester.id, display_name="French", aliases=[])
    hidden = Subject(semester_id=semester.id, display_name="Hidden", aliases=[], hidden=True)
    session.add_all([chosen, hidden])
    session.flush()
    session.add(MySection(subject_id=chosen.id, section="GR5"))
    add(session, semester, "gr1", datetime(2026, 10, 5, 4, 0), datetime(2026, 10, 5, 5, 0), chosen, "GR1")  # not mine
    add(session, semester, "gr5", datetime(2026, 10, 6, 4, 0), datetime(2026, 10, 6, 5, 0), chosen, "GR5")
    add(session, semester, "h", datetime(2026, 10, 7, 4, 0), datetime(2026, 10, 7, 5, 0), hidden)
    body = get(client).json()
    assert day(body, "2026-10-05")["status"] == "free"
    assert day(body, "2026-10-06")["status"] == "partial"
    assert day(body, "2026-10-07")["status"] == "free"


def test_cancelled_and_holiday_are_ignored_custom_counts(client, session, semester):
    add(session, semester, "x", datetime(2026, 10, 5, 4, 0), datetime(2026, 10, 5, 6, 0), status="cancelled")
    add(session, semester, "hol", datetime(2026, 10, 6, 0, 0), datetime(2026, 10, 6, 20, 0), kind="holiday")
    add(session, semester, "mine", datetime(2026, 10, 7, 4, 0), datetime(2026, 10, 7, 6, 0), kind="work", source="custom")
    add(session, semester, "exam", datetime(2026, 10, 8, 4, 0), datetime(2026, 10, 8, 6, 0), kind="exam")
    body = get(client).json()
    assert [d["status"] for d in body["days"]] == ["free", "free", "busy", "busy", "free"]
    assert day(body, "2026-10-07")["blockers"][0]["kind"] == "work"


def test_dst_change_week_keeps_local_window(client, session, semester):
    # DST ends Sunday 2026-10-25: Mon 26 Oct is UTC+1, so 06:00-08:00 local is 05:00-07:00Z (before: 04:00-06:00Z).
    add(session, semester, "a", datetime(2026, 10, 26, 6, 30), datetime(2026, 10, 26, 8, 0))  # 07:30-09:00 local
    add(session, semester, "b", datetime(2026, 10, 23, 6, 30), datetime(2026, 10, 23, 8, 0))  # Fri CEST: 08:30 local
    add(session, semester, "c", datetime(2026, 10, 27, 7, 0), datetime(2026, 10, 27, 8, 0))  # Tue CET: 08:00 local
    body = get(client, "from=06:00&to=08:00&start=2026-10-19&end=2026-10-27").json()
    monday = day(body, "2026-10-26")
    assert (monday["status"], monday["free_minutes"]) == ("partial", 90)
    assert day(body, "2026-10-23")["status"] == "free"
    assert day(body, "2026-10-27")["status"] == "free"
    # 05:00Z-05:30Z is 06:00-06:30 local on the CET Monday: blocks the first half hour of the window
    add(session, semester, "d", datetime(2026, 10, 26, 5, 0), datetime(2026, 10, 26, 5, 30))
    again = day(get(client, "from=06:00&to=08:00&start=2026-10-26&end=2026-10-26&weekdays=0").json(), "2026-10-26")
    assert again["free_minutes"] == 60
    # and 04:00Z-04:30Z is 05:00-05:30 local on that Monday: outside the window
    add(session, semester, "e", datetime(2026, 10, 26, 4, 0), datetime(2026, 10, 26, 4, 30))
    assert day(get(client, "from=06:00&to=08:00&start=2026-10-26&end=2026-10-26&weekdays=0").json(),
               "2026-10-26")["free_minutes"] == 60


def test_validation_errors(client):
    bad = [
        "from=08:00&to=06:00&start=2026-10-05&end=2026-10-09",
        "from=06:00&to=06:00&start=2026-10-05&end=2026-10-09",
        "from=25:00&to=26:00&start=2026-10-05&end=2026-10-09",
        "from=6&to=8&start=2026-10-05&end=2026-10-09",
        "from=06:00&to=08:00&start=2026-10-09&end=2026-10-05",
        "from=06:00&to=08:00&start=2026-01-01&end=2026-07-20",  # 201 days
        BASE + "&weekdays=",
        BASE + "&weekdays=7",
        BASE + "&weekdays=a,b",
        BASE + "&buffer=-1",
        BASE + "&buffer=241",
        BASE + "&buffer=abc",
        BASE + "&min_free=0",
        BASE + "&min_free=1441",
        "from=06:00&to=08:00&start=2026-10-05",
        "to=08:00&start=2026-10-05&end=2026-10-06",
        "from=06:00&to=08:00&start=nope&end=2026-10-06",
    ]
    for query in bad:
        assert get(client, query).status_code == 422, query
    assert get(client, "from=06:00&to=08:00&start=2026-01-01&end=2026-07-18").status_code == 200  # exactly 200 days
    assert get(client, BASE + "&buffer=240&min_free=1440&weekdays=6,0").status_code == 200


def test_no_active_semester_is_unknown_not_free(client):
    body = get(client).json()
    assert (body["semester"], body["uncovered_days"], body["free_days"], body["counted_days"]) == (None, 5, 0, 5)
    assert [d["status"] for d in body["days"]] == ["unknown"] * 5
    assert all(d["counts"] is False and d["blockers"] == [] for d in body["days"])
    assert body["missing_sections"] == []
    assert body["by_weekday"][0] == {"weekday": 0, "free": 0, "total": 0}


def test_days_outside_semester_are_unknown(client, session, semester):
    semester.start_date, semester.end_date = date(2026, 10, 7), date(2026, 10, 8)
    session.commit()
    body = get(client).json()
    assert [d["status"] for d in body["days"]] == ["unknown", "unknown", "free", "free", "unknown"]
    assert (body["uncovered_days"], body["free_days"], body["counted_days"]) == (3, 2, 5)
    assert body["semester"] == {"id": semester.id, "name": "SE S1 2026", "start": "2026-10-07", "end": "2026-10-08"}
    assert get(client, BASE + "&weekdays=0").json()["uncovered_days"] == 1  # off days are not uncovered


def test_semester_without_dates_covers_everything(client, session, semester):
    semester.start_date = semester.end_date = None
    session.commit()
    body = get(client).json()
    assert (body["uncovered_days"], body["free_days"]) == (0, 5)
    assert body["semester"]["start"] is None and body["semester"]["end"] is None


def test_missing_sections_are_reported(client, session, semester):
    french = Subject(semester_id=semester.id, display_name="French", aliases=[])
    session.add(french)
    session.flush()
    add(session, semester, "fr1", datetime(2026, 10, 6, 4, 0), datetime(2026, 10, 6, 5, 0), french, "GR1")
    add(session, semester, "fr2", datetime(2026, 10, 7, 4, 0), datetime(2026, 10, 7, 5, 0), french, "GR2")
    body = get(client).json()
    assert body["missing_sections"] == [{"subject_id": french.id, "name": "French"}]
    assert day(body, "2026-10-06")["status"] == "free"
    assert "note" in execute_tool(session, "count_free_days",
                                  {"from": "06:00", "to": "08:00", "start": "2026-10-05", "end": "2026-10-09"}, NOW)


def test_class_after_period_end_blocks_last_day_via_buffer(client, session, semester):
    # 01:00 local on Sat 10 Oct is 23:00Z on the 9th; 180 min of travel makes 22:00-23:00 on Friday busy
    add(session, semester, "night", datetime(2026, 10, 9, 23, 0), datetime(2026, 10, 10, 0, 0))
    query = "from=20:00&to=23:00&start=2026-10-05&end=2026-10-09&buffer=180"
    friday = day(get(client, query).json(), "2026-10-09")
    assert (friday["status"], friday["free_minutes"], friday["longest_free"]) == ("partial", 120, 120)
    assert day(get(client, query.replace("buffer=180", "buffer=120")).json(), "2026-10-09")["status"] == "free"


def test_pure_function():
    item = BusyItem(1, "T", datetime(2026, 10, 6, 5, 0), datetime(2026, 10, 6, 6, 0), "class", "normal")
    out = compute_free_time([item], FreeTimeParams(time(6), time(8), date(2026, 10, 6), date(2026, 10, 6)))
    assert out["days"][0]["status"] == "partial" and out["free_days"] == 0


def test_ai_tool_count_free_days(session, semester):
    subject = Subject(semester_id=semester.id, display_name="Databases", aliases=[])
    session.add(subject)
    session.flush()
    add(session, semester, "p", datetime(2026, 10, 6, 5, 30), datetime(2026, 10, 6, 7, 0), subject)
    args = {"from": "06:00", "to": "08:00", "start": "2026-10-05", "end": "2026-10-09"}
    out = execute_tool(session, "count_free_days", args, NOW)
    assert (out["free_days"], out["counted_days"]) == (4, 5)
    assert out["blocked_days"] == [{"date": "2026-10-06", "status": "partial", "blockers": ["Databases 07:30-09:00"]}]
    assert len(out["by_weekday"]) == 7
    assert out["uncovered_days"] == 0 and "note" not in out
    assert execute_tool(session, "count_free_days", {**args, "min_free": 60}, NOW)["blocked_days"] == []
    assert execute_tool(session, "count_free_days", {**args, "weekdays": [1], "buffer": 25.0}, NOW)["counted_days"] == 1
    for broken in ({**args, "from": "9:99"}, {**args, "to": "05:00"}, {**args, "weekdays": [9]}, {**args, "buffer": 500},
                   {**args, "end": "2026-01-01"}, {**args, "start": "2025-01-01"}, {**args, "weekdays": []}):
        assert "error" in execute_tool(session, "count_free_days", broken, NOW), broken


def test_ai_tool_blocked_days_capped(session, semester):
    for n in range(15):
        add(session, semester, f"e{n}", datetime(2026, 10, 5 + n, 4, 0), datetime(2026, 10, 5 + n, 6, 0))
    out = execute_tool(session, "count_free_days", {"from": "06:00", "to": "08:00", "start": "2026-10-05",
                                                      "end": "2026-10-19", "weekdays": [0, 1, 2, 3, 4, 5, 6]}, NOW)
    assert len(out["blocked_days"]) == 10
