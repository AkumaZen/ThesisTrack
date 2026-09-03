"""Per-user parallel thesis "scenarios" (ADR-026) - shared resolution logic
used by every write action that needs to know "which user's thesis am I
acting on."

Design, confirmed with the user: actions implicitly apply to the caller's
own scenario. There is no explicit scenario_id in request URLs - "amend
the thesis" always means "amend my thesis." A scenario is created exactly
once, when a user first writes a thesis on a company (via create_company
for a brand-new company, or start_scenario for a company that already
exists under someone else's thesis). Every other write (amend, health
check, decision) requires an existing scenario and 404s if the caller
hasn't started one yet, rather than silently creating one on the wrong verb.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Company, ThesisScenario


class NotFoundError(Exception):
    pass


class ScenarioNotFoundError(Exception):
    """Raised when the caller has no scenario on this company yet - distinct
    from NotFoundError (company doesn't exist at all) so routers can return
    a message pointing at "start your own thesis" instead of a bare 404."""


def get_company_or_404(db: Session, company_id: str) -> Company:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError(f"company '{company_id}' not found")
    return company


def get_my_scenario(db: Session, company_id: str, owner: str) -> ThesisScenario:
    get_company_or_404(db, company_id)
    scenario = db.scalar(
        select(ThesisScenario).where(ThesisScenario.company_id == company_id, ThesisScenario.owner == owner)
    )
    if scenario is None:
        raise ScenarioNotFoundError(
            f"'{owner}' has no thesis on company '{company_id}' yet - start one first"
        )
    return scenario


def get_scenario_optional(db: Session, company_id: str, owner: str) -> ThesisScenario | None:
    return db.scalar(
        select(ThesisScenario).where(ThesisScenario.company_id == company_id, ThesisScenario.owner == owner)
    )


def list_scenarios(db: Session, company_id: str) -> list[ThesisScenario]:
    return db.scalars(
        select(ThesisScenario).where(ThesisScenario.company_id == company_id).order_by(ThesisScenario.created_at)
    ).all()
