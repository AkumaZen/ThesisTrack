"""Deterministic kill-trigger evaluation (BUILD_PLAN.md §5 [1], §11).

Runs synchronously on every observation ingest (see ADR-006 - this used to be
deferred; P2 implements the hook). A missing observation is a data gap, not a
breach - it must never fire a trigger.

Grace-period continuity is tracked per kill_triggers.id, i.e. per thesis
version: amending the thesis creates new trigger rows with fresh ids, so a
streak does not carry across a redline's threshold changing mid-stream. This
is a judgment call not spelled out in BUILD_PLAN.md - logged as ADR-008.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Company, KillTrigger, Observation, StatusProposal, TriggerEvaluation

_OPERATORS = {
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


class NotFoundError(Exception):
    pass


def _consecutive_breach_streak(db: Session, trigger: KillTrigger, company_id: str, current_breached: bool) -> int:
    if not current_breached:
        return 0
    prior = db.execute(
        select(TriggerEvaluation, Observation.period_end)
        .join(
            Observation,
            (Observation.company_id == company_id)
            & (Observation.period == TriggerEvaluation.period)
            & (Observation.metric_key == trigger.metric_key),
        )
        .where(TriggerEvaluation.trigger_id == trigger.id)
        .order_by(Observation.period_end.desc())
    ).all()

    streak = 1
    for evaluation, _period_end in prior:
        if evaluation.breached:
            streak += 1
        else:
            break
    return streak


def _existing_pending_trigger_ids(db: Session, company_id: str, period: str) -> set[int]:
    rows = db.scalars(
        select(StatusProposal).where(
            StatusProposal.company_id == company_id,
            StatusProposal.period == period,
            StatusProposal.source == "rule_engine",
            StatusProposal.state == "pending",
        )
    ).all()
    ids = set()
    for row in rows:
        trigger_id = (row.evidence or {}).get("trigger_id")
        if trigger_id is not None:
            ids.add(trigger_id)
    return ids


def evaluate_observations(db: Session, company_id: str, period: str) -> list[StatusProposal]:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError(f"company '{company_id}' not found")
    if company.current_version_id is None:
        return []

    triggers = db.scalars(
        select(KillTrigger).where(
            KillTrigger.version_id == company.current_version_id,
            KillTrigger.manual_check.is_(False),
        )
    ).all()
    if not triggers:
        return []

    already_pending = _existing_pending_trigger_ids(db, company_id, period)
    new_proposals: list[StatusProposal] = []

    for trigger in triggers:
        obs = db.scalar(
            select(Observation).where(
                Observation.company_id == company_id,
                Observation.period == period,
                Observation.metric_key == trigger.metric_key,
            )
        )
        if obs is None or obs.numeric_value is None:
            continue  # data gap, not a breach - surfaces in the review queue (P3), not here

        observed = float(obs.numeric_value)
        threshold = float(trigger.threshold)
        breached = _OPERATORS[trigger.operator](observed, threshold)

        streak = _consecutive_breach_streak(db, trigger, company_id, breached)
        fired = breached and streak >= trigger.grace_periods

        stmt = (
            pg_insert(TriggerEvaluation)
            .values(
                trigger_id=trigger.id,
                period=period,
                observed_value=obs.numeric_value,
                breached=breached,
                fired=fired,
            )
            .on_conflict_do_update(
                index_elements=["trigger_id", "period"],
                set_={"observed_value": obs.numeric_value, "breached": breached, "fired": fired},
            )
        )
        db.execute(stmt)

        if fired and trigger.id not in already_pending:
            proposed_status = "broken" if trigger.severity == "kill" else "watch_closely"
            proposal = StatusProposal(
                company_id=company_id,
                period=period,
                proposed_status=proposed_status,
                source="rule_engine",
                rationale=(
                    f"Kill trigger '{trigger.label}' fired: {trigger.metric_key} observed={observed} "
                    f"{trigger.operator} threshold={threshold}, {streak} consecutive period(s) "
                    f"(grace_periods={trigger.grace_periods}) ending {period}."
                ),
                evidence={
                    "trigger_id": trigger.id,
                    "metric_key": trigger.metric_key,
                    "observed_value": observed,
                    "operator": trigger.operator,
                    "threshold": threshold,
                    "consecutive_periods": streak,
                    "grace_periods": trigger.grace_periods,
                },
                state="pending",
            )
            db.add(proposal)
            new_proposals.append(proposal)

    db.commit()
    for p in new_proposals:
        db.refresh(p)
    return new_proposals
