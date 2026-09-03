from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

BlockKey = Literal[
    "the_business",
    "the_growth_engine",
    "the_big_change",
    "proof_points",
    "what_can_kill_it",
    "why_we_believe_it",
    "health_check",
    "references",
    "general",
]

BLOCK_KEYS: list[str] = list(BlockKey.__args__)


class GuidanceNoteIn(BaseModel):
    block_key: BlockKey
    note: str = Field(min_length=1)


class GuidanceNoteOut(BaseModel):
    id: int
    company_id: str
    company_name: Optional[str] = None
    block_key: str
    note: str
    status: str
    created_by: str
    created_at: datetime
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
