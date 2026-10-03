from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Subject

PALETTE = [
    "#2E55E6", "#6A45D8", "#0E7F72", "#B25E00", "#2F7D32", "#C0306A",
    "#8A6D00", "#0F6E9E", "#9C3D9C", "#5E5A00", "#4F6B2A", "#3B4252",
]


class SubjectResolver:
    def __init__(self, session: Session, semester_id: int) -> None:
        self._session = session
        self._semester_id = semester_id
        self._subjects = list(session.scalars(
            select(Subject).where(Subject.semester_id == semester_id).order_by(Subject.id)
        ))

    def _next_color(self) -> str:
        used = {s.color for s in self._subjects}
        for color in PALETTE:
            if color not in used:
                return color
        return PALETTE[len(self._subjects) % len(PALETTE)]

    def resolve(self, base_name: str) -> Subject:
        key = base_name.casefold()
        for subject in self._subjects:
            if subject.display_name.casefold() == key or any(a.casefold() == key for a in subject.aliases):
                return subject
        subject = Subject(
            semester_id=self._semester_id,
            display_name=base_name,
            color=self._next_color(),
            aliases=[],
            hidden=False,
        )
        self._session.add(subject)
        self._session.flush()
        self._subjects.append(subject)
        return subject
