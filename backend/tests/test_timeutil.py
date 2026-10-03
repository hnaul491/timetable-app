from datetime import date, datetime, timedelta, timezone

from app.timeutil import iso_utc, to_naive_utc


def test_aware_datetime_converted_to_naive_utc():
    paris_summer = timezone(timedelta(hours=2))
    assert to_naive_utc(datetime(2026, 10, 20, 14, 30, tzinfo=paris_summer)) == datetime(2026, 10, 20, 12, 30)


def test_naive_datetime_is_kept():
    assert to_naive_utc(datetime(2026, 10, 20, 12, 30)) == datetime(2026, 10, 20, 12, 30)


def test_date_becomes_midnight():
    assert to_naive_utc(date(2026, 12, 21)) == datetime(2026, 12, 21, 0, 0)


def test_iso_utc_has_z_suffix():
    assert iso_utc(datetime(2026, 10, 20, 12, 30)) == "2026-10-20T12:30:00Z"
