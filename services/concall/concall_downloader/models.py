from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Literal

DocumentType = Literal[
    "Transcript",
    "Presentation",
    "QuarterlyResults",
    "AnnualReport",
    "BoardMeetingOutcome",
    "AGMNotice",
    "OrderWin",
    "Capex",
    "AcquisitionMerger",
    "ManagementUpdate",
]


@dataclass(frozen=True)
class Company:
    bse_code: str
    name: str
    security_id: str | None = None
    isin: str | None = None
    nse_symbol: str | None = None


@dataclass(frozen=True)
class CandidateDocument:
    company: Company
    source: str
    source_url: str
    original_filename: str
    announcement_date: date | None = None
    title: str = ""
    details: str = ""
    period_end_date: date | None = None
    alternate_urls: tuple[str, ...] = ()
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def text_hint(self) -> str:
        return " ".join(
            value
            for value in [
                self.title,
                self.details,
                self.original_filename,
                self.source_url,
            ]
            if value
        )


@dataclass(frozen=True)
class DownloadedFile:
    content: bytes
    final_url: str
    original_filename: str
    extension: str
    content_type: str


@dataclass(frozen=True)
class StoredRecord:
    bse_code: str
    company_name: str
    isin: str
    nse_symbol: str
    document_type: str
    fy: str
    quarter: str
    period_end_date: str
    quarter_basis: str
    source: str
    announcement_date: str
    source_url: str
    original_filename: str
    saved_path: Path | str
    sha256: str
    duplicate_of: Path | str
    status: str
    warning: str = ""


@dataclass
class RunSummary:
    records: list[StoredRecord] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    failed_companies: list[str] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        return 1 if self.failed_companies else 0
