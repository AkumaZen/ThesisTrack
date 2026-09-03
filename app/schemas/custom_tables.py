from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

ColumnType = Literal["text", "number", "date", "enum"]


class CustomTableColumn(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,49}$")
    label: str = Field(min_length=1, max_length=120)
    type: ColumnType = "text"
    options: Optional[list[str]] = None  # only meaningful for type == "enum"

    @model_validator(mode="after")
    def _options_only_for_enum(self):
        if self.options and self.type != "enum":
            raise ValueError("options is only valid for a column with type='enum'")
        if self.type == "enum" and not self.options:
            raise ValueError("an 'enum' column needs at least one option")
        return self


class CustomTableCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    columns: list[CustomTableColumn] = Field(default_factory=list)


class CustomTableUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    columns: Optional[list[CustomTableColumn]] = None


class CustomTableRowIn(BaseModel):
    row_data: dict[str, Any] = Field(default_factory=dict)


class CustomTableRowOut(BaseModel):
    id: int
    table_id: int
    row_data: dict[str, Any]
    row_order: int
    created_by: str
    created_at: datetime
    updated_at: datetime


class CustomTableOut(BaseModel):
    id: int
    company_id: str
    name: str
    columns: list[CustomTableColumn]
    created_by: str
    created_at: datetime
    updated_at: datetime
    row_count: int = 0


class CustomTableDetail(CustomTableOut):
    rows: list[CustomTableRowOut] = Field(default_factory=list)
