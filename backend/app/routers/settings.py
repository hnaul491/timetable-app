from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.models import MySection
from app.schemas import SectionChoiceOut, SectionUpdate, ZeusGroupMismatch, ZeusKeyStatus, ZeusKeyUpdate
from app.secret_store import ZEUS_KEY_NAME, SecretStore, get_zeus_key
from app.services.events_query import ALL_SECTIONS, active_semester, section_choices
from app.zeus.ics_client import extract_group_id, extract_key

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


@router.get("/settings/sections", response_model=list[SectionChoiceOut])
def get_sections(session: Session = Depends(get_session)) -> list[SectionChoiceOut]:
    semester = active_semester(session)
    if semester is None:
        return []
    return [SectionChoiceOut(**vars(c)) for c in section_choices(session, semester.id)]


@router.put("/settings/sections", response_model=SectionChoiceOut)
def put_section(body: SectionUpdate, session: Session = Depends(get_session)) -> SectionChoiceOut:
    semester = active_semester(session)
    choices = {c.subject_id: c for c in section_choices(session, semester.id)} if semester else {}
    choice = choices.get(body.subject_id)
    if choice is None or (body.section != ALL_SECTIONS and body.section not in choice.sections):
        raise HTTPException(status_code=422, detail="unknown subject or section")
    row = session.get(MySection, body.subject_id)
    if row is None:
        session.add(MySection(subject_id=body.subject_id, section=body.section))
    else:
        row.section = body.section
    session.commit()
    return SectionChoiceOut(subject_id=choice.subject_id, subject_name=choice.subject_name,
                            sections=choice.sections, chosen=body.section)


@router.delete("/settings/sections/{subject_id}", status_code=204)
def remove_section(subject_id: int, session: Session = Depends(get_session)) -> None:
    """Clear the chosen group: the subject's grouped classes are hidden again until a group is picked."""
    row = session.get(MySection, subject_id)
    if row is not None:
        session.delete(row)
        session.commit()


@router.get("/settings/zeus-key", response_model=ZeusKeyStatus)
def get_zeus_key_status(session: Session = Depends(get_session),
                        settings: Settings = Depends(get_settings)) -> ZeusKeyStatus:
    return ZeusKeyStatus(configured=get_zeus_key(session, settings) is not None)


@router.put("/settings/zeus-key", response_model=ZeusKeyStatus)
def put_zeus_key(body: ZeusKeyUpdate, session: Session = Depends(get_session),
                 settings: Settings = Depends(get_settings)) -> ZeusKeyStatus:
    try:
        key = extract_key(body.value)
    except ValueError:
        raise HTTPException(status_code=422, detail="Paste the Zeus ICS link (or its key)") from None
    if not settings.token_encryption_key:
        raise HTTPException(status_code=500, detail="server is missing TOKEN_ENCRYPTION_KEY")
    SecretStore(session, settings.token_encryption_key).set(ZEUS_KEY_NAME, key)
    mismatch = None
    link_group = extract_group_id(body.value)
    semester = active_semester(session)
    if link_group is not None and semester is not None:
        if semester.zeus_group_id is None:
            semester.zeus_group_id = link_group
        elif semester.zeus_group_id != link_group:
            mismatch = ZeusGroupMismatch(link_group=link_group, semester_group=semester.zeus_group_id)
    session.commit()
    return ZeusKeyStatus(configured=True, group_mismatch=mismatch)
