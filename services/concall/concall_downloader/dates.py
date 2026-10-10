from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

DATE_FORMATS = (
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d-%B-%Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%d %b, %Y",
    "%d %B, %Y",
    "%d.%m.%Y",
)

MONTH_NAMES = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)


@dataclass(frozen=True)
class PeriodResult:
    period_end_date: date
    fy: str
    quarter: str
    basis: str
    warning: str = ""


def parse_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None

    text = re.sub(r"\s+", " ", text.replace(",", ", ")).strip()
    text = re.sub(r"\s*,\s*", ", ", text)
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass

    if match := re.search(r"\d{4}-\d{2}-\d{2}", text):
        return parse_date(match.group(0))
    if match := re.search(r"\d{2}[/-]\d{2}[/-]\d{4}", text):
        return parse_date(match.group(0))
    return None


def financial_year_and_quarter(value: date) -> tuple[str, str]:
    if 4 <= value.month <= 6:
        start_year = value.year
        quarter = "Q1"
    elif 7 <= value.month <= 9:
        start_year = value.year
        quarter = "Q2"
    elif 10 <= value.month <= 12:
        start_year = value.year
        quarter = "Q3"
    else:
        start_year = value.year - 1
        quarter = "Q4"

    return f"FY{start_year}-{str(start_year + 1)[-2:]}", quarter


def extract_period_end_date(text: str) -> date | None:
    clean = re.sub(r"\s+", " ", text or "")
    if not clean:
        return None

    date_pattern = (
        r"(\d{1,2}(?:st|nd|rd|th)?[\s.-]+(?:"
        + "|".join(MONTH_NAMES)
        + r")[\s,.-]+\d{4}|(?:"
        + "|".join(MONTH_NAMES)
        + r")\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4})"
    )
    period_patterns = [
        rf"(?:quarter|period|three months|six months|nine months|year)\s+ended\s+{date_pattern}",
        rf"ended\s+{date_pattern}",
        rf"for\s+the\s+quarter\s+and\s+year\s+ended\s+{date_pattern}",
    ]
    for pattern in period_patterns:
        match = re.search(pattern, clean, flags=re.IGNORECASE)
        if match:
            raw_date = re.sub(r"(\d)(st|nd|rd|th)", r"\1", match.group(1), flags=re.I)
            parsed = parse_date(raw_date)
            if parsed:
                return parsed

    if match := re.search(r"\bQ([1-4])[\s,]*(?:FY|F\.?Y\.?)\s*'?(\d{2,4})\b", clean, re.I):
        quarter = f"Q{match.group(1)}"
        fy_end_year = _normalise_fy_end_year(match.group(2))
        return _quarter_end_date(fy_end_year, quarter)

    if match := re.search(r"\bH2\s*(?:&|and)?\s*(?:FY|F\.?Y\.?)\s*'?(\d{2,4})(?:-(\d{2}))?\b", clean, re.I):
        fy_end_year = _normalise_fy_end_year(match.group(2) or match.group(1))
        return date(fy_end_year, 3, 31)

    return None


def resolve_period(
    texts: list[str],
    filing_date: date | None,
    explicit_period_end: date | None = None,
) -> PeriodResult | None:
    if explicit_period_end:
        fy, quarter = financial_year_and_quarter(explicit_period_end)
        return PeriodResult(explicit_period_end, fy, quarter, "detected_period")

    combined = " ".join(text for text in texts if text)
    detected = extract_period_end_date(combined)
    if detected:
        fy, quarter = financial_year_and_quarter(detected)
        return PeriodResult(detected, fy, quarter, "detected_period")

    if filing_date:
        fy, quarter = financial_year_and_quarter(filing_date)
        return PeriodResult(
            filing_date,
            fy,
            quarter,
            "filing_date_fallback",
            "Period not detected; used filing date.",
        )

    return None


def _normalise_fy_end_year(value: str) -> int:
    year = int(value)
    if year < 100:
        return 2000 + year
    return year


def _quarter_end_date(fy_end_year: int, quarter: str) -> date:
    fy_start_year = fy_end_year - 1
    quarter_ends = {
        "Q1": date(fy_start_year, 6, 30),
        "Q2": date(fy_start_year, 9, 30),
        "Q3": date(fy_start_year, 12, 31),
        "Q4": date(fy_end_year, 3, 31),
    }
    return quarter_ends[quarter]
