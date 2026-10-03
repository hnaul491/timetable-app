import re

import httpx

KEY_RE = re.compile(r"[A-Za-z0-9_-]{4,128}")
LINK_RE = re.compile(r"/ics/([^/?#\s]+)")


class ZeusFetchError(Exception):
    def __init__(self, message: str, *, auth: bool = False) -> None:
        super().__init__(message)
        self.auth = auth


def extract_key(value: str) -> str:
    value = value.strip()
    match = LINK_RE.search(value)
    key = match.group(1) if match else value
    if not KEY_RE.fullmatch(key):
        raise ValueError("not a valid Zeus ICS link or key")
    return key


def build_ics_url(base_url: str, group_id: int, key: str) -> str:
    return f"{base_url.rstrip('/')}/api/group/{group_id}/ics/{key}"


def fetch_ics(url: str, client: httpx.Client | None = None) -> str:
    owns_client = client is None
    http = client or httpx.Client(timeout=8.0)
    try:
        response = http.get(url, headers={"Accept": "text/calendar"})
    except httpx.HTTPError as exc:
        # Never include the exception text: it contains the URL, which contains the key.
        raise ZeusFetchError(f"network error ({type(exc).__name__})") from None
    finally:
        if owns_client:
            http.close()
    if response.status_code in (401, 403):
        raise ZeusFetchError("Zeus rejected the ICS link", auth=True)
    if response.status_code != 200:
        raise ZeusFetchError(f"Zeus returned HTTP {response.status_code}")
    return response.text
