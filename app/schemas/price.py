from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class PriceObservationIn(BaseModel):
    observed_on: date
    price: float = Field(gt=0)


class PriceObservationOut(BaseModel):
    id: int
    company_id: str
    observed_on: date
    price: float
    source: str
    actor: str
    created_at: datetime


BaselineMode = Literal["thesis", "decision"]


class PerformanceOut(BaseModel):
    baseline_mode: BaselineMode
    baseline_date: Optional[date] = None
    baseline_price: Optional[float] = None
    current_date: Optional[date] = None
    current_price: Optional[float] = None
    pct_change: Optional[float] = None
    currency: str
    note: Optional[str] = None
