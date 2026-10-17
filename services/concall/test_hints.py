"""Document retrieval when BSE's API is blocked (HTTP 403 from cloud hosts) but NSE and Screener work."""
import tempfile
import unittest
from datetime import date
from pathlib import Path

import requests
from pydantic import ValidationError

from concall_downloader.downloader import ConcallDownloader
from concall_downloader.http import DownloadError
from concall_downloader.models import CompanyHints, DocumentLink, DownloadedFile
from server import ResearchRequest

ISIN = "INE548A01028"
NSE_ROW = {
    "attchmntFile": "https://nsearchives.nseindia.com/corporate/HFCL_20072026_transcript.pdf",
    "desc": "Transcript of the Q4 FY26 earnings conference call",
    "an_dt": "2026-07-20 10:00:00",
}


def forbidden() -> requests.HTTPError:
    response = requests.Response()
    response.status_code = 403
    return requests.HTTPError("403 Client Error: Forbidden for url: https://api.bseindia.com/x", response=response)


class FakeHttp:
    """BSE API always 403; NSE works unless `nse_down`; downloads succeed unless the URL is in `bad_urls`."""

    def __init__(self, nse_down: bool = False, nse_isin: str = ISIN, bad_urls: set[str] | None = None) -> None:
        self.nse_down = nse_down
        self.nse_isin = nse_isin
        self.bad_urls = bad_urls or set()
        self.downloaded: list[str] = []

    def get_json(self, url, **kwargs):
        if "bseindia.com" in url:
            raise forbidden()
        if self.nse_down:
            raise requests.ConnectionError("down")
        if "corporate-announcements" in url:
            return [NSE_ROW]
        return {"info": {"isin": self.nse_isin}}

    def get_text(self, url, **kwargs):
        if "bseindia.com" in url:
            raise forbidden()
        if self.nse_down:
            raise requests.ConnectionError("down")
        return ""

    def download(self, urls):
        url = urls[0]
        if url in self.bad_urls:
            raise DownloadError("unavailable")
        self.downloaded.append(url)
        return DownloadedFile(b"%PDF-1.4 fake " + url.encode(), url, "doc.pdf", ".pdf", "application/pdf")


SCREENER_LINKS = (
    DocumentLink("https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=aaa.pdf", "Concall Transcript", "Jul 2026"),
    DocumentLink("https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=bbb.pdf", "Investor Presentation", "Jul 2026"),
    DocumentLink("https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=old.pdf", "Concall Transcript", "Jan 2024"),
)


class BseBlockedTests(unittest.TestCase):
    def run_company(self, http, hints):
        with tempfile.TemporaryDirectory() as temp:
            return ConcallDownloader(Path(temp), http=http).run(["500183"], date(2026, 3, 30), date(2026, 10, 1), hints=hints)

    def test_nse_and_screener_links_still_find_documents_when_bse_returns_403(self):
        http = FakeHttp()
        summary = self.run_company(http, CompanyHints(nse_symbol="HFCL", document_links=SCREENER_LINKS))
        sources = {r.source for r in summary.records if r.status == "downloaded"}
        self.assertEqual(sources, {"Screener", "NSE"})
        screener = [r for r in summary.records if r.source == "Screener" and r.status == "downloaded"]
        self.assertEqual({(r.document_type, r.period_end_date) for r in screener}, {("Transcript", "2026-06-30"), ("Presentation", "2026-06-30")})
        self.assertNotIn("old.pdf", " ".join(http.downloaded))
        self.assertEqual(summary.failed_companies, [])
        self.assertEqual(summary.failed_sources, ["BSE returned HTTP 403"])
        self.assertTrue(any("BSE company lookup unavailable: returned HTTP 403" in w for w in summary.warnings))
        self.assertFalse(any("api.bseindia.com" in w for w in summary.warnings))

    def test_nse_symbol_is_used_without_isin_and_rejected_when_isin_differs(self):
        summary = self.run_company(FakeHttp(), CompanyHints(nse_symbol="HFCL"))
        self.assertEqual({r.source for r in summary.records}, {"NSE"})
        self.assertEqual(summary.records[0].isin, ISIN)
        mismatch = self.run_company(FakeHttp(nse_isin="INE000000000"), CompanyHints(nse_symbol="HFCL", isin=ISIN))
        self.assertEqual(mismatch.records, [])
        self.assertTrue(any("did not match ISIN" in w for w in mismatch.warnings))

    def test_every_source_failing_marks_the_company_failed_with_readable_reasons(self):
        summary = self.run_company(FakeHttp(nse_down=True), CompanyHints(nse_symbol="HFCL"))
        self.assertEqual(summary.records, [])
        self.assertEqual(summary.failed_companies, ["500183"])
        self.assertEqual(summary.failed_sources, ["BSE returned HTTP 403"])

    def test_without_hints_bse_403_alone_is_a_failure(self):
        summary = self.run_company(FakeHttp(), None)
        self.assertEqual(summary.failed_companies, ["500183"])
        self.assertEqual(summary.failed_sources, ["BSE returned HTTP 403"])


class RequestValidationTests(unittest.TestCase):
    def test_hints_are_validated(self):
        base = {"bseCode": "500183", "quarters": ["2026-06-30"]}
        ok = ResearchRequest(**base, nseSymbol="HFCL", isin=ISIN, documentLinks=[{"url": "https://www.bseindia.com/a.pdf", "title": "T", "date": "Jul 2026"}])
        self.assertEqual(ok.documentLinks[0].date, "Jul 2026")
        for bad in [{"nseSymbol": "hf cl"}, {"isin": "XX123"}, {"documentLinks": [{"url": "http://example.com/a.pdf"}]},
                    {"documentLinks": [{"url": "https://127.0.0.1/a.pdf"}]}, {"documentLinks": [{"url": "https://localhost/a.pdf"}]},
                    {"documentLinks": [{"url": f"https://example.com/{i}.pdf"} for i in range(41)]}]:
            with self.assertRaises(ValidationError):
                ResearchRequest(**base, **bad)


if __name__ == "__main__":
    unittest.main()
