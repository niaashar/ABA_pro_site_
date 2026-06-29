"""Build ``data/meetings.json`` from a private iCal calendar export.

The private calendar URL is read only from the ``YANDEX_CALENDAR_ICS_URL``
GitHub Actions secret. The URL is never written to site files or logs.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

import recurring_ical_events
import requests
from dateutil import tz
from icalendar import Calendar

DISPLAY_TZ = tz.gettz("Europe/Moscow")
ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "data" / "meetings.json"
MAX_EVENTS = 24
LOOKAHEAD_DAYS = 550


class SyncError(RuntimeError):
    """A safe-to-log synchronization error that never exposes the secret URL."""


def normalize_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime.combine(value, time.min)
    else:
        raise TypeError("Unsupported calendar date value")

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=DISPLAY_TZ)
    return dt.astimezone(DISPLAY_TZ)


def is_all_day(value: Any) -> bool:
    return isinstance(value, date) and not isinstance(value, datetime)


def clean_text(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\\n", "\n").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def valid_external_url(value: str) -> str:
    value = value.strip()
    if re.match(r"^(https?://|mailto:|tel:)", value, re.IGNORECASE):
        return value
    return ""


def infer_audience(title: str, description: str, categories: str = "") -> tuple[str, str]:
    source = f"{title} {description} {categories}".lower()
    has_parents = "родител" in source
    has_specialists = "специалист" in source
    if has_parents and not has_specialists:
        return "Для родителей", "parents"
    if has_specialists and not has_parents:
        return "Для специалистов", "specialists"
    return "Для родителей и специалистов", "all"


def infer_format(text: str) -> tuple[str, str]:
    source = text.lower()
    if any(word in source for word in ("онлайн", "zoom", "телемост", "вебинар", "video", "meet")):
        return "Онлайн", "online"
    if any(word in source for word in ("очно", "краснодар", "яблоновский", "энем", "новая адыгея")):
        return "Очно", "offline"
    return "", ""


def format_duration(start: datetime, end: datetime | None, all_day: bool) -> str:
    if all_day or end is None or end <= start:
        return ""
    minutes = int((end - start).total_seconds() // 60)
    hours, remainder = divmod(minutes, 60)
    if hours and remainder:
        return f"{hours} ч {remainder} мин"
    if hours:
        return f"{hours} ч"
    return f"{remainder} мин"


def parse_description(raw_description: str) -> dict[str, str]:
    result: dict[str, str] = {}
    free_lines: list[str] = []
    key_aliases = {
        "для кого": "audience",
        "аудитория": "audience",
        "категория": "audience",
        "формат": "format",
        "продолжительность": "duration",
        "длительность": "duration",
        "стоимость": "price",
        "цена": "price",
        "описание": "description",
        "о встрече": "description",
        "запись": "registration",
        "ссылка для записи": "registration",
        "подробнее": "details_url",
        "ссылка": "details_url",
    }

    for original_line in raw_description.splitlines():
        line = original_line.strip(" •\t")
        if not line:
            continue
        match = re.match(r"^([^:]{2,45}):\s*(.+)$", line)
        if match:
            key = match.group(1).strip().lower()
            value = match.group(2).strip()
            mapped = key_aliases.get(key)
            if mapped:
                result[mapped] = value
                continue
        free_lines.append(line)

    if "description" not in result and free_lines:
        result["description"] = " ".join(free_lines)
    return result


def normalize_calendar_url(raw_url: str) -> str:
    value = raw_url.strip().strip('"').strip("'")
    if value.lower().startswith("webcal://"):
        value = "https://" + value[len("webcal://") :]

    parsed = urlparse(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise SyncError("Calendar secret must contain a valid HTTPS, HTTP or webcal iCal link")
    return value


def download_calendar(ics_url: str) -> bytes:
    try:
        response = requests.get(
            ics_url,
            timeout=45,
            allow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ABA_pro calendar sync/3.0)",
                "Accept": "text/calendar,text/plain,*/*",
            },
        )
    except requests.RequestException as exc:
        raise SyncError(f"Calendar download failed ({type(exc).__name__})") from None

    if response.status_code != 200:
        raise SyncError(f"Calendar returned HTTP {response.status_code}")
    content = response.content
    if not content.strip():
        raise SyncError("Calendar returned an empty response")

    normalized = content.lstrip(b"\xef\xbb\xbf \t\r\n")
    if not normalized.upper().startswith(b"BEGIN:VCALENDAR"):
        raise SyncError("The calendar link did not return valid iCal data")
    return content


def raw_events(calendar: Calendar) -> list[Any]:
    return [component for component in calendar.walk() if component.name == "VEVENT"]


def expanded_events(calendar: Calendar, start: datetime, end: datetime) -> list[Any]:
    try:
        return list(recurring_ical_events.of(calendar).between(start, end))
    except Exception:
        # Non-recurring events can still be processed directly if recurrence
        # expansion fails on a provider-specific field.
        return raw_events(calendar)


def component_start(component: Any) -> datetime | None:
    try:
        return normalize_datetime(component.decoded("dtstart"))
    except Exception:
        return None


def deduplicate_components(components: Iterable[Any]) -> list[Any]:
    seen: set[tuple[str, str]] = set()
    result: list[Any] = []
    for component in components:
        start = component_start(component)
        if start is None:
            continue
        uid = clean_text(component.get("uid"))
        key = (uid, start.isoformat())
        if key in seen:
            continue
        seen.add(key)
        result.append(component)
    return result


def build_events(calendar_content: bytes, now: datetime) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        calendar = Calendar.from_ical(calendar_content)
    except Exception as exc:
        raise SyncError(f"Invalid iCal response ({type(exc).__name__})") from None

    range_start = now - timedelta(days=1)
    range_end = now + timedelta(days=LOOKAHEAD_DAYS)
    raw = raw_events(calendar)
    expanded = expanded_events(calendar, range_start, range_end)
    components = deduplicate_components(expanded)

    events: list[dict[str, Any]] = []
    skipped_past = 0
    skipped_invalid = 0
    skipped_cancelled = 0

    for component in components:
        if clean_text(component.get("status")).upper() == "CANCELLED":
            skipped_cancelled += 1
            continue

        try:
            start_raw = component.decoded("dtstart")
            start = normalize_datetime(start_raw)
        except Exception:
            skipped_invalid += 1
            continue

        end: datetime | None = None
        if component.get("dtend") is not None:
            try:
                end = normalize_datetime(component.decoded("dtend"))
            except Exception:
                end = None

        all_day = is_all_day(start_raw)
        effective_end = end or start
        if effective_end < now - timedelta(hours=1):
            skipped_past += 1
            continue
        if start > range_end:
            continue

        title = clean_text(component.get("summary")) or "Обучающая встреча ABA_pro"
        raw_description = clean_text(component.get("description"))
        location = clean_text(component.get("location"))
        event_url = valid_external_url(clean_text(component.get("url")))
        categories = clean_text(component.get("categories"))
        parsed = parse_description(raw_description)

        audience, audience_key = infer_audience(title, parsed.get("audience", raw_description), categories)
        if parsed.get("audience"):
            audience = parsed["audience"]
            lower_audience = audience.lower()
            has_parents = "родител" in lower_audience
            has_specialists = "специалист" in lower_audience
            if has_parents and not has_specialists:
                audience_key = "parents"
            elif has_specialists and not has_parents:
                audience_key = "specialists"
            else:
                audience_key = "all"

        format_label, format_key = infer_format(
            " ".join((parsed.get("format", ""), location, raw_description, categories))
        )
        if parsed.get("format"):
            format_label = parsed["format"]
            format_key = infer_format(format_label)[1]

        uid = clean_text(component.get("uid")) or f"{title}-{start.isoformat()}"
        description = parsed.get("description", "") or "Подробности встречи указаны в полном расписании."
        duration = parsed.get("duration", "") or format_duration(start, end, all_day)
        details_url = valid_external_url(parsed.get("details_url", "")) or event_url
        registration_url = valid_external_url(parsed.get("registration", ""))

        events.append(
            {
                "id": uid,
                "title": title,
                "start": start.isoformat(),
                "end": end.isoformat() if end else None,
                "allDay": all_day,
                "audience": audience,
                "audienceKey": audience_key,
                "format": format_label,
                "formatKey": format_key,
                "duration": duration,
                "price": parsed.get("price", ""),
                "location": location,
                "description": description,
                "detailsUrl": details_url,
                "registrationUrl": registration_url,
            }
        )

    events.sort(key=lambda event: event["start"])
    calendar_name = clean_text(calendar.get("x-wr-calname"))
    diagnostics = {
        "calendarName": calendar_name,
        "rawEvents": len(raw),
        "expandedOccurrences": len(components),
        "savedFutureEvents": len(events),
        "skippedPast": skipped_past,
        "skippedInvalid": skipped_invalid,
        "skippedCancelled": skipped_cancelled,
    }
    return events[:MAX_EVENTS], diagnostics


def main() -> int:
    ics_url = os.getenv("YANDEX_CALENDAR_ICS_URL", "").strip()
    if not ics_url:
        print("YANDEX_CALENDAR_ICS_URL is not configured; current meetings.json is unchanged.")
        return 0

    content = download_calendar(normalize_calendar_url(ics_url))
    now = datetime.now(DISPLAY_TZ)
    events, diagnostics = build_events(content, now)

    payload = {
        "updatedAt": now.isoformat(),
        "timezone": "Europe/Moscow",
        "events": events,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        "Calendar parsed: "
        f"name='{diagnostics['calendarName'] or 'not specified'}', "
        f"VEVENT={diagnostics['rawEvents']}, "
        f"occurrences={diagnostics['expandedOccurrences']}, "
        f"future={diagnostics['savedFutureEvents']}, "
        f"past={diagnostics['skippedPast']}, "
        f"invalid={diagnostics['skippedInvalid']}, "
        f"cancelled={diagnostics['skippedCancelled']}"
    )
    print(f"Saved {len(events)} upcoming events to data/meetings.json")
    if not events:
        print(
            "Warning: no future meetings were found. Check that the GitHub secret belongs "
            "to the same Yandex calendar in which the meetings were created."
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as exc:
        print(f"Calendar synchronization failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print(f"Calendar synchronization failed ({type(exc).__name__})", file=sys.stderr)
        raise SystemExit(1)
