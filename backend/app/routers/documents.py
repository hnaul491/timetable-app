from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.deps import get_drive_factory, get_now
from app.gcal.api import ACCOUNT_ID, REFRESH_TOKEN_NAME, GoogleError, GoogleNotFound
from app.gdrive.api import DriveFactory
from app.models import Document, DocumentUpload, Event, GoogleAccount, Subject
from app.schemas import AllDocumentsOut, DocumentOut, DocumentPatch, UploadChunkOut, UploadStartIn, UploadStartOut
from app.secret_store import SecretStore
from app.services import documents as docs

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _document(session: Session, document_id: int) -> Document:
    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")
    return document


def _listing(session: Session, *conditions: object) -> list[DocumentOut]:
    rows = session.scalars(select(Document).where(*conditions).order_by(Document.created_at.desc(),
                                                                       Document.id.desc())).all()
    return docs.document_outs(session, list(rows))


@router.get("/documents", response_model=AllDocumentsOut)
def all_documents(session: Session = Depends(get_session)) -> AllDocumentsOut:
    return docs.all_documents(session)


@router.get("/subjects/{subject_id}/documents", response_model=list[DocumentOut])
def subject_documents(subject_id: int, session: Session = Depends(get_session)) -> list[DocumentOut]:
    if session.get(Subject, subject_id) is None:
        raise HTTPException(status_code=404, detail="subject not found")
    return _listing(session, Document.subject_id == subject_id)


@router.get("/events/{event_id}/documents", response_model=list[DocumentOut])
def event_documents(event_id: int, session: Session = Depends(get_session)) -> list[DocumentOut]:
    if session.get(Event, event_id) is None:
        raise HTTPException(status_code=404, detail="event not found")
    return _listing(session, Document.event_id == event_id)


@router.post("/documents/uploads", response_model=UploadStartOut)
def start_upload(body: UploadStartIn, session: Session = Depends(get_session),
                 settings: Settings = Depends(get_settings), factory: DriveFactory = Depends(get_drive_factory),
                 now: datetime = Depends(get_now)) -> UploadStartOut:
    subject = session.get(Subject, body.subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="subject not found")
    if body.event_id is not None:
        docs.event_for_subject(session, body.event_id, subject.id)
    drive = docs.open_drive(session, settings, factory)
    try:
        upload = docs.begin_upload(session, drive, body, subject, now, settings.token_encryption_key)
    except GoogleError as exc:
        session.rollback()
        raise docs.google_error(exc) from None
    finally:
        docs.close_drive(drive)
    return UploadStartOut(upload_id=upload.id, chunk_size=docs.CHUNK_SIZE)


@router.put("/documents/uploads/{upload_id}", response_model=UploadChunkOut)
def upload_chunk(upload_id: str, offset: int = Query(ge=0), data: Annotated[bytes, Body(media_type="application/octet-stream")] = b"",
                 session: Session = Depends(get_session),
                 settings: Settings = Depends(get_settings), factory: DriveFactory = Depends(get_drive_factory),
                 now: datetime = Depends(get_now)) -> UploadChunkOut:
    upload = session.get(DocumentUpload, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="upload not found")
    docs.check_chunk(upload, data, offset)
    drive = docs.open_drive(session, settings, factory)
    try:
        document = docs.send_chunk(session, drive, upload, data, offset, now, settings.token_encryption_key)
    except GoogleError as exc:
        session.rollback()
        raise docs.google_error(exc) from None
    finally:
        docs.close_drive(drive)
    if document is None:
        return UploadChunkOut(received=upload.received, document=None)
    return UploadChunkOut(received=document.size, document=docs.document_outs(session, [document])[0])


@router.patch("/documents/{document_id}", response_model=DocumentOut)
def patch_document(document_id: int, body: DocumentPatch, session: Session = Depends(get_session)) -> DocumentOut:
    document = _document(session, document_id)
    if "tag" in body.model_fields_set and body.tag is not None:
        document.tag = body.tag
    if "event_id" in body.model_fields_set:
        if body.event_id is not None:
            docs.event_for_subject(session, body.event_id, document.subject_id)
        document.event_id = body.event_id
    session.commit()
    return docs.document_outs(session, [document])[0]


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(document_id: int, session: Session = Depends(get_session),
                    settings: Settings = Depends(get_settings),
                    factory: DriveFactory = Depends(get_drive_factory)) -> Response:
    document = _document(session, document_id)
    account = session.get(GoogleAccount, ACCOUNT_ID)
    token = SecretStore(session, settings.token_encryption_key).get(REFRESH_TOKEN_NAME) if account else None
    if token:  # without a Google connection the Drive copy can no longer be reached: only the row goes
        drive = factory(token)
        try:
            drive.trash(document.drive_file_id)
        except GoogleNotFound:
            pass  # already gone in Drive
        except GoogleError as exc:
            raise docs.google_error(exc) from None
        finally:
            docs.close_drive(drive)
    session.delete(document)
    session.commit()
    return Response(status_code=204)
