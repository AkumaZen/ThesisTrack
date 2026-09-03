"""Price logging + thesis-performance calculation - part 2 of the "track
real investing behavior" request (harness/memory/decisions.md ADR-025).

Two baseline modes, user-selectable (not one fixed choice):
  - "thesis": since the thesis's last_reviewed date - the nearest logged
    price on or after that date, falling back to the closest price
    available at all if nothing was logged on/after it.
  - "decision": since the first buy decision - uses that decision's own
    logged price directly (ground truth of what was actually paid), not a
    price_observations lookup, since the decision already recorded it.
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import ANALYST_NAME
from app.models import Company, PositionDecision, PriceObservation


class NotFoundError(Exception):
    pass


def log_price(
    db: Session, company_id: str, observed_on: date, price: float, actor: str = ANALYST_NAME
) -> PriceObservation:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError(f"company '{company_id}' not found")

    stmt = (
        pg_insert(PriceObservation)
        .values(
            company_id=company_id,
            observed_on=observed_on,
            price=Decimal(str(price)),
            source="manual",
            actor=actor,
        )
        .on_conflict_do_update(
            index_elements=["company_id", "observed_on"],
            set_={"price": Decimal(str(price)), "actor": actor},
        )
        .returning(PriceObservation.id)
    )
    row_id = db.execute(stmt).scalar_one()
    db.commit()
    return db.get(PriceObservation, row_id)


def list_prices(db: Session, company_id: str) -> list[PriceObservation]:
    return db.scalars(
        select(PriceObservation)
        .where(PriceObservation.company_id == company_id)
        .order_by(PriceObservation.observed_on)
    ).all()


def _latest_price(db: Session, company_id: str) -> Optional[PriceObservation]:
    return db.scalars(
        select(PriceObservation)
        .where(PriceObservation.company_id == company_id)
        .order_by(PriceObservation.observed_on.desc())
        .limit(1)
    ).first()


def _thesis_baseline(db: Session, company: Company) -> tuple[Optional[date], Optional[float], Optional[str]]:
    on_or_after = db.scalars(
        select(PriceObservation)
        .where(PriceObservation.company_id == company.company_id, PriceObservation.observed_on >= company.last_reviewed)
        .order_by(PriceObservation.observed_on)
        .limit(1)
    ).first()
    if on_or_after:
        return on_or_after.observed_on, float(on_or_after.price), None

    all_prices = list_prices(db, company.company_id)
    if not all_prices:
        return None, None, "No price data logged yet."

    nearest = min(all_prices, key=lambda p: abs((p.observed_on - company.last_reviewed).days))
    return (
        nearest.observed_on,
        float(nearest.price),
        f"No price logged on/after the thesis's last-reviewed date ({company.last_reviewed}) - using the nearest available price instead.",
    )


def _decision_baseline(db: Session, company_id: str) -> tuple[Optional[date], Optional[float], Optional[str]]:
    first_buy = db.scalars(
        select(PositionDecision)
        .where(PositionDecision.company_id == company_id, PositionDecision.action == "buy")
        .order_by(PositionDecision.decided_on)
        .limit(1)
    ).first()
    if not first_buy:
        return None, None, "No buy decisions logged yet."
    return first_buy.decided_on, float(first_buy.price), None


def compute_performance(db: Session, company_id: str, baseline_mode: str) -> dict:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError(f"company '{company_id}' not found")

    latest = _latest_price(db, company_id)
    current_date = latest.observed_on if latest else None
    current_price = float(latest.price) if latest else None

    if baseline_mode == "thesis":
        baseline_date, baseline_price, note = _thesis_baseline(db, company)
    else:
        baseline_date, baseline_price, note = _decision_baseline(db, company_id)

    if current_price is None:
        note = "No price data logged yet." if not note else note

    pct_change = None
    if baseline_price is not None and current_price is not None:
        pct_change = (current_price - baseline_price) / baseline_price * 100

    return {
        "baseline_mode": baseline_mode,
        "baseline_date": baseline_date,
        "baseline_price": baseline_price,
        "current_date": current_date,
        "current_price": current_price,
        "pct_change": pct_change,
        "currency": company.currency,
        "note": note,
    }
