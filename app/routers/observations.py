from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.config import ANALYST_NAME
from app.db import get_db
from app.models import Company, MetricDefinition, Observation
from app.schemas.observation import ObservationBulkIn
from app.services.rule_engine import evaluate_observations

router = APIRouter(prefix="/api", tags=["observations"], dependencies=[Depends(require_api_key)])


@router.post("/companies/{company_id}/observations", status_code=status.HTTP_201_CREATED)
def post_observations(company_id: str, payload: ObservationBulkIn, db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"company '{company_id}' not found")

    keys = {obs.metric_key for obs in payload.observations}
    known_keys = set(
        db.scalars(select(MetricDefinition.metric_key).where(MetricDefinition.metric_key.in_(keys))).all()
    )
    unknown = keys - known_keys
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown metric_key(s): {sorted(unknown)}",
        )

    written = []
    for obs in payload.observations:
        stmt = (
            pg_insert(Observation)
            .values(
                company_id=company_id,
                period=payload.period,
                period_end=payload.period_end,
                metric_key=obs.metric_key,
                numeric_value=obs.numeric_value,
                text_value=obs.text_value,
                source_type=obs.source_type,
                source_url=obs.source_url,
                note=obs.note,
                ingested_by=ANALYST_NAME,
            )
            .on_conflict_do_update(
                index_elements=["company_id", "period", "metric_key"],
                set_={
                    "numeric_value": obs.numeric_value,
                    "text_value": obs.text_value,
                    "source_type": obs.source_type,
                    "source_url": obs.source_url,
                    "note": obs.note,
                    "ingested_by": ANALYST_NAME,
                },
            )
            .returning(Observation.id)
        )
        result = db.execute(stmt)
        written.append(result.scalar_one())

    db.commit()

    proposals = evaluate_observations(db, company_id, payload.period)

    return {
        "period": payload.period,
        "observation_ids": written,
        "count": len(written),
        "proposals": [
            {
                "id": p.id,
                "proposed_status": p.proposed_status,
                "source": p.source,
                "rationale": p.rationale,
                "evidence": p.evidence,
            }
            for p in proposals
        ],
    }
