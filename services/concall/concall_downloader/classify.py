from __future__ import annotations

from pathlib import PurePosixPath
from urllib.parse import urlparse

from concall_downloader.models import DocumentType

TRANSCRIPT_KEYWORDS = (
    "transcript",
    "earnings call transcript",
    "conference call transcript",
    "concall transcript",
    "call transcript",
)

PRESENTATION_KEYWORDS = (
    "investor presentation",
    "earnings presentation",
    "earning presentation",
    "result presentation",
    "results presentation",
    "conference call presentation",
    "analyst meet presentation",
    "presentation on financial results",
)

QUARTERLY_RESULTS_KEYWORDS = (
    "unaudited financial results",
    "audited financial results",
    "statement of standalone financial results",
    "statement of consolidated financial results",
    "statement of standalone and consolidated financial results",
    "financial results for the quarter",
    "financial results for the year",
    "results for the quarter and year ended",
    "results for the quarter ended",
)

ANNUAL_REPORT_KEYWORDS = (
    "annual report",
    "integrated annual report",
)

BOARD_MEETING_OUTCOME_KEYWORDS = (
    "outcome of board meeting",
    "outcome of the board meeting",
    "board meeting outcome",
    "outcome of meeting of board of directors",
    "outcome of the meeting of board of directors",
)

AGM_NOTICE_KEYWORDS = (
    "annual general meeting",
    "notice of agm",
    "agm proceedings",
)

# BSE's own regulatory sub-category name for order/contract wins - the most
# reliable signal, since it appears verbatim in CATEGORYNAME/SUBCATNAME.
ORDER_WIN_KEYWORDS = (
    "award of order",
    "receipt of order",
    "letter of award",
    "work order",
    "purchase order",
    "order worth",
    "contract worth",
    "secures order",
    "bags order",
    "wins order",
    "awarded contract",
    "awarded the contract",
    "loa awarded",
)

CAPEX_KEYWORDS = (
    "capital expenditure",
    "capex",
    "expansion of capacity",
    "capacity expansion",
    "new manufacturing facility",
    "setting up of new plant",
    "greenfield project",
    "brownfield expansion",
    "commissioning of new",
)

ACQUISITION_MERGER_KEYWORDS = (
    "amalgamation",
    "merger",
    "demerger",
    "acquisition of business",
    "acquisition of undertaking",
    "acquisition of the company",
    "agreement to acquire",
    "share purchase agreement",
    "business transfer agreement",
    "slump sale",
    "stake purchase",
    "joint venture agreement",
    "jv agreement",
)

# SEBI SAST (Substantial Acquisition of Shares and Takeovers) shareholding
# threshold disclosures use the phrase "acquisition of shares" routinely for
# ordinary market purchases by any investor crossing 5%/10%/etc - this is not
# the company itself acquiring a business, so it must not classify as
# AcquisitionMerger even though "acquisition" appears.
SAST_DISCLOSURE_KEYWORDS = (
    "substantial acquisition of shares",
    "sast regulations",
    "regulation 29",
    "regulation 7(1)",
    "regulation 7(2)",
    "regulation 7 (1)",
    "regulation 7 (2)",
)

MANAGEMENT_UPDATE_KEYWORDS = (
    "change in directorate",
    "change in management",
    "change in key managerial personnel",
    "resignation of",
    "appointment of",
    "cessation of",
)

PROBE_KEYWORDS = (
    "analyst",
    "concall",
    "conference call",
    "earnings call",
    "investor",
    "quarter",
    "result",
    "annual report",
    "board meeting",
    "annual general meeting",
    "agm",
    "order",
    "contract",
    "capex",
    "capital expenditure",
    "expansion",
    "acquisition",
    "merger",
    "amalgamation",
    "joint venture",
    "director",
    "management",
)

SKIP_KEYWORDS = (
    "audio recording",
    "audio call",
    "call recording",
    "recording link",
    "video recording",
)

DOWNLOAD_EXTENSIONS = {".pdf", ".ppt", ".pptx"}


def classify_document(*parts: str, allow_business_events: bool = True) -> DocumentType | None:
    """Classify a candidate document from its title/details/filename/URL text.

    allow_business_events: gate for the four "business event" types (OrderWin,
    Capex, AcquisitionMerger, ManagementUpdate). These rely on generic business
    vocabulary ("order", "capex", "acquisition", "director") that is common in
    third-party content (e.g. broker research notes archived on a company's own
    investor-relations page) and unreliable outside an exchange's own official
    disclosure feed. Callers should pass False for candidates sourced from
    CompanyIR, where content isn't exchange-verified.
    """
    text = " ".join(part for part in parts if part).lower()
    if not text:
        return None
    if any(keyword in text for keyword in SKIP_KEYWORDS) and "transcript" not in text:
        return None
    if any(keyword in text for keyword in TRANSCRIPT_KEYWORDS):
        return "Transcript"
    if any(keyword in text for keyword in PRESENTATION_KEYWORDS):
        return "Presentation"
    if any(keyword in text for keyword in QUARTERLY_RESULTS_KEYWORDS):
        return "QuarterlyResults"
    if any(keyword in text for keyword in ANNUAL_REPORT_KEYWORDS):
        return "AnnualReport"
    if any(keyword in text for keyword in BOARD_MEETING_OUTCOME_KEYWORDS):
        return "BoardMeetingOutcome"
    if any(keyword in text for keyword in AGM_NOTICE_KEYWORDS):
        return "AGMNotice"
    if not allow_business_events:
        return None
    if any(keyword in text for keyword in ORDER_WIN_KEYWORDS):
        return "OrderWin"
    if any(keyword in text for keyword in CAPEX_KEYWORDS):
        return "Capex"
    is_sast_disclosure = any(keyword in text for keyword in SAST_DISCLOSURE_KEYWORDS)
    if not is_sast_disclosure and any(keyword in text for keyword in ACQUISITION_MERGER_KEYWORDS):
        return "AcquisitionMerger"
    if any(keyword in text for keyword in MANAGEMENT_UPDATE_KEYWORDS):
        return "ManagementUpdate"
    return None


def should_probe_document(*parts: str) -> bool:
    text = " ".join(part for part in parts if part).lower()
    if any(keyword in text for keyword in SKIP_KEYWORDS):
        return False
    return any(keyword in text for keyword in PROBE_KEYWORDS)


def is_supported_download_url(url: str) -> bool:
    path = PurePosixPath(urlparse(url).path.lower())
    return path.suffix in DOWNLOAD_EXTENSIONS


def extension_from_url(url: str) -> str:
    suffix = PurePosixPath(urlparse(url).path).suffix.lower()
    return suffix if suffix in DOWNLOAD_EXTENSIONS else ""
