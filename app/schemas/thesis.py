"""Pydantic contract for the 7-pillar investment thesis (BUILD_PLAN.md §4).

Adapted from the original spec's JSON contract with the three additions
BUILD_PLAN.md calls for: classification.currency, structured fields inside
what_can_kill_it[], and outcome. See harness/memory/decisions.md for the
adaptation notes (human-readable enum strings, metric-key re-keying) made
against the user-supplied Balu Forge sample.
"""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator, ValidationInfo

OPERATING_MODELS = {"factory", "subscription", "money_lending", "retail_stores", "services"}
THESIS_STATUSES = {"on_track", "watch_closely", "broken"}


def _normalize_enum(value: str) -> str:
    return value.strip().lower().replace(" ", "_").replace("-", "_")


def _strip_markdown_link(value: str) -> str:
    import re

    match = re.match(r"^\[.*?\]\((.*?)\)$", value.strip())
    return match.group(1) if match else value.strip()


class RevenueSplitItem(BaseModel):
    segment: str
    share_pct: float = Field(ge=0, le=100)


class TheBusiness(BaseModel):
    what_it_does: str
    revenue_split: list[RevenueSplitItem]

    @model_validator(mode="after")
    def _split_sums_to_100(self) -> "TheBusiness":
        total = sum(item.share_pct for item in self.revenue_split)
        if abs(total - 100) > 0.5:
            raise ValueError(f"revenue_split.share_pct sums to {total}, expected 100 ± 0.5")
        return self


class TheBigChange(BaseModel):
    summary: str
    expected_completion: str


class ProofPoints(BaseModel):
    hard_evidence: list[str] = Field(default_factory=list)
    model_specific_metrics: dict[str, float] = Field(default_factory=dict)


class KillTrigger(BaseModel):
    label: str
    metric_key: Optional[str] = None
    operator: Optional[Literal["<", "<=", ">", ">=", "==", "!="]] = None
    threshold: Optional[float] = None
    unit: Optional[str] = None
    action: str
    severity: Literal["warn", "kill"] = "kill"
    grace_periods: int = Field(default=1, ge=1)
    manual_check: bool = False

    @model_validator(mode="after")
    def _quantifiable_unless_manual(self) -> "KillTrigger":
        if not self.manual_check:
            if self.metric_key is None or self.operator is None or self.threshold is None:
                raise ValueError(
                    "kill trigger must set manual_check=true, or provide "
                    "metric_key, operator, and threshold"
                )
        return self


class HealthCheckHistoryItem(BaseModel):
    quarter: str
    verdict: str
    note: str


class HealthCheckPillar(BaseModel):
    latest_quarter_review: str
    historical_checks: list[HealthCheckHistoryItem] = Field(default_factory=list)


class ReferenceItem(BaseModel):
    title: str
    url: str

    @field_validator("url", mode="before")
    @classmethod
    def _strip_and_validate_url(cls, value: str) -> str:
        cleaned = _strip_markdown_link(value)
        parsed = urlparse(cleaned)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(f"references[].url is not a valid absolute URL: {value!r}")
        return cleaned


class ThesisData(BaseModel):
    the_business: TheBusiness
    the_growth_engine: list[str] = Field(default_factory=list)
    the_big_change: TheBigChange
    proof_points: ProofPoints
    what_can_kill_it: list[KillTrigger]
    why_we_believe_it: list[str]
    health_check: HealthCheckPillar
    references: list[ReferenceItem] = Field(default_factory=list)

    @model_validator(mode="after")
    def _at_least_one_kill_severity(self) -> "ThesisData":
        if not any(t.severity == "kill" for t in self.what_can_kill_it):
            raise ValueError("what_can_kill_it must contain at least one entry with severity='kill'")
        return self

    @model_validator(mode="after")
    def _why_we_believe_it_shape(self) -> "ThesisData":
        entries = self.why_we_believe_it
        if len(entries) < 3:
            raise ValueError(f"why_we_believe_it needs >= 3 entries, got {len(entries)}")
        premises = [e for e in entries if e.strip().lower().startswith("premise")]
        conclusions = [e for e in entries if e.strip().lower().startswith("conclusion")]
        if len(premises) < 1:
            raise ValueError("why_we_believe_it must contain at least one entry starting with 'Premise'")
        if len(conclusions) != 1:
            raise ValueError(
                f"why_we_believe_it must contain exactly one 'Conclusion' entry, found {len(conclusions)}"
            )
        return self

    @model_validator(mode="after")
    def _metric_keys_in_registry(self, info: ValidationInfo) -> "ThesisData":
        context = info.context or {}
        registry = context.get("metric_registry")
        operating_model = context.get("operating_model")
        if registry is None:
            return self  # registry not supplied — caller (service layer / test) opted out

        used_keys: list[str] = list(self.proof_points.model_specific_metrics.keys())
        used_keys += [t.metric_key for t in self.what_can_kill_it if t.metric_key]

        for key in used_keys:
            if key not in registry:
                raise ValueError(f"unknown metric_key '{key}': not present in metric_definitions")
            key_model = registry[key]  # None means universal
            if key_model is not None and key_model != operating_model:
                raise ValueError(
                    f"metric_key '{key}' belongs to operating_model '{key_model}', "
                    f"not this company's '{operating_model}'"
                )
        return self


class Classification(BaseModel):
    broad_industry: str
    specific_niche: str
    operating_model: str
    currency: str = Field(default="INR", pattern=r"^[A-Z]{3}$")

    @field_validator("operating_model", mode="before")
    @classmethod
    def _normalize_operating_model(cls, value: str) -> str:
        normalized = _normalize_enum(value)
        if normalized not in OPERATING_MODELS:
            raise ValueError(f"unknown operating_model '{value}'; expected one of {sorted(OPERATING_MODELS)}")
        return normalized


class ThesisCreate(BaseModel):
    company_id: str = Field(pattern=r"^[A-Z0-9_]{2,50}$")
    name: str
    classification: Classification
    status: str = "on_track"
    last_reviewed: date
    thesis_data: ThesisData

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: str) -> str:
        normalized = _normalize_enum(value)
        if normalized not in THESIS_STATUSES:
            raise ValueError(f"unknown status '{value}'; expected one of {sorted(THESIS_STATUSES)}")
        return normalized
