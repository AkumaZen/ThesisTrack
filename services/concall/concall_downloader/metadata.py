from __future__ import annotations

import csv
import json
from dataclasses import asdict
from pathlib import Path

from concall_downloader.models import StoredRecord

FIELDNAMES = [
    "bse_code",
    "company_name",
    "isin",
    "nse_symbol",
    "document_type",
    "fy",
    "quarter",
    "period_end_date",
    "quarter_basis",
    "source",
    "announcement_date",
    "source_url",
    "original_filename",
    "saved_path",
    "sha256",
    "duplicate_of",
    "status",
    "warning",
]


def write_metadata(out_dir: Path, records: list[StoredRecord]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "index.csv"
    jsonl_path = out_dir / "index.jsonl"

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        for record in records:
            writer.writerow(_serialise(record))

    with jsonl_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(_serialise(record), ensure_ascii=False) + "\n")


def _serialise(record: StoredRecord) -> dict[str, str]:
    raw = asdict(record)
    return {key: str(raw.get(key, "")) for key in FIELDNAMES}
