from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Actor, get_current_actor, require_write
from app.db import get_db
from app.models import BroadIndustry, SpecificNiche, StatusProposal
from app.schemas.company import CompanyOut
from app.schemas.proposal import (
    HealthCheckIn,
    HealthCheckOut,
    OutcomeIn,
    ProposalOut,
    ProposalResolveIn,
)
from app.services.audit import (
    AlreadyResolvedError,
    NotFoundError,
    OverrideRequiresNoteError,
    close_outcome,
    resolve_proposal,
    submit_health_check,
)

router = APIRouter(prefix="/api", tags=["health"], dependencies=[Depends(get_current_actor)])


@router.post("/companies/{company_id}/health-check", response_model=HealthCheckOut, status_code=status.HTTP_201_CREATED)
@router.put("/companies/{company_id}/health-check", response_model=HealthCheckOut)
def post_health_check(
    company_id: str,
    payload: HealthCheckIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    try:
        health = submit_health_check(db, company_id, payload.period, payload.verdict, payload.note, actor=actor.identity)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except OverrideRequiresNoteError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return HealthCheckOut(
        id=health.id,
        company_id=health.company_id,
        period=health.period,
        verdict=health.verdict,
        source=health.source,
        note=health.note,
        human_confirmed=health.human_confirmed,
        author=health.author,
        created_at=health.created_at,
    )


@router.get("/proposals", response_model=list[ProposalOut])
def list_proposals(
    state: Optional[str] = Query(default="pending"),
    company_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = select(StatusProposal)
    if state:
        stmt = stmt.where(StatusProposal.state == state)
    if company_id:
        stmt = stmt.where(StatusProposal.company_id == company_id)
    stmt = stmt.order_by(StatusProposal.created_at.desc())
    rows = db.scalars(stmt).all()
    return [
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
        for p in rows
    ]


@router.post("/proposals/{proposal_id}/resolve", response_model=ProposalOut)
def resolve_proposal_route(
    proposal_id: int,
    payload: ProposalResolveIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    try:
        proposal = resolve_proposal(db, proposal_id, payload.action, payload.verdict, payload.note, actor=actor.identity)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except AlreadyResolvedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except OverrideRequiresNoteError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return ProposalOut(
        id=proposal.id,
        company_id=proposal.company_id,
        period=proposal.period,
        proposed_status=proposal.proposed_status,
        source=proposal.source,
        rationale=proposal.rationale,
        evidence=proposal.evidence,
        state=proposal.state,
        model_name=proposal.model_name,
        created_at=proposal.created_at,
    )


@router.post("/companies/{company_id}/outcome", response_model=CompanyOut)
def post_outcome(
    company_id: str,
    payload: OutcomeIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    try:
        company = close_outcome(db, company_id, payload.outcome, payload.note, actor=actor.identity)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    industry = db.get(BroadIndustry, company.broad_industry_id)
    niche = db.get(SpecificNiche, company.specific_niche_id)
    return CompanyOut(
        company_id=company.company_id,
        name=company.name,
        broad_industry=industry.name,
        specific_niche=niche.name,
        operating_model=company.operating_model,
        currency=company.currency,
        status=company.status,
        status_source=company.status_source,
        outcome=company.outcome,
        conviction=company.conviction,
        last_reviewed=company.last_reviewed,
        current_version_id=company.current_version_id,
    )
