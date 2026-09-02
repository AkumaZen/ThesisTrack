from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.db import get_db
from app.models import MetricDefinition
from app.schemas.company import IndustryOut, MetricOut, NicheOut, NicheProposeIn
from app.services.taxonomy import TaxonomyError, list_taxonomy, propose_niche

router = APIRouter(prefix="/api", tags=["taxonomy"], dependencies=[Depends(require_api_key)])


@router.get("/taxonomy", response_model=list[IndustryOut])
def get_taxonomy(db: Session = Depends(get_db)):
    return list_taxonomy(db)


@router.post("/taxonomy/niches", response_model=NicheOut, status_code=status.HTTP_201_CREATED)
def post_niche(payload: NicheProposeIn, db: Session = Depends(get_db)):
    try:
        niche = propose_niche(db, payload.broad_industry, payload.name)
    except TaxonomyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return NicheOut(id=niche.id, name=niche.name, is_active=niche.is_active, company_count=0)


@router.get("/metrics", response_model=list[MetricOut])
def get_metrics(operating_model: Optional[str] = Query(default=None), db: Session = Depends(get_db)):
    stmt = select(MetricDefinition).order_by(MetricDefinition.sort_order, MetricDefinition.label)
    if operating_model:
        stmt = stmt.where(
            (MetricDefinition.operating_model == operating_model) | (MetricDefinition.operating_model.is_(None))
        )
    rows = db.scalars(stmt).all()
    return [
        MetricOut(
            metric_key=m.metric_key,
            label=m.label,
            operating_model=m.operating_model,
            unit=m.unit,
            higher_is_better=m.higher_is_better,
            is_core=m.is_core,
        )
        for m in rows
    ]
