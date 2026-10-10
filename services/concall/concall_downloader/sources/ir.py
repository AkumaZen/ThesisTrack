from __future__ import annotations

import re
from datetime import date
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from concall_downloader.classify import is_supported_download_url
from concall_downloader.dates import parse_date
from concall_downloader.http import HttpClient
from concall_downloader.models import CandidateDocument, Company
from concall_downloader.naming import filename_from_url

BLOCKED_DOMAINS = (
    "bseindia.com",
    "nseindia.com",
    "moneycontrol.com",
    "screener.in",
    "trendlyne.com",
    "tickertape.in",
    "marketscreener.com",
    "valueresearchonline.com",
)

IR_HINTS = (
    "investor",
    "investors",
    "ir",
    "financial-result",
    "financial_results",
    "quarterly-result",
    "quarterly_results",
    "presentation",
    "transcript",
)


class IrSource:
    def __init__(self, http: HttpClient) -> None:
        self.http = http

    def fetch_documents(self, company: Company, ir_urls: set[str]) -> list[CandidateDocument]:
        documents: list[CandidateDocument] = []
        for ir_url in sorted(ir_urls):
            try:
                html = self.http.get_text(ir_url)
            except Exception:
                continue
            documents.extend(_documents_from_html(company, ir_url, html))
        return documents


def discover_ir_urls(text: str) -> set[str]:
    urls = set(re.findall(r"https?://[^\s<>'\")]+", text or "", flags=re.I))
    return {url.rstrip(".,);]") for url in urls if _looks_like_official_ir_url(url)}


def _documents_from_html(company: Company, page_url: str, html: str) -> list[CandidateDocument]:
    soup = BeautifulSoup(html, "html.parser")
    documents: list[CandidateDocument] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor["href"]).strip()
        url = urljoin(page_url, href)
        if not is_supported_download_url(url):
            continue
        text = anchor.get_text(" ", strip=True)
        if not text and not any(hint in url.lower() for hint in IR_HINTS):
            continue
        documents.append(
            CandidateDocument(
                company=company,
                source="CompanyIR",
                source_url=url,
                original_filename=filename_from_url(url),
                announcement_date=_guess_date(text + " " + url),
                title=text,
                details=page_url,
            )
        )
    return documents


def _looks_like_official_ir_url(url: str) -> bool:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    if not parsed.scheme.startswith("http") or not domain:
        return False
    if any(blocked in domain for blocked in BLOCKED_DOMAINS):
        return False
    haystack = f"{domain} {parsed.path} {parsed.query}".lower()
    return any(hint in haystack for hint in IR_HINTS)


def _guess_date(text: str) -> date | None:
    if match := re.search(r"\d{4}-\d{2}-\d{2}", text):
        return parse_date(match.group(0))
    if match := re.search(r"\d{2}[/-]\d{2}[/-]\d{4}", text):
        return parse_date(match.group(0))
    return None
