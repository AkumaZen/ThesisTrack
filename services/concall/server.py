"""Hosted adapter for the existing Concall Downloader; persistent files/index are reused."""
from __future__ import annotations

import hmac
import ipaddress
import json
import os
from datetime import date, timedelta
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from pypdf import PdfReader

from concall_downloader.downloader import ConcallDownloader
from concall_downloader.models import CompanyHints, DocumentLink

app = FastAPI(title="ThesisTrack Concall Research", docs_url=None, redoc_url=None)
# One worker process with a persistent volume. The downloader rewrites index.jsonl, so serialize
# each company and preserve cached entries between selected-quarter runs.
_lock = Lock()


class DocumentLinkRequest(BaseModel):
    url: str = Field(max_length=2000)
    title: str = Field(default="", max_length=200)
    date: str = Field(default="", max_length=40)

    @field_validator("url")
    @classmethod
    def public_https(cls, value: str) -> str:
        parsed = urlparse(value)
        host = parsed.hostname or ""
        try:
            ipaddress.ip_address(host)
            is_ip = True
        except ValueError:
            is_ip = False
        if parsed.scheme != "https" or not host or is_ip or host == "localhost" or "." not in host:
            raise ValueError("Document links must be https URLs on a public host name")
        return value


class ResearchRequest(BaseModel):
    bseCode: str = Field(pattern=r"^\d{6}$")
    # Optional identity hints, used when BSE's API cannot be reached from the host.
    nseSymbol: str | None = Field(default=None, pattern=r"^[A-Z0-9&_-]{1,20}$")
    isin: str | None = Field(default=None, pattern=r"^IN[A-Z0-9]{10}$")
    documentLinks: list[DocumentLinkRequest] = Field(default_factory=list, max_length=40)
    quarters: list[date] = Field(min_length=1, max_length=12)
    refresh: bool = False

    @field_validator("quarters")
    @classmethod
    def reported_only(cls, values: list[date]) -> list[date]:
        if any(v > date.today() or (v.month, v.day) not in {(3, 31), (6, 30), (9, 30), (12, 31)} for v in values):
            raise ValueError("Select valid reported quarter-end dates")
        return sorted(set(values))


def cached_records(directory: Path) -> list[dict]:
    index = directory / "index.jsonl"
    if not index.exists():
        return []
    return [json.loads(line) for line in index.read_text(encoding="utf-8").splitlines() if line.strip()]


def research_documents(request: ResearchRequest) -> dict:
    directory = (Path(os.environ.get("CONCALL_DATA_DIR", "/data/downloads")) / request.bseCode).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    selected = {q.isoformat() for q in request.quarters}
    with _lock:
        records = cached_records(directory)
        covered = {r["period_end_date"] for r in records if r.get("document_type") in {"Transcript", "Presentation"} and Path(r.get("saved_path", "")).is_file()}
        warnings: list[str] = []
        failed_sources: list[str] = []
        retrieval_failed = False
        if request.refresh or not selected.issubset(covered):
            # Disclosures arrive after the reporting period; include up to 100 days after it.
            first = min(request.quarters) - timedelta(days=92)
            last = min(date.today(), max(request.quarters) + timedelta(days=100))
            hints = CompanyHints(
                nse_symbol=request.nseSymbol,
                isin=request.isin,
                document_links=tuple(DocumentLink(l.url, l.title, l.date) for l in request.documentLinks),
            )
            result = ConcallDownloader(directory).run([request.bseCode], start_date=first, end_date=last, hints=hints)
            warnings.extend(result.warnings)
            failed_sources = list(dict.fromkeys(result.failed_sources))
            retrieval_failed = bool(result.failed_companies)
            if retrieval_failed:
                warnings.append("Company document download failed; cached sources may be incomplete.")
            combined = {}
            for record in records + cached_records(directory):
                key = record.get("sha256") or record["saved_path"]
                previous = combined.get(key)
                # An existing PDF keeps its original source/period. Repair old filing-date
                # fallbacks only when the downloader now verifies the reporting period.
                if previous is None or (previous.get("quarter_basis") == "filing_date_fallback" and record.get("quarter_basis") == "detected_period"):
                    combined[key] = record
            records = list(combined.values())
            (directory / "index.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
        documents = []
        for record in records:
            if record.get("period_end_date") not in selected or record.get("document_type") not in {"Transcript", "Presentation", "AnnualReport", "ManagementUpdate", "Capex", "OrderWin", "AcquisitionMerger"}:
                continue
            path = Path(record["saved_path"]).resolve()
            if not path.is_relative_to(directory) or not path.is_file() or path.suffix.lower() != ".pdf":
                continue
            if not record.get("source_url", "").startswith("https://"):
                continue
            try:
                reader = PdfReader(path)
                if len(reader.pages) > 200:
                    warnings.append(f"{record['original_filename']}: more than 200 pages; document omitted, not truncated.")
                    continue
                pages = [{"page": i + 1, "text": p.extract_text() or ""} for i, p in enumerate(reader.pages)]
                if not any(p["text"].strip() for p in pages):
                    warnings.append(f"{record['original_filename']}: text extraction unavailable; OCR required.")
                    continue
                documents.append({"id": "doc-" + record["sha256"], "title": f"{record['company_name']} {record['fy']} {record['quarter']} {record['document_type']}", "url": record["source_url"], "pages": pages})
            except Exception:
                warnings.append(f"{record['original_filename']}: PDF could not be read.")
        return {"documents": documents, "warnings": warnings, "retrievalFailed": retrieval_failed, "failedSources": failed_sources}


@app.post("/research")
def research(request: ResearchRequest, authorization: str = Header(default="")):
    token = os.environ.get("CONCALL_SERVICE_TOKEN", "")
    if not token or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "Service authentication required")
    return research_documents(request)


@app.get("/health")
def health():
    return {"ok": True}
