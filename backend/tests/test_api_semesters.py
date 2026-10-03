from datetime import date

from app.models import Semester
from app.seed import seed
from tests.conftest import AUTH


def seeded(session):
    seed(session)
    session.commit()
    return {s.code: s for s in session.query(Semester).all()}


def test_list_is_moved_and_unchanged(client, session):
    seeded(session)
    rows = client.get("/api/semesters", headers=AUTH).json()
    assert [(r["code"], r["is_active"]) for r in rows] == [("S1", True), ("S2", False), ("S3", False)]


def test_activate_switches_and_back(client, session, monkeypatch):
    from app.deps import get_fetcher
    from app.zeus.ics_client import ZeusFetchError

    def fetch(semester):
        if semester.zeus_group_id is None:
            raise ZeusFetchError("active semester has no Zeus group id")
        return ""

    monkeypatch.setitem(client.app.dependency_overrides, get_fetcher, lambda: fetch)  # auto-restored
    sems = seeded(session)
    rows = client.put(f"/api/semesters/{sems['S2'].id}/activate", headers=AUTH).json()
    assert [r["code"] for r in rows if r["is_active"]] == ["S2"]
    events = client.get("/api/events?start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z", headers=AUTH).json()
    assert events["events"] == []
    run = client.post("/api/sync", headers=AUTH).json()
    assert (run["status"], run["error"]) == ("failed", "active semester has no Zeus group id")
    rows = client.put(f"/api/semesters/{sems['S1'].id}/activate", headers=AUTH).json()
    assert [r["code"] for r in rows if r["is_active"]] == ["S1"]
    assert client.put("/api/semesters/999/activate", headers=AUTH).status_code == 404


def test_patch_group_and_dates(client, session):
    sems = seeded(session)
    r = client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH,
                     json={"zeus_group_id": 905, "start_date": "2027-02-01", "end_date": "2027-06-30"}).json()
    assert (r["zeus_group_id"], r["start_date"], r["end_date"]) == (905, "2027-02-01", "2027-06-30")
    r = client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH, json={"zeus_group_id": None}).json()
    assert (r["zeus_group_id"], r["start_date"]) == (None, "2027-02-01")
    assert client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH, json={"zeus_group_id": 0}).status_code == 422
    assert client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH,
                        json={"start_date": "2027-07-01", "end_date": "2027-06-30"}).status_code == 422
    assert client.patch("/api/semesters/999", headers=AUTH, json={"zeus_group_id": 1}).status_code == 404
