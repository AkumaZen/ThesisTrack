from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel

from app.schemas.thesis import ThesisData


class ThesisAmend(BaseModel):
    thesis_data: ThesisData
    change_note: str


class CompanyOut(BaseModel):
    company_id: str
    name: str
    broad_industry: str
    specific_niche: str
    operating_model: str
    currency: str
    status: str
    status_source: str
    outcome: str
    conviction: Optional[int] = None
    last_reviewed: date
    current_version_id: Optional[int] = None


class CompanyListResponse(BaseModel):
    items: list[CompanyOut]
    total: int
    page: int
    page_size: int


class VersionSummary(BaseModel):
    version_id: int
    version_no: int
    change_note: Optional[str] = None
    authored_by: str
    authored_at: datetime


class VersionDetail(VersionSummary):
    thesis_data: dict[str, Any]


class CompanyDetail(CompanyOut):
    current_thesis: dict[str, Any]
    versions: list[VersionSummary]


class VersionDiffEntry(BaseModel):
    path: str
    old: Any = None
    new: Any = None


class VersionDiffResponse(BaseModel):
    from_version_no: int
    to_version_no: int
    changes: list[VersionDiffEntry]


class NicheProposeIn(BaseModel):
    broad_industry: str
    name: str


class NicheOut(BaseModel):
    id: int
    name: str
    is_active: bool
    company_count: int


class IndustryOut(BaseModel):
    id: int
    name: str
    company_count: int
    niches: list[NicheOut]


class MetricOut(BaseModel):
    metric_key: str
    label: str
    operating_model: Optional[str] = None
    unit: str
    higher_is_better: Optional[bool] = None
    is_core: bool
