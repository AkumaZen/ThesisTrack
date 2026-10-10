from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlparse

from concall_downloader.models import Company, DocumentType

WINDOWS_FORBIDDEN = r'<>:"/\|?*'


def sanitize_component(value: str, max_length: int = 80) -> str:
    cleaned = "".join("_" if char in WINDOWS_FORBIDDEN else char for char in value)
    cleaned = re.sub(r"\s+", "_", cleaned.strip())
    cleaned = re.sub(r"_+", "_", cleaned)
    cleaned = cleaned.strip(" ._")
    if not cleaned:
        cleaned = "Unknown"
    return cleaned[:max_length].rstrip(" ._")


def filename_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    name = Path(path).name
    return sanitize_component(name, max_length=120) if name else "download"


def company_folder_name(company: Company) -> str:
    return f"{sanitize_component(company.bse_code)}_{sanitize_component(company.name)}"


def build_document_path(
    out_dir: Path,
    company: Company,
    document_type: DocumentType,
    fy: str,
    quarter: str,
    period_date: date,
    source: str,
    extension: str,
) -> Path:
    ext = extension if extension.startswith(".") else f".{extension}"
    folder = out_dir / company_folder_name(company) / sanitize_component(fy) / sanitize_component(quarter)
    filename = "_".join(
        [
            sanitize_component(document_type),
            sanitize_component(company.bse_code),
            sanitize_component(company.name),
            sanitize_component(fy),
            sanitize_component(quarter),
            period_date.isoformat(),
            sanitize_component(source),
        ]
    )
    return folder / f"{filename}{ext.lower()}"
