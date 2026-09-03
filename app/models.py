"""SQLAlchemy ORM models mirroring the P0 migration (BUILD_PLAN.md §2).

The schema itself lives in the migration (raw SQL - see ADR-004 in
harness/memory/decisions.md); these models describe that already-created
schema for the application layer. All Postgres enum types are declared with
create_type=False since the migration owns their lifecycle.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import CHAR, ENUM as PGEnum, JSONB, TIMESTAMP, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


OperatingModelEnum = PGEnum(
    "factory", "subscription", "money_lending", "retail_stores", "services",
    name="operating_model", create_type=False,
)
ThesisStatusEnum = PGEnum(
    "on_track", "watch_closely", "broken", name="thesis_status", create_type=False,
)
VerdictSourceEnum = PGEnum(
    "manual", "rule_engine", "ai_proposed", name="verdict_source", create_type=False,
)
ThesisOutcomeEnum = PGEnum(
    "open", "played_out", "invalidated", "exited_early", "superseded",
    name="thesis_outcome", create_type=False,
)
MetricUnitEnum = PGEnum(
    "pct", "days", "ratio", "currency", "count", "currency_per_unit",
    name="metric_unit", create_type=False,
)
TriggerSeverityEnum = PGEnum("warn", "kill", name="trigger_severity", create_type=False)
ProposalStateEnum = PGEnum(
    "pending", "accepted", "rejected", "superseded", name="proposal_state", create_type=False,
)


class BroadIndustry(Base):
    __tablename__ = "broad_industries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    niches: Mapped[list["SpecificNiche"]] = relationship(back_populates="broad_industry")


class SpecificNiche(Base):
    __tablename__ = "specific_niches"
    __table_args__ = (UniqueConstraint("broad_industry_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    broad_industry_id: Mapped[int] = mapped_column(ForeignKey("broad_industries.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    broad_industry: Mapped["BroadIndustry"] = relationship(back_populates="niches")


class MetricDefinition(Base):
    __tablename__ = "metric_definitions"

    metric_key: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    operating_model: Mapped[Optional[str]] = mapped_column(OperatingModelEnum, nullable=True)
    unit: Mapped[str] = mapped_column(MetricUnitEnum, nullable=False)
    higher_is_better: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    decimals: Mapped[int] = mapped_column(SmallInteger, default=1)
    is_core: Mapped[bool] = mapped_column(Boolean, default=False)
    help_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=100)


class Company(Base):
    __tablename__ = "companies"

    company_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    broad_industry_id: Mapped[int] = mapped_column(ForeignKey("broad_industries.id"), nullable=False)
    specific_niche_id: Mapped[int] = mapped_column(ForeignKey("specific_niches.id"), nullable=False)
    operating_model: Mapped[str] = mapped_column(OperatingModelEnum, nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False, default="INR")
    status: Mapped[str] = mapped_column(ThesisStatusEnum, nullable=False, default="on_track")
    status_source: Mapped[str] = mapped_column(VerdictSourceEnum, nullable=False, default="manual")
    outcome: Mapped[str] = mapped_column(ThesisOutcomeEnum, nullable=False, default="open")
    conviction: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    entry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    exit_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_reviewed: Mapped[date] = mapped_column(Date, nullable=False)
    current_version_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("thesis_versions.version_id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("conviction BETWEEN 1 AND 5"),)

    versions: Mapped[list["ThesisVersion"]] = relationship(
        back_populates="company", foreign_keys="ThesisVersion.company_id"
    )


class ThesisVersion(Base):
    __tablename__ = "thesis_versions"
    __table_args__ = (UniqueConstraint("company_id", "version_no"),)

    version_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    thesis_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    authored_by: Mapped[str] = mapped_column(String(80), nullable=False)
    authored_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    # Generated in the DB (P0 migration); Computed(...) here is a marker only -
    # it tells the ORM to omit this column from INSERT/UPDATE, never to (re)issue
    # DDL for it (we never run create_all against tables the migration owns).
    search_tsv: Mapped[Optional[str]] = mapped_column(
        TSVECTOR, Computed("''", persisted=True), nullable=True
    )

    company: Mapped["Company"] = relationship(back_populates="versions", foreign_keys=[company_id])
    kill_triggers: Mapped[list["KillTrigger"]] = relationship(back_populates="version")


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (UniqueConstraint("company_id", "period", "metric_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    metric_key: Mapped[str] = mapped_column(ForeignKey("metric_definitions.metric_key"), nullable=False)
    numeric_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 4), nullable=True)
    text_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_type: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ingested_by: Mapped[str] = mapped_column(String(80), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class KillTrigger(Base):
    __tablename__ = "kill_triggers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("thesis_versions.version_id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(Text, nullable=False)
    metric_key: Mapped[Optional[str]] = mapped_column(ForeignKey("metric_definitions.metric_key"), nullable=True)
    operator: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    threshold: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 4), nullable=True)
    severity: Mapped[str] = mapped_column(TriggerSeverityEnum, nullable=False, default="kill")
    action: Mapped[str] = mapped_column(Text, nullable=False)
    grace_periods: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    manual_check: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    version: Mapped["ThesisVersion"] = relationship(back_populates="kill_triggers")


class TriggerEvaluation(Base):
    __tablename__ = "trigger_evaluations"
    __table_args__ = (UniqueConstraint("trigger_id", "period"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    trigger_id: Mapped[int] = mapped_column(
        ForeignKey("kill_triggers.id", ondelete="CASCADE"), nullable=False
    )
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    observed_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 4), nullable=True)
    breached: Mapped[bool] = mapped_column(Boolean, nullable=False)
    fired: Mapped[bool] = mapped_column(Boolean, nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class HealthCheck(Base):
    __tablename__ = "health_checks"
    __table_args__ = (UniqueConstraint("company_id", "period"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[int] = mapped_column(ForeignKey("thesis_versions.version_id"), nullable=False)
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    verdict: Mapped[str] = mapped_column(ThesisStatusEnum, nullable=False)
    source: Mapped[str] = mapped_column(VerdictSourceEnum, nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    reasoning_chain: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    evidence: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    human_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    model_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class StatusProposal(Base):
    __tablename__ = "status_proposals"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    period: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    proposed_status: Mapped[str] = mapped_column(ThesisStatusEnum, nullable=False)
    source: Mapped[str] = mapped_column(VerdictSourceEnum, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    state: Mapped[str] = mapped_column(ProposalStateEnum, nullable=False, default="pending")
    model_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    resolved_by: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


UserRoleEnum = PGEnum("read_write", "read_only", name="user_role", create_type=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(UserRoleEnum, nullable=False, default="read_write")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    last_login_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


class TrainingSplit(Base):
    __tablename__ = "training_splits"

    company_id: Mapped[str] = mapped_column(
        ForeignKey("companies.company_id", ondelete="CASCADE"), primary_key=True
    )
    split: Mapped[str] = mapped_column(String(10), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())


class GuidanceNote(Base):
    __tablename__ = "guidance_notes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    block_key: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    resolved_by: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    __table_args__ = (CheckConstraint("status IN ('open', 'resolved')"),)


class CustomTable(Base):
    __tablename__ = "custom_tables"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    columns: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    section: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())

    rows: Mapped[list["CustomTableRow"]] = relationship(back_populates="table", order_by="CustomTableRow.row_order")


class CustomTableRow(Base):
    __tablename__ = "custom_table_rows"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("custom_tables.id", ondelete="CASCADE"), nullable=False)
    row_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    row_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())

    table: Mapped["CustomTable"] = relationship(back_populates="rows")


class StatusEvent(Base):
    __tablename__ = "status_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    from_status: Mapped[Optional[str]] = mapped_column(ThesisStatusEnum, nullable=True)
    to_status: Mapped[str] = mapped_column(ThesisStatusEnum, nullable=False)
    source: Mapped[str] = mapped_column(VerdictSourceEnum, nullable=False)
    proposal_id: Mapped[Optional[int]] = mapped_column(ForeignKey("status_proposals.id"), nullable=True)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
