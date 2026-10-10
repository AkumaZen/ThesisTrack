from __future__ import annotations

from datetime import date
import logging
from pathlib import Path

from concall_downloader.classify import classify_document, should_probe_document
from concall_downloader.dates import resolve_period
from concall_downloader.dedupe import Deduper, sha256_bytes
from concall_downloader.http import DownloadError, HttpClient
from concall_downloader.metadata import write_metadata
from concall_downloader.models import CandidateDocument, Company, RunSummary, StoredRecord
from concall_downloader.naming import build_document_path, company_folder_name, sanitize_component
from concall_downloader.pdf_text import extract_pdf_text
from concall_downloader.sources.bse import BseSource
from concall_downloader.sources.ir import IrSource, discover_ir_urls
from concall_downloader.sources.nse import NseSource

DEFAULT_START_DATE = date(2000, 1, 1)
LOGGER = logging.getLogger("concall_downloader")


class ConcallDownloader:
    def __init__(self, out_dir: Path, http: HttpClient | None = None) -> None:
        self.out_dir = out_dir
        self.http = http or HttpClient()
        self.bse = BseSource(self.http)
        self.nse = NseSource(self.http)
        self.ir = IrSource(self.http)
        self.deduper = Deduper()

    def run(
        self,
        bse_codes: list[str],
        start_date: date = DEFAULT_START_DATE,
        end_date: date | None = None,
    ) -> RunSummary:
        summary = RunSummary()
        effective_end = end_date or date.today()
        LOGGER.info(
            "Starting download for %s companies from %s to %s",
            len(bse_codes),
            start_date.isoformat(),
            effective_end.isoformat(),
        )
        for index, bse_code in enumerate(bse_codes, start=1):
            _log_progress(index - 1, len(bse_codes), f"starting company {bse_code}")
            try:
                company_summary = self._process_company(bse_code, start_date, effective_end)
            except Exception as exc:
                LOGGER.error("%s: unexpected crash, skipping company: %s", bse_code, exc)
                company_summary = RunSummary(
                    warnings=[f"{bse_code}: unexpected crash: {exc}"],
                    failed_companies=[bse_code],
                )
            summary.records.extend(company_summary.records)
            summary.warnings.extend(company_summary.warnings)
            summary.failed_companies.extend(company_summary.failed_companies)
            _log_progress(index, len(bse_codes), f"finished company {bse_code}")

        LOGGER.info("Writing metadata index files under %s", self.out_dir)
        write_metadata(self.out_dir, summary.records)
        return summary

    def _process_company(self, bse_code: str, start_date: date, end_date: date) -> RunSummary:
        summary = RunSummary()
        source_failures = 0
        source_attempts = 0
        ir_urls: set[str] = set()

        try:
            LOGGER.info("%s: resolving BSE company identity", bse_code)
            company = self.bse.resolve_company(bse_code)
            LOGGER.info(
                "%s: resolved as %s, security_id=%s, isin=%s",
                bse_code,
                company.name,
                company.security_id or "",
                company.isin or "",
            )
        except Exception as exc:
            company = Company(bse_code=bse_code, name=bse_code)
            _warn(summary, f"{bse_code}: BSE company resolution failed: {exc}")

        try:
            LOGGER.info("%s: validating NSE symbol from BSE identity", bse_code)
            nse_symbol = self.nse.validate_symbol(company)
            company = Company(
                bse_code=company.bse_code,
                name=company.name,
                security_id=company.security_id,
                isin=company.isin,
                nse_symbol=nse_symbol,
            )
            if company.security_id and company.isin and not nse_symbol:
                _warn(
                    summary,
                    f"{bse_code}: NSE symbol {company.security_id} was not validated against ISIN; skipped NSE."
                )
            elif nse_symbol:
                LOGGER.info("%s: NSE symbol validated as %s", bse_code, nse_symbol)
        except Exception as exc:
            _warn(summary, f"{bse_code}: NSE validation failed: {exc}")

        candidates: list[CandidateDocument] = []
        source_fetches = [
            ("BSE", lambda: self.bse.fetch_announcements(company, start_date, end_date)),
        ]
        if company.nse_symbol:
            source_fetches.append(("NSE", lambda: self.nse.fetch_announcements(company, start_date, end_date)))

        for source_name, fetch in source_fetches:
            source_attempts += 1
            try:
                LOGGER.info("%s: fetching %s candidate filings", bse_code, source_name)
                fetched = fetch()
                candidates.extend(fetched)
                LOGGER.info("%s: %s returned %s candidate filings", bse_code, source_name, len(fetched))
            except Exception as exc:
                source_failures += 1
                _warn(summary, f"{bse_code}: {source_name} source failed: {exc}")

        seen_urls: set[str] = set()
        LOGGER.info("%s: checking %s unique candidate filings", bse_code, len(candidates))
        for index, candidate in enumerate(candidates, start=1):
            if not candidate.source_url or candidate.source_url in seen_urls:
                continue
            seen_urls.add(candidate.source_url)
            _log_progress(index, len(candidates), f"{bse_code}: checking candidate documents")
            try:
                record = self._process_candidate(candidate)
            except Exception as exc:
                _warn(summary, f"{bse_code}: candidate from {candidate.source} crashed: {exc}")
                continue
            if record:
                summary.records.append(record)
                LOGGER.info(
                    "%s: %s %s from %s -> %s",
                    bse_code,
                    record.status,
                    record.document_type,
                    candidate.source,
                    record.saved_path or record.warning,
                )
                if record.status == "downloaded":
                    ir_urls.update(discover_ir_urls(candidate.text_hint))
                    if Path(str(record.saved_path)).suffix.lower() == ".pdf":
                        try:
                            content = Path(record.saved_path).read_bytes()
                        except OSError:
                            content = b""
                        ir_urls.update(discover_ir_urls(extract_pdf_text(content)))

        if ir_urls:
            source_attempts += 1
            try:
                LOGGER.info("%s: fetching company IR pages discovered from filings: %s", bse_code, len(ir_urls))
                for candidate in self.ir.fetch_documents(company, ir_urls):
                    if candidate.source_url in seen_urls:
                        continue
                    seen_urls.add(candidate.source_url)
                    try:
                        record = self._process_candidate(candidate)
                    except Exception as exc:
                        _warn(summary, f"{bse_code}: CompanyIR candidate crashed: {exc}")
                        continue
                    if record:
                        summary.records.append(record)
                        LOGGER.info(
                            "%s: %s %s from CompanyIR -> %s",
                            bse_code,
                            record.status,
                            record.document_type,
                            record.saved_path or record.warning,
                        )
            except Exception as exc:
                source_failures += 1
                _warn(summary, f"{bse_code}: Company IR source failed: {exc}")

        if source_attempts and source_failures == source_attempts:
            summary.failed_companies.append(bse_code)
        return summary

    def _process_candidate(self, candidate: CandidateDocument) -> StoredRecord | None:
        # Business-event types (orders, capex, M&A, management changes) are
        # only trusted from exchange-verified sources (BSE/NSE), not the
        # CompanyIR crawler, which can surface unverified third-party content
        # (e.g. broker research notes archived on a company's own IR page).
        allow_business_events = candidate.source != "CompanyIR"
        document_type = classify_document(candidate.text_hint, allow_business_events=allow_business_events)
        should_probe = should_probe_document(candidate.text_hint)
        if not document_type and not should_probe:
            return None

        pre_download_period = None
        if document_type:
            pre_download_period = resolve_period(
                [candidate.text_hint],
                candidate.announcement_date,
                candidate.period_end_date,
            )
            if pre_download_period and pre_download_period.basis == "detected_period":
                existing_path = _find_existing_document(
                    self.out_dir,
                    candidate.company,
                    document_type,
                    pre_download_period.fy,
                    pre_download_period.quarter,
                )
                if existing_path:
                    LOGGER.info(
                        "%s: skipping %s for %s %s; already exists at %s",
                        candidate.company.bse_code,
                        document_type,
                        pre_download_period.fy,
                        pre_download_period.quarter,
                        existing_path,
                    )
                    return _record(
                        candidate=candidate,
                        document_type=document_type,
                        fy=pre_download_period.fy,
                        quarter=pre_download_period.quarter,
                        period_end_date=pre_download_period.period_end_date.isoformat(),
                        quarter_basis=pre_download_period.basis,
                        saved_path=existing_path,
                        digest=_hash_existing_file(existing_path),
                        duplicate_of="",
                        status="skipped_existing",
                        warning="Already downloaded for this company, FY, quarter, and document type.",
                    )

        try:
            LOGGER.info(
                "%s: downloading %s candidate from %s",
                candidate.company.bse_code,
                document_type or "possible transcript/presentation",
                candidate.source,
            )
            downloaded = self.http.download([candidate.source_url, *candidate.alternate_urls])
        except DownloadError as exc:
            if document_type:
                return _failed_record(candidate, document_type, str(exc))
            return None

        pdf_text = ""
        if downloaded.extension == ".pdf":
            pdf_text = extract_pdf_text(downloaded.content)

        document_type = document_type or classify_document(
            candidate.text_hint, pdf_text, allow_business_events=allow_business_events
        )
        if not document_type:
            LOGGER.info("%s: downloaded file did not classify as transcript/presentation", candidate.company.bse_code)
            return None

        period = resolve_period(
            [candidate.text_hint, pdf_text],
            candidate.announcement_date,
            candidate.period_end_date,
        )
        if not period:
            return _failed_record(candidate, document_type, "Could not detect period and no filing date exists.")

        existing_path = _find_existing_document(
            self.out_dir,
            candidate.company,
            document_type,
            period.fy,
            period.quarter,
        )
        if existing_path:
            LOGGER.info(
                "%s: skipped saved copy for %s %s %s; already exists at %s",
                candidate.company.bse_code,
                document_type,
                period.fy,
                period.quarter,
                existing_path,
            )
            return _record(
                candidate=candidate,
                document_type=document_type,
                fy=period.fy,
                quarter=period.quarter,
                period_end_date=period.period_end_date.isoformat(),
                quarter_basis=period.basis,
                saved_path=existing_path,
                digest=_hash_existing_file(existing_path),
                duplicate_of="",
                status="skipped_existing",
                warning="Already downloaded for this company, FY, quarter, and document type.",
            )

        digest = sha256_bytes(downloaded.content)
        duplicate_of = self.deduper.existing_path(digest)
        target_path = duplicate_of or build_document_path(
            self.out_dir,
            candidate.company,
            document_type,
            period.fy,
            period.quarter,
            period.period_end_date,
            candidate.source,
            downloaded.extension,
        )

        status = "duplicate" if duplicate_of else "downloaded"
        if duplicate_of is None:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(downloaded.content)
            self.deduper.remember(digest, target_path)

        warning = period.warning
        if status == "duplicate":
            warning = "Duplicate content; kept first downloaded copy."

        return _record(
            candidate=candidate,
            document_type=document_type,
            fy=period.fy,
            quarter=period.quarter,
            period_end_date=period.period_end_date.isoformat(),
            quarter_basis=period.basis,
            saved_path=target_path,
            digest=digest,
            duplicate_of=duplicate_of or "",
            status=status,
            warning=warning,
        )


def _warn(summary: RunSummary, message: str) -> None:
    summary.warnings.append(message)
    LOGGER.warning("WARNING: %s", message)


def _log_progress(current: int, total: int, message: str) -> None:
    if total <= 0:
        LOGGER.info("[----------]   0%% %s", message)
        return
    ratio = min(max(current / total, 0), 1)
    filled = int(ratio * 10)
    bar = "#" * filled + "-" * (10 - filled)
    LOGGER.info("[%s] %3d%% %s", bar, round(ratio * 100), message)


def _find_existing_document(
    out_dir: Path,
    company: Company,
    document_type: str,
    fy: str,
    quarter: str,
) -> Path | None:
    company_prefix = sanitize_component(company.bse_code)
    exact_folder = out_dir / company_folder_name(company)
    company_folders = [exact_folder]
    if out_dir.exists():
        company_folders.extend(
            folder
            for folder in out_dir.glob(f"{company_prefix}_*")
            if folder.is_dir() and folder != exact_folder
        )

    document_prefix = f"{sanitize_component(document_type)}_"
    for company_folder in company_folders:
        quarter_folder = company_folder / sanitize_component(fy) / sanitize_component(quarter)
        if not quarter_folder.is_dir():
            continue
        for path in sorted(quarter_folder.iterdir()):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".pdf", ".ppt", ".pptx"}:
                continue
            if path.name.startswith(document_prefix):
                return path
    return None


def _hash_existing_file(path: Path) -> str:
    try:
        return sha256_bytes(path.read_bytes())
    except OSError:
        return ""


def _record(
    candidate: CandidateDocument,
    document_type: str,
    fy: str,
    quarter: str,
    period_end_date: str,
    quarter_basis: str,
    saved_path: Path | str,
    digest: str,
    duplicate_of: Path | str,
    status: str,
    warning: str,
) -> StoredRecord:
    company = candidate.company
    return StoredRecord(
        bse_code=company.bse_code,
        company_name=company.name,
        isin=company.isin or "",
        nse_symbol=company.nse_symbol or "",
        document_type=document_type,
        fy=fy,
        quarter=quarter,
        period_end_date=period_end_date,
        quarter_basis=quarter_basis,
        source=candidate.source,
        announcement_date=candidate.announcement_date.isoformat() if candidate.announcement_date else "",
        source_url=candidate.source_url,
        original_filename=candidate.original_filename,
        saved_path=saved_path,
        sha256=digest,
        duplicate_of=duplicate_of,
        status=status,
        warning=warning,
    )


def _failed_record(candidate: CandidateDocument, document_type: str, warning: str) -> StoredRecord:
    return _record(
        candidate=candidate,
        document_type=document_type,
        fy="",
        quarter="",
        period_end_date="",
        quarter_basis="",
        saved_path="",
        digest="",
        duplicate_of="",
        status="failed",
        warning=warning,
    )
