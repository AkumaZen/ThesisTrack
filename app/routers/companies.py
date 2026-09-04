from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import Actor, get_current_actor, require_write
from app.db import get_db
from app.models import (
    BroadIndustry,
    Company,
    HealthCheck,
    KillTrigger,
    MetricDefinition,
    Observation,
    SpecificNiche,
    StatusEvent,
    StatusProposal,
    ThesisScenario,
    ThesisVersion,
    TriggerEvaluation,
)
from app.schemas.company import (
    ActiveOverrideOut,
    CompanyDetail,
    CompanyListResponse,
    CompanyOut,
    KillTriggerOut,
    ObservationOut,
    ScenarioSummary,
    ThesisAmend,
    VersionDetail,
    VersionDiffEntry,
    VersionDiffResponse,
    VersionSummary,
)
from app.schemas.proposal import HealthCheckOut, ProposalOut
from app.schemas.thesis import ThesisCreate
from app.services.scenarios import ScenarioNotFoundError, get_scenario_optional, list_scenarios
from app.services.versioning import (
    AlreadyExistsError,
    NotFoundError,
    TaxonomyError,
    amend_thesis,
    create_company,
    diff_versions,
)

router = APIRouter(prefix="/api", tags=["companies"], dependencies=[Depends(get_current_actor)])


def _scenario_to_out(
    company: Company,
    industry_name: str,
    niche_name: str,
    scenario: Optional[ThesisScenario],
    scenario_count: int,
    has_active_override: bool = False,
    core_metrics: Optional[dict[str, float]] = None,
) -> CompanyOut:
    return CompanyOut(
        company_id=company.company_id,
        name=company.name,
        broad_industry=industry_name,
        specific_niche=niche_name,
        operating_model=company.operating_model,
        currency=company.currency,
        status=scenario.status if scenario else None,
        status_source=scenario.status_source if scenario else None,
        outcome=scenario.outcome if scenario else None,
        conviction=scenario.conviction if scenario else None,
        last_reviewed=scenario.last_reviewed if scenario else None,
        current_version_id=scenario.current_version_id if scenario else None,
        scenario_id=scenario.id if scenario else None,
        has_own_scenario=scenario is not None,
        scenario_count=scenario_count,
        has_active_override=has_active_override,
        core_metrics=core_metrics or {},
    )


def _core_metrics_for_scenarios(db: Session, scenarios: list[ThesisScenario]) -> dict[int, dict[str, float]]:
    """scenario_id -> {metric_key: value} for is_core registry metrics, read
    from that scenario's current thesis_data.proof_points.model_specific_metrics."""
    version_ids = [s.current_version_id for s in scenarios if s.current_version_id]
    if not version_ids:
        return {}
    versions_by_id = {
        v.version_id: v for v in db.scalars(select(ThesisVersion).where(ThesisVersion.version_id.in_(version_ids))).all()
    }
    core_keys = set(db.scalars(select(MetricDefinition.metric_key).where(MetricDefinition.is_core.is_(True))).all())

    result = {}
    for scenario in scenarios:
        version = versions_by_id.get(scenario.current_version_id)
        if version is None:
            continue
        snapshot = (version.thesis_data or {}).get("proof_points", {}).get("model_specific_metrics", {})
        result[scenario.id] = {k: v for k, v in snapshot.items() if k in core_keys}
    return result


def _latest_trigger_evaluations(db: Session, trigger_ids: list[int]) -> dict[int, TriggerEvaluation]:
    """trigger_id -> its most recent TriggerEvaluation, in one query (avoids
    a per-trigger round trip, which is expensive on a remote DB connection)."""
    if not trigger_ids:
        return {}
    rows = db.scalars(
        select(TriggerEvaluation)
        .distinct(TriggerEvaluation.trigger_id)
        .where(TriggerEvaluation.trigger_id.in_(trigger_ids))
        .order_by(TriggerEvaluation.trigger_id, TriggerEvaluation.evaluated_at.desc())
    ).all()
    return {e.trigger_id: e for e in rows}


def _latest_override_flags(db: Session, scenario_ids: list[int]) -> dict[int, bool]:
    """scenario_id -> whether that scenario's MOST RECENT status_event has override=True."""
    if not scenario_ids:
        return {}
    rows = db.execute(
        select(StatusEvent.scenario_id, StatusEvent.override)
        .distinct(StatusEvent.scenario_id)
        .where(StatusEvent.scenario_id.in_(scenario_ids))
        .order_by(StatusEvent.scenario_id, StatusEvent.created_at.desc())
    ).all()
    return {scenario_id: bool(override) for scenario_id, override in rows}


@router.post("/companies", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
def post_company(payload: ThesisCreate, db: Session = Depends(get_db), actor: Actor = Depends(require_write)):
    try:
        scenario = create_company(db, payload, actor=actor.identity)
    except AlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except TaxonomyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    company = db.get(Company, scenario.company_id)
    industry = db.get(BroadIndustry, company.broad_industry_id)
    niche = db.get(SpecificNiche, company.specific_niche_id)
    scenario_count = len(list_scenarios(db, company.company_id))
    return _scenario_to_out(company, industry.name, niche.name, scenario, scenario_count)


@router.get("/companies", response_model=CompanyListResponse)
def list_companies(
    db: Session = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
    broad_industry: Optional[list[str]] = Query(default=None),
    niche: Optional[list[str]] = Query(default=None),
    operating_model: Optional[list[str]] = Query(default=None),
    status_: Optional[list[str]] = Query(default=None, alias="status"),
    outcome: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    review_due: Optional[bool] = Query(default=None),
    sort: str = Query(default="name"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
):
    # Filters/sort that reference thesis state (status, last_reviewed) act on
    # the CALLING user's own scenario, so this always joins through the
    # caller's scenario rather than any scenario on the company.
    stmt = (
        select(Company, BroadIndustry.name, SpecificNiche.name, ThesisScenario)
        .join(BroadIndustry, Company.broad_industry_id == BroadIndustry.id)
        .join(SpecificNiche, Company.specific_niche_id == SpecificNiche.id)
        .outerjoin(
            ThesisScenario,
            (ThesisScenario.company_id == Company.company_id) & (ThesisScenario.owner == actor.identity),
        )
    )

    if broad_industry:
        stmt = stmt.where(BroadIndustry.name.in_(broad_industry))
    if niche:
        stmt = stmt.where(SpecificNiche.name.in_(niche))
    if operating_model:
        stmt = stmt.where(Company.operating_model.in_(operating_model))
    if status_:
        stmt = stmt.where(ThesisScenario.status.in_(status_))
    if outcome:
        stmt = stmt.where(ThesisScenario.outcome == outcome)
    if q:
        stmt = stmt.where(Company.name.ilike(f"%{q}%"))
    if review_due:
        cutoff = date.today() - timedelta(days=91)
        stmt = stmt.where(ThesisScenario.last_reviewed < cutoff)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))

    sort_column = {"name": Company.name, "last_reviewed": ThesisScenario.last_reviewed}.get(sort, Company.name)
    stmt = stmt.order_by(sort_column).offset((page - 1) * page_size).limit(page_size)

    rows = db.execute(stmt).all()
    company_ids = [company.company_id for company, _, _, _ in rows]
    scenario_counts = dict(
        db.execute(
            select(ThesisScenario.company_id, func.count())
            .where(ThesisScenario.company_id.in_(company_ids))
            .group_by(ThesisScenario.company_id)
        ).all()
    )
    my_scenarios = [scenario for _, _, _, scenario in rows if scenario is not None]
    override_flags = _latest_override_flags(db, [s.id for s in my_scenarios])
    core_metrics = _core_metrics_for_scenarios(db, my_scenarios)
    items = [
        _scenario_to_out(
            company,
            industry_name,
            niche_name,
            scenario,
            scenario_counts.get(company.company_id, 0),
            override_flags.get(scenario.id, False) if scenario else False,
            core_metrics.get(scenario.id) if scenario else None,
        )
        for company, industry_name, niche_name, scenario in rows
    ]

    return CompanyListResponse(items=items, total=total or 0, page=page, page_size=page_size)


@router.get("/companies/{company_id}", response_model=CompanyDetail)
def get_company(company_id: str, db: Session = Depends(get_db), actor: Actor = Depends(get_current_actor)):
    row = db.execute(
        select(Company, BroadIndustry.name, SpecificNiche.name)
        .join(BroadIndustry, Company.broad_industry_id == BroadIndustry.id)
        .join(SpecificNiche, Company.specific_niche_id == SpecificNiche.id)
        .where(Company.company_id == company_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"company '{company_id}' not found")
    company, industry_name, niche_name = row

    all_scenarios = list_scenarios(db, company_id)
    scenario = next((s for s in all_scenarios if s.owner == actor.identity), None)
    other_scenarios = [
        ScenarioSummary(id=s.id, owner=s.owner, label=s.label, status=s.status, last_reviewed=s.last_reviewed)
        for s in all_scenarios
        if s.owner != actor.identity
    ]

    if scenario is None:
        base = _scenario_to_out(company, industry_name, niche_name, None, len(all_scenarios))
        return CompanyDetail(**base.model_dump(), other_scenarios=other_scenarios)

    current_version = db.get(ThesisVersion, scenario.current_version_id) if scenario.current_version_id else None
    versions = db.scalars(
        select(ThesisVersion)
        .where(ThesisVersion.scenario_id == scenario.id)
        .order_by(ThesisVersion.version_no.desc())
        .limit(8)
    ).all()

    last_8_periods = list(
        db.scalars(
            select(Observation.period)
            .where(Observation.company_id == company_id)
            .distinct()
            .order_by(Observation.period.desc())
            .limit(8)
        ).all()
    )
    observations = (
        db.scalars(
            select(Observation)
            .where(Observation.company_id == company_id, Observation.period.in_(last_8_periods))
            .order_by(Observation.period_end.desc())
        ).all()
        if last_8_periods
        else []
    )

    health_checks = db.scalars(
        select(HealthCheck).where(HealthCheck.scenario_id == scenario.id).order_by(HealthCheck.created_at.desc())
    ).all()

    pending_proposals = db.scalars(
        select(StatusProposal)
        .where(StatusProposal.scenario_id == scenario.id, StatusProposal.state == "pending")
        .order_by(StatusProposal.created_at.desc())
    ).all()

    kill_triggers_out = []
    if current_version is not None:
        triggers = db.scalars(
            select(KillTrigger).where(KillTrigger.version_id == current_version.version_id)
        ).all()
        latest_evals = _latest_trigger_evaluations(db, [t.id for t in triggers])
        for t in triggers:
            latest_eval = latest_evals.get(t.id)
            kill_triggers_out.append(
                KillTriggerOut(
                    id=t.id,
                    label=t.label,
                    metric_key=t.metric_key,
                    operator=t.operator,
                    threshold=float(t.threshold) if t.threshold is not None else None,
                    severity=t.severity,
                    action=t.action,
                    grace_periods=t.grace_periods,
                    manual_check=t.manual_check,
                    latest_observed_value=(
                        float(latest_eval.observed_value)
                        if latest_eval and latest_eval.observed_value is not None
                        else None
                    ),
                    latest_breached=latest_eval.breached if latest_eval else None,
                    latest_fired=latest_eval.fired if latest_eval else None,
                )
            )

    latest_event = db.scalar(
        select(StatusEvent).where(StatusEvent.scenario_id == scenario.id).order_by(StatusEvent.created_at.desc())
    )
    active_override = (
        ActiveOverrideOut(
            to_status=latest_event.to_status,
            rationale=latest_event.rationale,
            actor=latest_event.actor,
            created_at=latest_event.created_at,
        )
        if latest_event and latest_event.override
        else None
    )

    base = _scenario_to_out(company, industry_name, niche_name, scenario, len(all_scenarios), active_override is not None)
    return CompanyDetail(
        **base.model_dump(),
        current_thesis=current_version.thesis_data if current_version else {},
        versions=[
            VersionSummary(
                version_id=v.version_id,
                version_no=v.version_no,
                change_note=v.change_note,
                authored_by=v.authored_by,
                authored_at=v.authored_at,
            )
            for v in versions
        ],
        observations=[
            ObservationOut(
                period=o.period,
                period_end=o.period_end,
                metric_key=o.metric_key,
                numeric_value=float(o.numeric_value) if o.numeric_value is not None else None,
                text_value=o.text_value,
                source_type=o.source_type,
                source_url=o.source_url,
                note=o.note,
            )
            for o in observations
        ],
        health_checks=[
            HealthCheckOut(
                id=h.id,
                company_id=h.company_id,
                period=h.period,
                verdict=h.verdict,
                source=h.source,
                note=h.note,
                human_confirmed=h.human_confirmed,
                author=h.author,
                created_at=h.created_at,
            )
            for h in health_checks
        ],
        pending_proposals=[
            ProposalOut(
                id=p.id,
                company_id=p.company_id,
                period=p.period,
                proposed_status=p.proposed_status,
                source=p.source,
                rationale=p.rationale,
                evidence=p.evidence,
                state=p.state,
                model_name=p.model_name,
                created_at=p.created_at,
            )
            for p in pending_proposals
        ],
        kill_triggers=kill_triggers_out,
        active_override=active_override,
        other_scenarios=other_scenarios,
    )


@router.put("/companies/{company_id}/thesis", response_model=VersionDetail)
def put_thesis(
    company_id: str,
    payload: ThesisAmend,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    try:
        version = amend_thesis(db, company_id, payload.thesis_data, payload.change_note, actor=actor.identity)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return VersionDetail(
        version_id=version.version_id,
        version_no=version.version_no,
        change_note=version.change_note,
        authored_by=version.authored_by,
        authored_at=version.authored_at,
        thesis_data=version.thesis_data,
    )


@router.get("/companies/{company_id}/versions")
def get_versions(
    company_id: str,
    diff: Optional[str] = Query(default=None, description="'from,to' version_no pair, e.g. '1,3'"),
    db: Session = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    scenario = get_scenario_optional(db, company_id, actor.identity)
    if scenario is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{actor.identity}' has no thesis on company '{company_id}' yet",
        )

    versions = db.scalars(
        select(ThesisVersion).where(ThesisVersion.scenario_id == scenario.id).order_by(ThesisVersion.version_no)
    ).all()

    summaries = [
        VersionSummary(
            version_id=v.version_id,
            version_no=v.version_no,
            change_note=v.change_note,
            authored_by=v.authored_by,
            authored_at=v.authored_at,
        )
        for v in versions
    ]

    if diff is None:
        return {"versions": summaries}

    try:
        from_no, to_no = (int(x) for x in diff.split(","))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="diff must be 'from,to' version numbers") from exc

    by_no = {v.version_no: v for v in versions}
    if from_no not in by_no or to_no not in by_no:
        raise HTTPException(status_code=422, detail=f"version_no not found: {from_no} or {to_no}")

    changes = diff_versions(by_no[from_no], by_no[to_no])
    diff_response = VersionDiffResponse(
        from_version_no=from_no,
        to_version_no=to_no,
        changes=[VersionDiffEntry(**c) for c in changes],
    )
    return {"versions": summaries, "diff": diff_response}
