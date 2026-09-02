import re
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, model_validator

PERIOD_PATTERN = re.compile(r"^FY\d{2}Q[1-4]$|^FY\d{2}$")


class ObservationIn(BaseModel):
    metric_key: str
    numeric_value: Optional[float] = None
    text_value: Optional[str] = None
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    note: Optional[str] = None

    @model_validator(mode="after")
    def _has_a_value(self) -> "ObservationIn":
        if self.numeric_value is None and self.text_value is None:
            raise ValueError(f"observation for '{self.metric_key}' needs numeric_value or text_value")
        return self


class ObservationBulkIn(BaseModel):
    period: str = Field(pattern=PERIOD_PATTERN.pattern)
    period_end: date
    observations: list[ObservationIn] = Field(min_length=1)
