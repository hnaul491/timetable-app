from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Event, Note, Subject, Task
from app.schemas import Deleted, TaskCreate, TaskOut, TaskPatch
from app.services.note_tasks import update_line
from app.services.task_query import task_out_list

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _task(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(status: Literal["todo", "doing", "done"] | None = None, subject_id: int | None = None,
               session: Session = Depends(get_session)) -> list[TaskOut]:
    query = select(Task)
    if status is not None:
        query = query.where(Task.status == status)
    if subject_id is not None:
        query = query.where(Task.subject_id == subject_id)
    query = query.order_by(Task.due_date.is_(None), Task.due_date, Task.position, Task.id)
    return task_out_list(session, list(session.scalars(query)))


def add_task(session: Session, body: TaskCreate, now: datetime, source: str) -> Task:
    """Validate and add (not commit) a task; an event link must belong to the same subject when one is given."""
    subject_id = body.subject_id
    if subject_id is not None and session.get(Subject, subject_id) is None:
        raise HTTPException(status_code=422, detail="unknown subject")
    if body.event_id is not None:
        event = session.get(Event, body.event_id)
        if event is None:
            raise HTTPException(status_code=422, detail="unknown event")
        if subject_id is not None and event.subject_id != subject_id:
            raise HTTPException(status_code=422, detail="event does not belong to this subject")
        subject_id = event.subject_id
    task = Task(note_id=None, event_id=body.event_id, subject_id=subject_id, title=body.title.strip(),
                status="todo", due_date=body.due_date, important=body.important, position=0,
                source=source, created_at=now)
    session.add(task)
    return task


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> TaskOut:
    task = add_task(session, body, now, "manual")
    session.commit()
    return task_out_list(session, [task])[0]


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def patch_task(task_id: int, body: TaskPatch, session: Session = Depends(get_session)) -> TaskOut:
    task = _task(session, task_id)
    sent = body.model_fields_set
    if "title" in sent and body.title is not None:
        if task.source == "note":
            raise HTTPException(status_code=422, detail="edit the class note to rename this task")
        task.title = body.title.strip()
    if "status" in sent and body.status is not None:
        task.status = body.status
    if "due_date" in sent:
        task.due_date = body.due_date
    if "important" in sent and body.important is not None:
        task.important = body.important
    if task.source == "note" and task.note_id is not None and sent & {"status", "due_date"}:
        note = session.get(Note, task.note_id)
        twins = session.scalars(
            select(Task.id).where(Task.note_id == task.note_id, Task.title == task.title).order_by(Task.position, Task.id)
        ).all()
        note.body = update_line(note.body, task.title, task.status == "done", task.due_date, list(twins).index(task.id))
    session.commit()
    return task_out_list(session, [task])[0]


@router.delete("/tasks/{task_id}", response_model=Deleted)
def delete_task(task_id: int, session: Session = Depends(get_session)) -> Deleted:
    task = _task(session, task_id)
    if task.source == "note":
        raise HTTPException(status_code=400, detail="remove the line from the class note to delete this task")
    session.delete(task)
    session.commit()
    return Deleted(deleted=True)
