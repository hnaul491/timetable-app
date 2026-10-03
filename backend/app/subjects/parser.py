import re
from dataclasses import dataclass

SECTION_RE = re.compile(r"^(G\d+|GR\d+)\s*-\s*(.+)$")
EXAM_RE = re.compile(r"\s+exam$", re.IGNORECASE)
HOLIDAY_TITLES = {"vacances", "bank holiday"}


@dataclass(frozen=True)
class ParsedTitle:
    base_name: str | None
    section: str | None
    kind: str


def parse_title(raw: str) -> ParsedTitle:
    title = " ".join(raw.split())
    if title.casefold() in HOLIDAY_TITLES:
        return ParsedTitle(None, None, "holiday")
    section = None
    match = SECTION_RE.match(title)
    if match:
        section, title = match.group(1), match.group(2).strip()
    kind = "class"
    if EXAM_RE.search(title):
        kind = "exam"
        title = EXAM_RE.sub("", title)
    return ParsedTitle(title, section, kind)
