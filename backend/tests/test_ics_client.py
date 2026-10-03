import httpx
import pytest

from app.zeus.ics_client import ZeusFetchError, build_ics_url, extract_key, fetch_ics

KEY = "AbC123xyZ9"
URL = f"https://zeus.ionis-it.com/api/group/802/ics/{KEY}"


def client_returning(status: int, text: str = "") -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(status, text=text)))


def test_build_ics_url():
    assert build_ics_url("https://zeus.ionis-it.com/", 802, KEY) == URL


def test_fetch_returns_body_on_200():
    assert fetch_ics(URL, client_returning(200, "BEGIN:VCALENDAR")) == "BEGIN:VCALENDAR"


@pytest.mark.parametrize("status", [401, 403])
def test_fetch_flags_auth_errors(status):
    with pytest.raises(ZeusFetchError) as info:
        fetch_ics(URL, client_returning(status))
    assert info.value.auth is True


def test_fetch_raises_on_server_error():
    with pytest.raises(ZeusFetchError) as info:
        fetch_ics(URL, client_returning(500))
    assert info.value.auth is False
    assert "500" in str(info.value)


def test_network_error_message_does_not_contain_key():
    def boom(request):
        raise httpx.ConnectError(f"cannot connect to {request.url}")

    with pytest.raises(ZeusFetchError) as info:
        fetch_ics(URL, httpx.Client(transport=httpx.MockTransport(boom)))
    assert KEY not in str(info.value)
    assert info.value.__cause__ is None


@pytest.mark.parametrize(
    "value",
    [KEY, f"  {KEY}  ", URL, f"{URL}?startDate=2026-10-10", f"{URL}/"],
)
def test_extract_key(value):
    assert extract_key(value) == KEY


@pytest.mark.parametrize("value", ["", "hello world", "https://zeus.ionis-it.com/", "a/b"])
def test_extract_key_rejects_garbage(value):
    with pytest.raises(ValueError):
        extract_key(value)
