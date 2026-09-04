from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel

from app.schemas.custom_tables import CustomTableOut
from app.schemas.decision import DecisionOut
from app.schemas.price import PerformanceOut
from app.schemas.proposal import HealthCheckOut, ProposalOut
from app.schemas.thesis import ThesisData


class CompanyPanelOut(BaseModel):
    """Tables + decisions + performance in one response, replacing 3
    separate drawer-open requests that each paid their own connection-setup
    cost on the serverless deploy."""

    tables: list[CustomTableOut]
    decisions: list[DecisionOut]
    performance: PerformanceOut


class ThesisAmend(BaseModel):
    thesis_data: ThesisData
    change_note: str


class ScenarioSummary(BaseModel):
    """One user's thesis on a company, at a glance - used for the "N theses
    on this company" list/switcher (ADR-026)."""

    id: int
    owner: str
    label: str
    status: str
    last_reviewed: date


class CompanyOut(BaseModel):
    company_id: str
    name: str
    broad_industry: str
    specific_niche: str
    operating_model: str
    currency: str
    # Per-user scenarios (ADR-026): these reflect the CALLING user's own
    # thesis on this company, not "the" company status - there is no
    # longer a single shared status. None/has_own_scenario=False means the
    # caller hasn't started a thesis here yet.
    status: Optional[str] = None
    status_source: Optional[str] = None
    outcome: Optional[str] = None
    conviction: Optional[int] = None
    last_reviewed: Optional[date] = None
    current_version_id: Optional[int] = None
    scenario_id: Optional[int] = None
    has_own_scenario: bool = False
    scenario_count: int = 0
    has_active_override: bool = False
    core_metrics: dict[str, float] = {}


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


class ObservationOut(BaseModel):
    period: str
    period_end: date
    metric_key: str
    numeric_value: Optional[float] = None
    text_value: Optional[str] = None
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    note: Optional[str] = None


class KillTriggerOut(BaseModel):
    id: int
    label: str
    metric_key: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    unit: Optional[str] = None
    severity: str
    action: str
    grace_periods: int
    manual_check: bool
    latest_observed_value: Optional[float] = None
    latest_breached: Optional[bool] = None
    latest_fired: Optional[bool] = None


class ActiveOverrideOut(BaseModel):
    to_status: str
    rationale: str
    actor: str
    created_at: datetime


class CompanyDetail(CompanyOut):
    current_thesis: dict[str, Any] = {}
    versions: list[VersionSummary] = []
    observations: list[ObservationOut] = []
    health_checks: list[HealthCheckOut] = []
    pending_proposals: list[ProposalOut] = []
    kill_triggers: list[KillTriggerOut] = []
    active_override: Optional[ActiveOverrideOut] = None
    other_scenarios: list[ScenarioSummary] = []


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
