"""Buy/sell decision logging - part 1 of the "track real investing behavior"
request (harness/memory/decisions.md has the full three-part breakdown).

Decisions are append-only (position_decisions has the same BEFORE UPDATE OR
DELETE trigger pattern as thesis_versions) since they're a record of a real
financial action, not editable notes. Each decision captures the company's
current_version_id at the moment it's logged - mirrors HealthCheck.version_id
- so "what did we believe when we bought" stays answerable later.
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import ANALYST_NAME
from app.models import Company, PositionDecision


class NotFoundError(Exception):
    pass


def log_decision(
    db: Session,
    company_id: str,
    action: str,
    price: float,
    quantity: Optional[float],
    decided_on: date,
    rationale: str,
    actor: str = ANALYST_NAME,
) -> PositionDecision:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError(f"company '{company_id}' not found")

    decision = PositionDecision(
        company_id=company_id,
        version_id=company.current_version_id,
        action=action,
        price=Decimal(str(price)),
        quantity=Decimal(str(quantity)) if quantity is not None else None,
        decided_on=decided_on,
        rationale=rationale,
        actor=actor,
    )
    db.add(decision)
    db.commit()
    db.refresh(decision)
    return decision


def list_decisions(db: Session, company_id: str) -> list[PositionDecision]:
    return db.scalars(
        select(PositionDecision)
        .where(PositionDecision.company_id == company_id)
        .order_by(PositionDecision.decided_on, PositionDecision.created_at)
    ).all()
