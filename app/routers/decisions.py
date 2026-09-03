from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import Actor, get_current_actor, require_write
from app.db import get_db
from app.schemas.decision import DecisionIn, DecisionOut
from app.services.decisions import list_decisions, log_decision
from app.services.scenarios import NotFoundError, ScenarioNotFoundError

router = APIRouter(prefix="/api", tags=["decisions"], dependencies=[Depends(get_current_actor)])


def _to_out(d) -> DecisionOut:
    return DecisionOut(
        id=d.id,
        company_id=d.company_id,
        version_id=d.version_id,
        action=d.action,
        price=float(d.price),
        quantity=float(d.quantity) if d.quantity is not None else None,
        decided_on=d.decided_on,
        rationale=d.rationale,
        actor=d.actor,
        created_at=d.created_at,
    )


@router.post("/companies/{company_id}/decisions", response_model=DecisionOut, status_code=status.HTTP_201_CREATED)
def post_decision(
    company_id: str,
    payload: DecisionIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    try:
        decision = log_decision(
            db,
            company_id,
            payload.action,
            payload.price,
            payload.quantity,
            payload.decided_on,
            payload.rationale,
            actor=actor.identity,
        )
    except (NotFoundError, ScenarioNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _to_out(decision)


@router.get("/companies/{company_id}/decisions", response_model=list[DecisionOut])
def get_decisions(company_id: str, db: Session = Depends(get_db)):
    return [_to_out(d) for d in list_decisions(db, company_id)]
