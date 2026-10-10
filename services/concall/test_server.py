import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from server import app, ResearchRequest, research_documents
from concall_downloader.dates import extract_period_end_date
from concall_downloader.downloader import ConcallDownloader
from concall_downloader.http import DownloadError
from concall_downloader.models import CandidateDocument, Company


class DocumentServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_authentication_and_validation(self):
        with patch.dict(os.environ, {"CONCALL_SERVICE_TOKEN": "test-only-secret"}):
            self.assertEqual(self.client.post("/research", json={"bseCode": "999001", "quarters": ["2026-03-31"]}).status_code, 401)
            self.assertEqual(self.client.post("/research", headers={"Authorization": "Bearer wrong"}, json={"bseCode": "999001", "quarters": ["2026-03-31"]}).status_code, 401)
            for body in [{"bseCode": "../../etc", "quarters": ["2026-03-31"]}, {"bseCode": "999001", "quarters": ["2030-03-31"]}, {"bseCode": "999001", "quarters": ["2026-04-01"]}]:
                self.assertEqual(self.client.post("/research", headers={"Authorization": "Bearer test-only-secret"}, json=body).status_code, 422)

    def test_authenticated_request_uses_selected_quarters(self):
        with patch.dict(os.environ, {"CONCALL_SERVICE_TOKEN": "test-only-secret"}), patch("server.research_documents", return_value={"documents": [], "warnings": []}) as research:
            response = self.client.post("/research", headers={"Authorization": "Bearer test-only-secret"}, json={"bseCode": "999001", "quarters": ["2026-03-31", "2026-03-31"]})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(research.call_args.args[0].quarters), 1)

    def test_cache_reuse_preserves_page_citations_and_rejects_outside_paths(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"CONCALL_DATA_DIR": temp}):
            directory = Path(temp) / "999001"
            directory.mkdir()
            pdf = directory / "call.pdf"
            pdf.write_bytes(b"mock PDF")
            record = {"period_end_date": "2026-03-31", "document_type": "Transcript", "saved_path": str(pdf), "source_url": "https://example.com/company-call.pdf", "sha256": "abc", "company_name": "Mock company", "fy": "FY26", "quarter": "Q4", "original_filename": "call.pdf"}
            outside = Path(temp) / "outside.pdf"
            outside.write_bytes(b"not a company file")
            records = [record, {**record, "saved_path": str(outside), "sha256": "outside"}]
            (directory / "index.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
            page = SimpleNamespace(extract_text=lambda: "Management guides revenue growth of 30%.")
            with patch("server.ConcallDownloader") as downloader, patch("server.PdfReader", return_value=SimpleNamespace(pages=[page])):
                response = research_documents(ResearchRequest(bseCode="999001", quarters=["2026-03-31"]))
                downloader.assert_not_called()
                self.assertEqual(len(response["documents"]), 1)
                self.assertEqual(response["documents"][0]["pages"][0]["page"], 1)
                self.assertEqual(response["documents"][0]["url"], record["source_url"])

    def test_explicit_refresh_uses_downloader_and_keeps_cached_index(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"CONCALL_DATA_DIR": temp}):
            directory = Path(temp) / "999001"
            directory.mkdir()
            pdf = directory / "call.pdf"
            pdf.write_bytes(b"mock PDF")
            record = {"period_end_date": "2026-03-31", "document_type": "Transcript", "saved_path": str(pdf), "source_url": "https://example.com/call.pdf", "sha256": "abc", "company_name": "Mock", "fy": "FY26", "quarter": "Q4", "original_filename": "call.pdf"}
            (directory / "index.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
            with patch("server.ConcallDownloader") as downloader, patch("server.PdfReader", return_value=SimpleNamespace(pages=[])):
                downloader.return_value.run.return_value = SimpleNamespace(warnings=[], failed_companies=[])
                research_documents(ResearchRequest(bseCode="999001", quarters=["2026-03-31"], refresh=True))
                downloader.return_value.run.assert_called_once()
                self.assertIn("abc", (directory / "index.jsonl").read_text())

    def test_cached_presentation_does_not_require_another_download(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"CONCALL_DATA_DIR": temp}):
            directory = Path(temp) / "999001"
            directory.mkdir()
            pdf = directory / "presentation.pdf"
            pdf.write_bytes(b"mock PDF")
            record = {"period_end_date": "2026-06-30", "document_type": "Presentation", "saved_path": str(pdf), "source_url": "https://example.com/presentation.pdf", "sha256": "abc", "company_name": "Mock", "fy": "FY27", "quarter": "Q1", "original_filename": "presentation.pdf"}
            (directory / "index.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
            page = SimpleNamespace(extract_text=lambda: "Management guides capacity expansion.")
            with patch("server.ConcallDownloader") as downloader, patch("server.PdfReader", return_value=SimpleNamespace(pages=[page])):
                response = research_documents(ResearchRequest(bseCode="999001", quarters=["2026-06-30"]))
                downloader.assert_not_called()
                self.assertEqual(len(response["documents"]), 1)

    def test_refresh_preserves_verified_cached_period_and_source(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"CONCALL_DATA_DIR": temp}):
            directory = Path(temp) / "999001"
            directory.mkdir()
            pdf = directory / "call.pdf"
            pdf.write_bytes(b"mock PDF")
            original = {"period_end_date": "2026-06-30", "quarter_basis": "detected_period", "document_type": "Transcript", "saved_path": str(pdf), "source_url": "https://example.com/original-call.pdf", "sha256": "abc", "company_name": "Mock", "fy": "FY27", "quarter": "Q1", "original_filename": "call.pdf"}
            index = directory / "index.jsonl"
            index.write_text(json.dumps(original) + "\n", encoding="utf-8")
            incoming = {**original, "period_end_date": "2026-05-02", "quarter_basis": "filing_date_fallback", "source_url": "https://example.com/different-filing.pdf"}
            def download(*args, **kwargs):
                index.write_text(json.dumps(incoming) + "\n", encoding="utf-8")
                return SimpleNamespace(warnings=[], failed_companies=[])
            with patch("server.ConcallDownloader") as downloader, patch("server.PdfReader", return_value=SimpleNamespace(pages=[])):
                downloader.return_value.run.side_effect = download
                research_documents(ResearchRequest(bseCode="999001", quarters=["2026-06-30"], refresh=True))
            self.assertEqual(json.loads(index.read_text().strip()), original)

    def test_reporting_period_accepts_comma_in_quarter_label(self):
        self.assertEqual(extract_period_end_date("Copy of Transcripts of Q1, FY27 Earnings Conference call"), date(2026, 6, 30))

    def test_refresh_repairs_old_filing_date_with_verified_period(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"CONCALL_DATA_DIR": temp}):
            directory = Path(temp) / "999001"
            directory.mkdir()
            pdf = directory / "call.pdf"
            pdf.write_bytes(b"mock PDF")
            old = {"period_end_date": "2026-05-02", "quarter_basis": "filing_date_fallback", "document_type": "Transcript", "saved_path": str(pdf), "source_url": "https://example.com/wrong-filing.pdf", "sha256": "abc", "company_name": "Mock", "fy": "FY27", "quarter": "Q1", "original_filename": "call.pdf"}
            index = directory / "index.jsonl"
            index.write_text(json.dumps(old) + "\n", encoding="utf-8")
            verified = {**old, "period_end_date": "2026-06-30", "quarter_basis": "detected_period", "source_url": "https://example.com/verified-call.pdf"}
            def download(*args, **kwargs):
                index.write_text(json.dumps(verified) + "\n", encoding="utf-8")
                return SimpleNamespace(warnings=[], failed_companies=[])
            page = SimpleNamespace(extract_text=lambda: "Verified selected-quarter guidance.")
            with patch("server.ConcallDownloader") as downloader, patch("server.PdfReader", return_value=SimpleNamespace(pages=[page])):
                downloader.return_value.run.side_effect = download
                response = research_documents(ResearchRequest(bseCode="999001", quarters=["2026-06-30"], refresh=True))
            self.assertEqual(json.loads(index.read_text().strip()), verified)
            self.assertEqual(response["documents"][0]["url"], verified["source_url"])

    def test_filing_date_does_not_identify_an_existing_quarter_document(self):
        with tempfile.TemporaryDirectory() as temp, patch("concall_downloader.downloader._find_existing_document", return_value=Path(temp) / "q1-call.pdf") as find:
            http = SimpleNamespace(download=Mock(side_effect=DownloadError("Unavailable")))
            downloader = ConcallDownloader(Path(temp), http=http)
            candidate = CandidateDocument(company=Company(bse_code="999001", name="Mock"), source="BSE", source_url="https://example.com/filing.pdf", original_filename="filing.pdf", announcement_date=date(2026, 5, 2), title="Earnings conference call transcript")
            record = downloader._process_candidate(candidate)
            find.assert_not_called()
            http.download.assert_called_once()
            self.assertEqual(record.status, "failed")


if __name__ == "__main__":
    unittest.main()
