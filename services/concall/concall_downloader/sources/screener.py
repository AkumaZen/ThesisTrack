from __future__ import annotations

from datetime import date, datetime, timedelta

from concall_downloader.dates import parse_date
from concall_downloader.models import CandidateDocument, Company, DocumentLink
from concall_downloader.naming import filename_from_url


class ScreenerLinkSource:
    """Turns the transcript/presentation links Screener lists for a company into candidates.

    Screener labels each concall with the month it was held (for example "Jul 2026"). The call
    covers the last quarter that ended before that month, which is used as the reporting period.
    """

    def fetch_documents(
        self,
        company: Company,
        links: tuple[DocumentLink, ...],
        start_date: date,
        end_date: date,
    ) -> list[CandidateDocument]:
        documents: list[CandidateDocument] = []
        for link in links:
            held = _held_month(link.date)
            period_end = _quarter_end_before(held) if held else None
            if period_end and not (start_date <= period_end <= end_date):
                continue
            documents.append(
                CandidateDocument(
                    company=company,
                    source="Screener",
                    source_url=link.url,
                    original_filename=filename_from_url(link.url),
                    announcement_date=held,
                    title=" ".join(part for part in (link.date, link.title) if part),
                    period_end_date=period_end,
                )
            )
        return documents


def _held_month(label: str) -> date | None:
    text = (label or "").strip()
    if not text:
        return None
    for fmt in ("%b %Y", "%B %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return parse_date(text)


def _quarter_end_before(held: date) -> date:
    first_of_month = held.replace(day=1)
    month_start_of_quarter = ((first_of_month.month - 1) // 3) * 3 + 1
    return date(first_of_month.year, month_start_of_quarter, 1) - timedelta(days=1)
