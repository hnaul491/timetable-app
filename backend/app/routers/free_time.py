from datetime import date, time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.services.free_time import (MAX_BUFFER, MAX_DAYS, MAX_MIN_FREE, DEFAULT_WEEKDAYS, FreeTimeParams,
                                    free_time_for_session)

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _bad(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _clock(value: str, field: str) -> time:
    try:
        if len(value) != 5 or value[2] != ":":
            raise ValueError
        return time.fromisoformat(value)
    except ValueError:
        raise _bad(f"{field} must be HH:MM") from None


def parse_weekdays(raw: str | None) -> tuple[int, ...]:
    if raw is None:
        return DEFAULT_WEEKDAYS
    try:
        days = {int(p) for p in raw.split(",")}
    except ValueError:
        raise _bad("weekdays must be a comma list of 0-6") from None
    if not days or any(d < 0 or d > 6 for d in days):
        raise _bad("weekdays must be a comma list of 0-6")
    return tuple(sorted(days))


@router.get("/free-time")
def get_free_time(
    from_: str = Query(alias="from"), to: str = Query(), start: date = Query(), end: date = Query(),
    weekdays: str | None = Query(default=None),
    buffer: int = Query(default=0, ge=0, le=MAX_BUFFER),
    min_free: int | None = Query(default=None, ge=1, le=MAX_MIN_FREE),
    session: Session = Depends(get_session),
) -> dict:
    t_from, t_to = _clock(from_, "from"), _clock(to, "to")
    if t_from >= t_to:
        raise _bad("from must be before to")
    if end < start:
        raise _bad("end must not be before start")
    if (end - start).days + 1 > MAX_DAYS:
        raise _bad(f"period is limited to {MAX_DAYS} days")
    params = FreeTimeParams(t_from, t_to, start, end, parse_weekdays(weekdays), buffer, min_free)
    return free_time_for_session(session, params)
