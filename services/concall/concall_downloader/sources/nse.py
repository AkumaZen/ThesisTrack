from __future__ import annotations

from datetime import date
from typing import Any

from concall_downloader.dates import parse_date
from concall_downloader.http import HttpClient
from concall_downloader.models import CandidateDocument, Company
from concall_downloader.naming import filename_from_url

NSE_HOME = "https://www.nseindia.com"
NSE_FILINGS_PAGE = f"{NSE_HOME}/companies-listing/corporate-filings-announcements"
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/118.0",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.nseindia.com/get-quotes/equity?symbol=HDFCBANK",
}
NSE_PAGE_HEADERS = {
    **NSE_HEADERS,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


class NseSource:
    def __init__(self, http: HttpClient) -> None:
        self.http = http
        self._bootstrapped = False

    def validate_symbol(self, company: Company) -> str | None:
        if not company.security_id or not company.isin:
            return None
        self._bootstrap()
        symbol = company.security_id.upper()
        errors: list[str] = []
        for endpoint in ("equity-meta-info", "quote-equity"):
            try:
                payload = self.http.get_json(
                    f"{NSE_HOME}/api/{endpoint}",
                    params={"symbol": symbol},
                    headers=NSE_HEADERS,
                )
                if isinstance(payload, dict):
                    nse_isin = _extract_isin(payload)
                    if nse_isin and nse_isin == company.isin.upper():
                        return symbol
                    if nse_isin:
                        return None
            except Exception as exc:
                errors.append(str(exc))

        try:
            html = self.http.get_text(
                f"{NSE_HOME}/get-quotes/equity",
                params={"symbol": symbol},
                headers=NSE_PAGE_HEADERS,
            )
            if company.isin.upper() in html.upper():
                return symbol
            return None
        except Exception as exc:
            errors.append(str(exc))

        if errors:
            raise RuntimeError("; ".join(errors))
        return None

    def fetch_announcements(
        self,
        company: Company,
        start_date: date,
        end_date: date,
    ) -> list[CandidateDocument]:
        if not company.nse_symbol:
            return []
        self._bootstrap()
        documents: list[CandidateDocument] = []
        for window_start, window_end in _year_windows(start_date, end_date):
            payload = self.http.get_json(
                f"{NSE_HOME}/api/corporate-announcements",
                params={
                    "index": "equities",
                    "symbol": company.nse_symbol,
                    "from_date": window_start.strftime("%d-%m-%Y"),
                    "to_date": window_end.strftime("%d-%m-%Y"),
                },
                headers=NSE_HEADERS,
            )
            rows = payload if isinstance(payload, list) else []
            documents.extend(_candidate_from_row(company, row) for row in rows if isinstance(row, dict))
        return documents

    def _bootstrap(self) -> None:
        if self._bootstrapped:
            return
        self.http.get_text(f"{NSE_HOME}/option-chain", headers=NSE_PAGE_HEADERS)
        self._bootstrapped = True


def _candidate_from_row(company: Company, row: dict[str, Any]) -> CandidateDocument:
    source_url = _field(row, "attchmntFile", "attachmentFile", "url")
    title = _field(row, "desc", "subject", "sm_name", "title")
    details = " ".join(
        value
        for value in [
            _field(row, "attchmntText", "details"),
            _field(row, "sm_name", "companyName"),
        ]
        if value
    )
    announcement_date = parse_date(_field(row, "an_dt", "date", "disseminationDate"))
    return CandidateDocument(
        company=company,
        source="NSE",
        source_url=source_url,
        original_filename=filename_from_url(source_url) if source_url else "",
        announcement_date=announcement_date,
        title=title,
        details=details,
        raw=row,
    )


def _year_windows(start_date: date, end_date: date) -> list[tuple[date, date]]:
    windows: list[tuple[date, date]] = []
    year = start_date.year
    while year <= end_date.year:
        current_start = max(start_date, date(year, 1, 1))
        current_end = min(end_date, date(year, 12, 31))
        windows.append((current_start, current_end))
        year += 1
    return windows


def _field(row: dict[str, Any], *names: str) -> str:
    lower_map = {key.lower(): value for key, value in row.items()}
    for name in names:
        value = lower_map.get(name.lower())
        if value is not None:
            return str(value).strip()
    return ""


def _extract_isin(payload: dict[str, Any]) -> str:
    for key in ("isin", "isinCode", "isinNo", "ISIN"):
        value = payload.get(key)
        if value:
            return str(value).strip().upper()
    info = payload.get("info")
    if isinstance(info, dict):
        return _extract_isin(info)
    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        return _extract_isin(metadata)
    return ""
