from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class DecisionIn(BaseModel):
    action: Literal["buy", "sell"]
    price: float = Field(gt=0)
    quantity: Optional[float] = Field(default=None, gt=0)
    decided_on: date
    rationale: str = Field(min_length=1)


class DecisionOut(BaseModel):
    id: int
    company_id: str
    version_id: Optional[int]
    action: str
    price: float
    quantity: Optional[float]
    decided_on: date
    rationale: str
    actor: str
    created_at: datetime
