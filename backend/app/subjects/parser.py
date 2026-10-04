import re
from dataclasses import dataclass

SECTION_RE = re.compile(r"^(G\d+|GR\d+)\s*-\s*(.+)$")
GROUP_HOLIDAY_RE = re.compile(r"^(?:G|GR)\d+\s*-\s*(.+)$", re.IGNORECASE)
EXAM_RE = re.compile(r"\s+exam$", re.IGNORECASE)
HOLIDAY_TITLES = {"vacances", "bank holiday"}


@dataclass(frozen=True)
class ParsedTitle:
    base_name: str | None
    section: str | None
    kind: str


def parse_title(raw: str) -> ParsedTitle:
    title = " ".join(raw.split())
    grouped = GROUP_HOLIDAY_RE.match(title)
    # A holiday may carry a group prefix ("GR1 - Vacances"); it is still no class, section or subject.
    if title.casefold() in HOLIDAY_TITLES or (grouped and grouped.group(1).strip().casefold() in HOLIDAY_TITLES):
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
