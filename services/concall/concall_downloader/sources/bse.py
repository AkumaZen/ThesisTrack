from __future__ import annotations

from datetime import date
from html.parser import HTMLParser
import logging
import re
from typing import Any

from concall_downloader.dates import parse_date
from concall_downloader.http import HttpClient
from concall_downloader.models import CandidateDocument, Company
from concall_downloader.naming import filename_from_url

BSE_API = "https://api.bseindia.com/BseIndiaAPI/api"
BSE_ATTACH_HIS = "https://www.bseindia.com/xml-data/corpfiling/AttachHis"
BSE_ATTACH_LIVE = "https://www.bseindia.com/xml-data/corpfiling/AttachLive"
LOGGER = logging.getLogger("concall_downloader")


class BseSource:
    def __init__(self, http: HttpClient) -> None:
        self.http = http

    def resolve_company(self, bse_code: str) -> Company:
        lookup_company: Company | None = None
        try:
            lookup_company = self._resolve_company_from_lookup(bse_code)
        except Exception:
            pass

        try:
            listed_company = self._resolve_company_from_list_or_header(bse_code)
        except Exception:
            if lookup_company:
                return lookup_company
            raise
        if lookup_company:
            return Company(
                bse_code=bse_code,
                name=listed_company.name if listed_company.name != bse_code else lookup_company.name,
                security_id=lookup_company.security_id or listed_company.security_id,
                isin=lookup_company.isin or listed_company.isin,
            )
        return listed_company

    def _resolve_company_from_list_or_header(self, bse_code: str) -> Company:
        url = f"{BSE_API}/ListofScripData/w"
        params = {
            "scripcode": bse_code,
            "Group": "A",
            "industry": "",
            "segment": "Equity",
            "status": "Active",
        }
        row = {}
        try:
            payload = self.http.get_json(url, params=params)
            row = _first_row(payload) or {}
        except Exception:
            meta = self.http.get_json(
                f"{BSE_API}/ComHeadernew/w",
                params={"quotetype": "EQ", "scripcode": bse_code, "seriesid": ""},
            )
            row = _first_row(meta) or {}
        name = _field(row, "SLONGNAME", "Scrip_Name", "SCRIP_NAME", "SecurityName", "scripname")
        security_id = _field(row, "SCRIP_ID", "Scrip_Id", "securityId", "SecurityId", "ScripID")
        isin = _field(row, "ISIN", "ISIN_NO", "ISINNo", "isin")
        return Company(
            bse_code=bse_code,
            name=name or security_id or bse_code,
            security_id=security_id,
            isin=isin,
        )

    def _resolve_company_from_lookup(self, bse_code: str) -> Company | None:
        text = self.http.get_text(f"{BSE_API}/PeerSmartSearch/w", params={"Type": "SS", "text": bse_code})
        parser = _LookupParser()
        parser.feed(text.replace("\xa0", " "))
        for company in parser.companies:
            if company.bse_code == bse_code:
                return company
        return None

    def search_companies(self, query: str) -> list[Company]:
        text = self.http.get_text(f"{BSE_API}/PeerSmartSearch/w", params={"Type": "SS", "text": query})
        parser = _LookupParser()
        parser.feed(text.replace("\xa0", " "))
        deduped: list[Company] = []
        seen: set[str] = set()
        for company in parser.companies:
            if company.bse_code and company.bse_code not in seen:
                seen.add(company.bse_code)
                deduped.append(company)
        return deduped

    def fetch_announcements(
        self,
        company: Company,
        start_date: date,
        end_date: date,
    ) -> list[CandidateDocument]:
        documents: list[CandidateDocument] = []
        windows = _year_windows(start_date, end_date)
        for index, (window_start, window_end) in enumerate(windows, start=1):
            LOGGER.info(
                "%s: BSE window %s/%s %s to %s",
                company.bse_code,
                index,
                len(windows),
                window_start.isoformat(),
                window_end.isoformat(),
            )
            page = 1
            while True:
                rows = self._fetch_page(company.bse_code, window_start, window_end, page)
                LOGGER.info("%s: BSE page %s returned %s rows", company.bse_code, page, len(rows))
                if not rows:
                    break
                documents.extend(_candidate_from_row(company, row) for row in rows)
                if len(rows) < 50:
                    break
                page += 1
        return documents

    def _fetch_page(
        self,
        bse_code: str,
        start_date: date,
        end_date: date,
        page: int,
    ) -> list[dict[str, Any]]:
        params = {
            "pageno": page,
            "strCat": "-1",
            "strPrevDate": start_date.strftime("%Y%m%d"),
            "strscrip": bse_code,
            "strSearch": "P",
            "strToDate": end_date.strftime("%Y%m%d"),
            "strType": "C",
            "subcategory": "-1",
        }
        last_error: Exception | None = None
        for endpoint in ("AnnSubCategoryGetData/w", "AnnGetData/w"):
            try:
                payload = self.http.get_json(f"{BSE_API}/{endpoint}", params=params)
                return _rows(payload)
            except Exception as exc:
                last_error = exc
        if last_error:
            raise RuntimeError(f"BSE announcements failed for {bse_code}: {last_error}") from last_error
        return []


def _candidate_from_row(company: Company, row: dict[str, Any]) -> CandidateDocument:
    attachment = _field(row, "ATTACHMENTNAME", "attachmentname", "AttachmentName")
    source_url = _field(row, "NSURL", "NEWSURL", "URL", "url")
    alternate_urls: tuple[str, ...] = ()
    original_filename = ""
    if attachment:
        original_filename = attachment
        source_url = f"{BSE_ATTACH_HIS}/{attachment}"
        alternate_urls = (f"{BSE_ATTACH_LIVE}/{attachment}",)
    elif source_url:
        original_filename = filename_from_url(source_url)

    title = _field(row, "HEADLINE", "NEWSSUB", "NEWS_SUB", "SUBJECT", "title") or ""
    details = " ".join(
        value
        for value in [
            _field(row, "CATEGORYNAME", "CATEGORY", "cat"),
            _field(row, "SUBCATNAME", "SUBCATEGORY", "subcategory"),
            _field(row, "MORE", "DETAILS", "details"),
        ]
        if value
    )
    announcement_date = parse_date(_field(row, "DT_TM", "NEWS_DT", "DissemDT", "date"))
    period_end_date = parse_date(_field(row, "PERIOD_END_DATE", "PERIOD", "QUARTER_END_DATE"))
    return CandidateDocument(
        company=company,
        source="BSE",
        source_url=source_url or "",
        original_filename=original_filename,
        announcement_date=announcement_date,
        title=title,
        details=details,
        period_end_date=period_end_date,
        alternate_urls=alternate_urls,
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


def _rows(payload: object) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("Table", "Data", "data", "rows"):
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    return []


def _first_row(payload: object) -> dict[str, Any] | None:
    rows = _rows(payload)
    if rows:
        return rows[0]
    if isinstance(payload, dict):
        for key in ("Header", "header"):
            value = payload.get(key)
            if isinstance(value, dict):
                return value
        return payload
    return None


def _field(row: dict[str, Any], *names: str) -> str:
    lower_map = {key.lower(): value for key, value in row.items()}
    for name in names:
        value = lower_map.get(name.lower())
        if value is not None:
            return str(value).strip()
    return ""


class _LookupParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._inside_anchor = False
        self._data_parts: list[str] = []
        self._attr_company_name = ""
        self._attr_bse_code = ""

    @property
    def result(self) -> dict[str, str]:
        return self.results[0] if self.results else {}

    @property
    def companies(self) -> list[Company]:
        return [
            Company(
                bse_code=result.get("bse_code", ""),
                name=result.get("company_name") or result.get("bse_code", ""),
                security_id=result.get("symbol") or None,
                isin=result.get("isin") or None,
            )
            for result in self.results
            if result.get("bse_code")
        ]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._inside_anchor = True
            self._data_parts = []
            self._attr_company_name = ""
            self._attr_bse_code = ""
            for name, value in attrs:
                if not value or name != "ng-click":
                    continue
                match = re.search(r"liclick\('(?P<code>\d{6})','(?P<name>[^']+)'\)", value)
                if match:
                    self._attr_bse_code = match.group("code")
                    self._attr_company_name = match.group("name").strip()

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            result = _parse_lookup_anchor(
                self._data_parts,
                attr_company_name=self._attr_company_name,
                attr_bse_code=self._attr_bse_code,
            )
            if result.get("bse_code"):
                self.results.append(result)
            self._inside_anchor = False

    def handle_data(self, data: str) -> None:
        if not self._inside_anchor:
            return
        clean = " ".join(data.split())
        if not clean:
            return
        self._data_parts.append(clean)


def _parse_lookup_anchor(
    data_parts: list[str],
    attr_company_name: str = "",
    attr_bse_code: str = "",
) -> dict[str, str]:
    text = " ".join(data_parts)
    isin_match = re.search(r"\bIN[A-Z0-9]{10}\b", text, flags=re.I)
    isin = isin_match.group(0).upper() if isin_match else ""

    bse_code = attr_bse_code
    if not bse_code and isin_match:
        code_match = re.search(r"\b\d{6}\b", text[isin_match.end() :])
        bse_code = code_match.group(0) if code_match else ""
    if not bse_code:
        code_matches = re.findall(r"\b\d{6}\b", text)
        bse_code = code_matches[-1] if code_matches else ""

    symbol = ""
    if isin_match:
        before_isin = text[: isin_match.start()].strip()
        tokens = before_isin.split()
        if tokens:
            symbol = tokens[-1]

    company_name = attr_company_name
    if not company_name:
        company_name = _company_name_from_text(text, symbol, isin)

    return {
        "company_name": company_name,
        "symbol": symbol,
        "isin": isin,
        "bse_code": bse_code,
    }


def _company_name_from_text(text: str, symbol: str, isin: str) -> str:
    cutoff_text = text
    if isin and isin in cutoff_text:
        cutoff_text = cutoff_text.split(isin, 1)[0]
    if symbol:
        tokens = cutoff_text.split()
        if tokens and tokens[-1] == symbol:
            tokens = tokens[:-1]
        return " ".join(tokens).strip()
    return cutoff_text.strip()
