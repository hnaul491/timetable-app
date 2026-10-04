from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Semester
from app.schemas import SemesterOut, SemesterPatch

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _all(session: Session) -> list[SemesterOut]:
    rows = session.scalars(select(Semester).order_by(Semester.code))
    return [SemesterOut.model_validate(row, from_attributes=True) for row in rows]


def _semester(session: Session, semester_id: int) -> Semester:
    semester = session.get(Semester, semester_id)
    if semester is None:
        raise HTTPException(status_code=404, detail="semester not found")
    return semester


@router.get("/semesters", response_model=list[SemesterOut])
def list_semesters(session: Session = Depends(get_session)) -> list[SemesterOut]:
    return _all(session)


@router.put("/semesters/{semester_id}/activate", response_model=list[SemesterOut])
def activate(semester_id: int, session: Session = Depends(get_session)) -> list[SemesterOut]:
    target = _semester(session, semester_id)
    for semester in session.scalars(select(Semester)):
        semester.is_active = semester.id == target.id
    session.commit()
    return _all(session)


@router.patch("/semesters/{semester_id}", response_model=SemesterOut)
def patch_semester(semester_id: int, body: SemesterPatch, session: Session = Depends(get_session),
                   now: datetime = Depends(get_now)) -> SemesterOut:
    semester = _semester(session, semester_id)
    sent = body.model_fields_set
    if "zeus_group_id" in sent:
        if body.zeus_group_id is not None and body.zeus_group_id != semester.zeus_group_id:
            semester.group_changed_at = now  # the next sync may replace the old group's upcoming classes
        semester.zeus_group_id = body.zeus_group_id
    if "start_date" in sent:
        semester.start_date = body.start_date
    if "end_date" in sent:
        semester.end_date = body.end_date
    if semester.start_date and semester.end_date and semester.end_date < semester.start_date:
        session.rollback()
        raise HTTPException(status_code=422, detail="end date must be on or after start date")
    session.commit()
    return SemesterOut.model_validate(semester, from_attributes=True)
