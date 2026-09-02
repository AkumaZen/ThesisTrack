from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.observation import PERIOD_PATTERN


class ProposalOut(BaseModel):
    id: int
    company_id: str
    period: Optional[str] = None
    proposed_status: str
    source: str
    rationale: str
    evidence: Optional[dict[str, Any]] = None
    state: str
    model_name: Optional[str] = None
    created_at: datetime


class ProposalResolveIn(BaseModel):
    action: Literal["accept", "reject"]
    verdict: Optional[Literal["on_track", "watch_closely", "broken"]] = None
    note: Optional[str] = None


class HealthCheckIn(BaseModel):
    period: str = Field(pattern=PERIOD_PATTERN.pattern)
    verdict: Literal["on_track", "watch_closely", "broken"]
    note: str = Field(min_length=1)


class HealthCheckOut(BaseModel):
    id: int
    company_id: str
    period: str
    verdict: str
    source: str
    note: str
    human_confirmed: bool
    author: Optional[str] = None
    created_at: datetime


class OutcomeIn(BaseModel):
    outcome: Literal["played_out", "invalidated", "exited_early"]
    note: str = Field(min_length=1)
