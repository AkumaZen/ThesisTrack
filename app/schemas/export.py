from typing import Any, Literal, Optional

from pydantic import BaseModel


class ExportStatsResponse(BaseModel):
    row_count: int
    row_count_by_task: dict[str, int]
    class_balance: dict[str, dict[str, int]]
    by_operating_model: dict[str, dict[str, int]]
    leakage_violations: int
    companies_by_split: dict[str, int]


ExportTask = Literal["thesis_synthesis", "verdict", "redline_extraction"]
ExportFormat = Literal["anthropic", "openai", "llama"]
ExportSplit = Literal["train", "eval", "all"]
