"""Human verdicts and the override audit trail (BUILD_PLAN.md §5 rules 1-3;
per-user scenarios per ADR-026 - every status mutation here acts on one
scenario, not the whole company).

Precedence when sources disagree: human > rule engine > AI (§5 rule 3). A
fired kill-severity proposal (source=rule_engine, proposed_status='broken')
cannot be dismissed or overridden without a non-empty resolution note, and
every resolution - override or not - writes a status_events row.
"""
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.config import ANALYST_NAME
from app.models import Company, HealthCheck, StatusEvent, StatusProposal, ThesisScenario
from app.services.scenarios import ScenarioNotFoundError, get_my_scenario


class NotFoundError(Exception):
    pass


class AlreadyResolvedError(Exception):
    pass


class OverrideRequiresNoteError(Exception):
    pass


def _find_active_fired_kill(db: Session, scenario_id: int) -> Optional[StatusProposal]:
    from sqlalchemy import select

    return db.scalar(
        select(StatusProposal).where(
            StatusProposal.scenario_id == scenario_id,
            StatusProposal.source == "rule_engine",
            StatusProposal.proposed_status == "broken",
            StatusProposal.state == "pending",
        )
    )


def resolve_proposal(
    db: Session,
    proposal_id: int,
    action: str,
    verdict: Optional[str],
    note: Optional[str],
    actor: str = ANALYST_NAME,
) -> StatusProposal:
    proposal = db.get(StatusProposal, proposal_id)
    if proposal is None:
        raise NotFoundError(f"proposal {proposal_id} not found")
    if proposal.state != "pending":
        raise AlreadyResolvedError(f"proposal {proposal_id} is already {proposal.state}")

    scenario = db.get(ThesisScenario, proposal.scenario_id)
    is_fired_kill = proposal.source == "rule_engine" and proposal.proposed_status == "broken"

    if action == "accept":
        final_status = verdict or proposal.proposed_status
    elif action == "reject":
        final_status = scenario.status
    else:
        raise ValueError(f"action must be 'accept' or 'reject', got {action!r}")

    is_override = is_fired_kill and final_status != "broken"
    if is_override and not note:
        raise OverrideRequiresNoteError(
            "overriding a fired kill trigger requires a non-empty resolution_note"
        )

    from_status = scenario.status

    if action == "accept":
        # Only ai_proposed evidence carries a real reasoning_chain (BUILD_PLAN.md
        # §5's AI reviewer output); a rule-engine firing is arithmetic, not
        # reasoning, so it's left null here rather than synthesized - P6's
        # export eligibility filter (>= 3 reasoning steps) then naturally
        # excludes rows without one instead of exporting a fabricated chain.
        reasoning_chain = (proposal.evidence or {}).get("reasoning_chain") if proposal.source == "ai_proposed" else None
        db.add(
            HealthCheck(
                company_id=scenario.company_id,
                scenario_id=scenario.id,
                version_id=scenario.current_version_id,
                period=proposal.period,
                verdict=final_status,
                source="manual",
                note=note or proposal.rationale,
                reasoning_chain=reasoning_chain,
                evidence=proposal.evidence,
                human_confirmed=True,
                author=actor,
            )
        )
        scenario.status = final_status
        scenario.status_source = "manual"
        scenario.last_reviewed = date.today()

    proposal.state = "accepted" if action == "accept" else "rejected"
    proposal.resolved_by = actor
    proposal.resolution_note = note

    db.add(
        StatusEvent(
            company_id=scenario.company_id,
            scenario_id=scenario.id,
            from_status=from_status,
            to_status=final_status,
            source="manual",
            proposal_id=proposal.id,
            rationale=note or proposal.rationale,
            override=is_override,
            actor=actor,
        )
    )

    db.commit()
    db.refresh(proposal)
    return proposal


def submit_health_check(
    db: Session, company_id: str, period: str, verdict: str, note: str, actor: str = ANALYST_NAME
) -> HealthCheck:
    scenario = get_my_scenario(db, company_id, actor)

    active_kill = _find_active_fired_kill(db, scenario.id)
    is_override = active_kill is not None and verdict != "broken"
    if is_override and not note:
        raise OverrideRequiresNoteError(
            "overriding an active fired kill trigger requires a non-empty note"
        )

    from_status = scenario.status
    health = HealthCheck(
        company_id=company_id,
        scenario_id=scenario.id,
        version_id=scenario.current_version_id,
        period=period,
        verdict=verdict,
        source="manual",
        note=note,
        human_confirmed=True,
        author=actor,
    )
    db.add(health)
    scenario.status = verdict
    scenario.status_source = "manual"
    scenario.last_reviewed = date.today()

    db.add(
        StatusEvent(
            company_id=company_id,
            scenario_id=scenario.id,
            from_status=from_status,
            to_status=verdict,
            source="manual",
            proposal_id=None,
            rationale=note,
            override=is_override,
            actor=actor,
        )
    )
    db.commit()
    db.refresh(health)
    return health


def close_outcome(db: Session, company_id: str, outcome: str, note: str, actor: str = ANALYST_NAME) -> ThesisScenario:
    scenario = get_my_scenario(db, company_id, actor)

    scenario.outcome = outcome
    scenario.exit_date = date.today()

    # No dedicated column for a retrospective note (BUILD_PLAN.md §2) - recorded
    # as a status_events entry (status itself is unchanged by closing the outcome).
    db.add(
        StatusEvent(
            company_id=company_id,
            scenario_id=scenario.id,
            from_status=scenario.status,
            to_status=scenario.status,
            source="manual",
            proposal_id=None,
            rationale=f"outcome closed as '{outcome}': {note}",
            override=False,
            actor=actor,
        )
    )
    db.commit()
    db.refresh(scenario)
    return scenario
