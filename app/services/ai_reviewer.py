"""AI reviewer (BUILD_PLAN.md §5 [2], constitution rule 3): advisory only.

Writes a status_proposals row (source='ai_proposed') and NEVER touches
companies.status - that would let an unreviewed model verdict become the
ground truth this platform later fine-tunes on (BUILD_PLAN.md §7.3).
A malformed/unparseable response, even after one retry, fails safe: no
proposal row is written at all, rather than a garbage one.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm.client import LLMClient, LLMResponseError
from app.llm.prompts import REVIEWER_SYSTEM_PROMPT, build_reviewer_user_prompt
from app.models import BroadIndustry, Company, KillTrigger, Observation, SpecificNiche, StatusProposal, ThesisVersion, TriggerEvaluation

VALID_VERDICTS = {"on_track", "watch_closely", "broken"}
MAX_ATTEMPTS = 2


class NotFoundError(Exception):
    pass


class AIReviewFailedError(Exception):
    """The model's response could not be used - fails safe, no proposal written."""


def _last_n_periods_observations(db: Session, company_id: str, n: int = 4) -> list[dict]:
    periods = list(
        db.scalars(
            select(Observation.period)
            .where(Observation.company_id == company_id)
            .distinct()
            .order_by(Observation.period.desc())
            .limit(n)
        ).all()
    )
    if not periods:
        return []
    rows = db.scalars(
        select(Observation)
        .where(Observation.company_id == company_id, Observation.period.in_(periods))
        .order_by(Observation.period_end.desc())
    ).all()
    return [
        {
            "period": r.period,
            "metric_key": r.metric_key,
            "value": float(r.numeric_value) if r.numeric_value is not None else r.text_value,
            "source_url": r.source_url,
        }
        for r in rows
    ]


def _rule_engine_findings(db: Session, version_id: int, period: str) -> list[dict]:
    triggers = db.scalars(select(KillTrigger).where(KillTrigger.version_id == version_id)).all()
    findings = []
    for trigger in triggers:
        evaluation = db.scalar(
            select(TriggerEvaluation).where(
                TriggerEvaluation.trigger_id == trigger.id, TriggerEvaluation.period == period
            )
        )
        if evaluation is not None:
            findings.append(
                {
                    "trigger": trigger.label,
                    "threshold": float(trigger.threshold) if trigger.threshold is not None else None,
                    "observed": float(evaluation.observed_value) if evaluation.observed_value is not None else None,
                    "breached": evaluation.breached,
                }
            )
    return findings


def run_ai_review(
    db: Session, company_id: str, period: str, narrative: Optional[str], llm_client: LLMClient
) -> StatusProposal:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError(f"company '{company_id}' not found")
    if company.current_version_id is None:
        raise NotFoundError(f"company '{company_id}' has no current thesis version")

    version = db.get(ThesisVersion, company.current_version_id)
    industry = db.get(BroadIndustry, company.broad_industry_id)
    niche = db.get(SpecificNiche, company.specific_niche_id)

    metrics = _last_n_periods_observations(db, company_id)
    findings = _rule_engine_findings(db, version.version_id, period)
    user_prompt = build_reviewer_user_prompt(
        company_name=company.name,
        broad_industry=industry.name,
        specific_niche=niche.name,
        operating_model=company.operating_model,
        authored_at=version.authored_at.isoformat(),
        thesis_data=version.thesis_data,
        period=period,
        metrics=metrics,
        narrative=narrative,
        rule_engine_findings=findings,
    )

    response: Optional[dict] = None
    last_error: Optional[Exception] = None
    for attempt in range(MAX_ATTEMPTS):
        prompt = user_prompt
        if attempt > 0:
            prompt += (
                "\n\nYour previous response was not valid JSON matching the required schema. "
                "Return JSON only, with exactly these keys: verdict, confidence, reasoning_chain, "
                "evidence_used, unresolved_questions."
            )
        try:
            response = llm_client.complete_json(REVIEWER_SYSTEM_PROMPT, prompt)
            break
        except LLMResponseError as exc:
            last_error = exc
            continue

    if response is None:
        raise AIReviewFailedError(f"model response was not valid JSON after {MAX_ATTEMPTS} attempts: {last_error}")

    verdict = response.get("verdict")
    reasoning_chain = response.get("reasoning_chain")
    if verdict not in VALID_VERDICTS:
        raise AIReviewFailedError(f"model returned an unrecognized verdict: {verdict!r}")
    if not isinstance(reasoning_chain, list) or len(reasoning_chain) < 1:
        raise AIReviewFailedError(f"model response is missing a reasoning_chain: {response!r}")

    proposal = StatusProposal(
        company_id=company_id,
        period=period,
        proposed_status=verdict,
        source="ai_proposed",
        rationale=" ".join(str(step) for step in reasoning_chain),
        evidence={
            "reasoning_chain": reasoning_chain,
            "evidence_used": response.get("evidence_used", []),
            "confidence": response.get("confidence"),
            "unresolved_questions": response.get("unresolved_questions", []),
        },
        state="pending",
        model_name=getattr(llm_client, "model_name", "unknown"),
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)
    return proposal
