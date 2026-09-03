from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth import Actor, get_current_actor, require_write
from app.db import get_db
from app.schemas.price import BaselineMode, PerformanceOut, PriceObservationIn, PriceObservationOut
from app.services.price_performance import NotFoundError, compute_performance, list_prices, log_price

router = APIRouter(prefix="/api", tags=["price"], dependencies=[Depends(get_current_actor)])


def _to_out(p) -> PriceObservationOut:
    return PriceObservationOut(
        id=p.id,
        company_id=p.company_id,
        observed_on=p.observed_on,
        price=float(p.price),
        source=p.source,
        actor=p.actor,
        created_at=p.created_at,
    )


@router.post("/companies/{company_id}/prices", response_model=PriceObservationOut, status_code=status.HTTP_201_CREATED)
def post_price(
    company_id: str,
    payload: PriceObservationIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    try:
        price = log_price(db, company_id, payload.observed_on, payload.price, actor=actor.identity)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _to_out(price)


@router.get("/companies/{company_id}/prices", response_model=list[PriceObservationOut])
def get_prices(company_id: str, db: Session = Depends(get_db)):
    return [_to_out(p) for p in list_prices(db, company_id)]


@router.get("/companies/{company_id}/performance", response_model=PerformanceOut)
def get_performance(
    company_id: str,
    baseline: BaselineMode = Query(default="thesis"),
    db: Session = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    try:
        return compute_performance(db, company_id, baseline, actor=actor.identity)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
