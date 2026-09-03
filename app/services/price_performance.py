"""Price logging + thesis-performance calculation - part 2 of the "track
real investing behavior" request (harness/memory/decisions.md ADR-025).

Two baseline modes, user-selectable (not one fixed choice):
  - "thesis": since the caller's own scenario's last_reviewed date - the
    nearest logged price on or after that date, falling back to the
    closest price available at all if nothing was logged on/after it.
  - "decision": since the caller's own first buy decision - uses that
    decision's own logged price directly (ground truth of what was
    actually paid), not a price_observations lookup.

Per-user scenarios (ADR-026): price_observations themselves stay
company-wide/shared (the real price is not a matter of opinion), but both
baselines are personal - "is MY thesis performing" - so this always scopes
to the calling actor's own scenario/decisions, not just anyone's.
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import ANALYST_NAME
from app.models import Company, PositionDecision, PriceObservation, ThesisScenario
from app.services.scenarios import get_scenario_optional


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


def _thesis_baseline(db: Session, scenario: ThesisScenario) -> tuple[Optional[date], Optional[float], Optional[str]]:
    on_or_after = db.scalars(
        select(PriceObservation)
        .where(
            PriceObservation.company_id == scenario.company_id,
            PriceObservation.observed_on >= scenario.last_reviewed,
        )
        .order_by(PriceObservation.observed_on)
        .limit(1)
    ).first()
    if on_or_after:
        return on_or_after.observed_on, float(on_or_after.price), None

    all_prices = list_prices(db, scenario.company_id)
    if not all_prices:
        return None, None, "No price data logged yet."

    nearest = min(all_prices, key=lambda p: abs((p.observed_on - scenario.last_reviewed).days))
    return (
        nearest.observed_on,
        float(nearest.price),
        f"No price logged on/after the thesis's last-reviewed date ({scenario.last_reviewed}) - using the nearest available price instead.",
    )


def _decision_baseline(db: Session, company_id: str, actor: str) -> tuple[Optional[date], Optional[float], Optional[str]]:
    first_buy = db.scalars(
        select(PositionDecision)
        .where(
            PositionDecision.company_id == company_id,
            PositionDecision.actor == actor,
            PositionDecision.action == "buy",
        )
        .order_by(PositionDecision.decided_on)
        .limit(1)
    ).first()
    if not first_buy:
        return None, None, "No buy decisions logged yet."
    return first_buy.decided_on, float(first_buy.price), None


def compute_performance(db: Session, company_id: str, baseline_mode: str, actor: str = ANALYST_NAME) -> dict:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError(f"company '{company_id}' not found")

    latest = _latest_price(db, company_id)
    current_date = latest.observed_on if latest else None
    current_price = float(latest.price) if latest else None

    scenario = get_scenario_optional(db, company_id, actor)
    if scenario is None:
        return {
            "baseline_mode": baseline_mode,
            "baseline_date": None,
            "baseline_price": None,
            "current_date": current_date,
            "current_price": current_price,
            "pct_change": None,
            "currency": company.currency,
            "note": "You haven't started a thesis on this company yet.",
        }

    if baseline_mode == "thesis":
        baseline_date, baseline_price, note = _thesis_baseline(db, scenario)
    else:
        baseline_date, baseline_price, note = _decision_baseline(db, company_id, actor)

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
