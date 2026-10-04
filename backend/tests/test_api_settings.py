from datetime import datetime

from sqlalchemy import select

from app.models import Event, MySection, Subject
from app.secret_store import ZEUS_KEY_NAME, SecretStore
from tests.conftest import AUTH


def seed_sections(session, semester, sections):
    french = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[])
    session.add(french)
    session.flush()
    for i, section in enumerate(sections):
        session.add(Event(source="zeus", zeus_uid=f"u{i}", semester_id=semester.id, subject_id=french.id,
                          section=section, title_raw="x", start_at=datetime(2026, 10, 20, 12),
                          end_at=datetime(2026, 10, 20, 14), kind="class"))
    session.commit()
    return french


def test_semesters_list(client, semester):
    [s1] = client.get("/api/semesters", headers=AUTH).json()
    assert (s1["code"], s1["is_active"], s1["zeus_group_id"]) == ("S1", True, 802)


def test_sections_are_naturally_sorted(client, session, semester):
    seed_sections(session, semester, ["GR10", "GR2", "GR1", "GR2"])
    [choice] = client.get("/api/settings/sections", headers=AUTH).json()
    assert choice["sections"] == ["GR1", "GR2", "GR10"]
    assert choice["chosen"] is None


def test_choose_section_then_change_it(client, session, semester):
    french = seed_sections(session, semester, ["GR1", "GR5"])
    resp = client.put("/api/settings/sections", json={"subject_id": french.id, "section": "GR5"}, headers=AUTH)
    assert resp.status_code == 200 and resp.json()["chosen"] == "GR5"
    client.put("/api/settings/sections", json={"subject_id": french.id, "section": "GR1"}, headers=AUTH)
    assert session.scalar(select(MySection.section)) == "GR1"


def test_choose_unknown_section_is_422(client, session, semester):
    french = seed_sections(session, semester, ["GR1"])
    resp = client.put("/api/settings/sections", json={"subject_id": french.id, "section": "GR9"}, headers=AUTH)
    assert resp.status_code == 422


def test_put_zeus_key_accepts_full_link_and_never_returns_it(client, session, settings, semester):
    assert client.get("/api/settings/zeus-key", headers=AUTH).json() == {"configured": False, "group_mismatch": None}
    link = "https://zeus.ionis-it.com/api/group/802/ics/AbC123xyZ9?startDate=2026-10-10"
    resp = client.put("/api/settings/zeus-key", json={"value": link}, headers=AUTH)
    assert resp.json() == {"configured": True, "group_mismatch": None}
    assert client.get("/api/settings/zeus-key", headers=AUTH).json() == {"configured": True, "group_mismatch": None}
    assert SecretStore(session, settings.token_encryption_key).get(ZEUS_KEY_NAME) == "AbC123xyZ9"


GROUP_LINK = "https://zeus.ionis-it.com/api/group/{gid}/ics/AbC123xyZ9"


def test_put_zeus_key_link_sets_missing_group(client, session, semester):
    semester.zeus_group_id = None
    session.commit()
    resp = client.put("/api/settings/zeus-key", json={"value": GROUP_LINK.format(gid=905)}, headers=AUTH)
    assert resp.json() == {"configured": True, "group_mismatch": None}
    session.refresh(semester)
    assert semester.zeus_group_id == 905


def test_put_zeus_key_link_same_group(client, session, semester):
    resp = client.put("/api/settings/zeus-key", json={"value": GROUP_LINK.format(gid=802)}, headers=AUTH)
    assert resp.json() == {"configured": True, "group_mismatch": None}
    session.refresh(semester)
    assert semester.zeus_group_id == 802


def test_put_zeus_key_link_different_group_reports_mismatch(client, session, semester):
    resp = client.put("/api/settings/zeus-key", json={"value": GROUP_LINK.format(gid=905)}, headers=AUTH)
    assert resp.json() == {"configured": True,
                           "group_mismatch": {"link_group": 905, "semester_group": 802}}
    session.refresh(semester)
    assert semester.zeus_group_id == 802


def test_put_zeus_key_bare_key_leaves_group(client, session, semester):
    resp = client.put("/api/settings/zeus-key", json={"value": "AbC123xyZ9"}, headers=AUTH)
    assert resp.json() == {"configured": True, "group_mismatch": None}
    session.refresh(semester)
    assert semester.zeus_group_id == 802


def test_put_zeus_key_rejects_garbage(client, semester):
    resp = client.put("/api/settings/zeus-key", json={"value": "hello world"}, headers=AUTH)
    assert resp.status_code == 422


def test_choose_all_groups(client, session, semester):
    french = seed_sections(session, semester, ["G1", "G2"])
    resp = client.put("/api/settings/sections", json={"subject_id": french.id, "section": "ALL"}, headers=AUTH)
    assert resp.status_code == 200 and resp.json()["chosen"] == "ALL"
    [choice] = client.get("/api/settings/sections", headers=AUTH).json()
    assert choice["chosen"] == "ALL"
    assert choice["sections"] == ["G1", "G2"]
