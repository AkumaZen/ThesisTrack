"""Company/scenario creation, thesis amendment, and version diffing
(BUILD_PLAN.md §1.3, §6; per-user scenarios per ADR-026).

thesis_versions is append-only (enforced by a DB trigger - see the P0
migration); this module only ever INSERTs new version rows and repoints
scenario.current_version_id, never UPDATEs an existing version.
"""
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import ANALYST_NAME
from app.models import BroadIndustry, Company, KillTrigger, SpecificNiche, ThesisScenario, ThesisVersion
from app.schemas.thesis import ThesisCreate, ThesisData
from app.services.scenarios import ScenarioNotFoundError, get_scenario_optional


class NotFoundError(Exception):
    pass


class TaxonomyError(Exception):
    pass


class AlreadyExistsError(Exception):
    pass


def _resolve_taxonomy(
    db: Session, broad_industry_name: str, specific_niche_name: str
) -> tuple[BroadIndustry, SpecificNiche]:
    industry = db.scalar(select(BroadIndustry).where(BroadIndustry.name == broad_industry_name))
    if industry is None:
        raise TaxonomyError(f"unknown broad_industry '{broad_industry_name}'")
    niche = db.scalar(
        select(SpecificNiche).where(
            SpecificNiche.broad_industry_id == industry.id,
            SpecificNiche.name == specific_niche_name,
        )
    )
    if niche is None:
        raise TaxonomyError(
            f"unknown specific_niche '{specific_niche_name}' under '{broad_industry_name}'; "
            "propose it via POST /taxonomy/niches first"
        )
    return industry, niche


def _write_kill_triggers(db: Session, version_id: int, thesis_data: ThesisData) -> None:
    for trigger in thesis_data.what_can_kill_it:
        db.add(
            KillTrigger(
                version_id=version_id,
                label=trigger.label,
                metric_key=trigger.metric_key,
                operator=trigger.operator,
                threshold=trigger.threshold,
                severity=trigger.severity,
                action=trigger.action,
                grace_periods=trigger.grace_periods,
                manual_check=trigger.manual_check,
            )
        )


def create_company(db: Session, payload: ThesisCreate, actor: str = ANALYST_NAME) -> ThesisScenario:
    """Creates a brand-new company + the caller's first scenario on it, OR -
    if the company already exists under someone else's thesis - just starts
    the caller's own new scenario on that existing company (same endpoint,
    same payload shape; classification fields are ignored for an existing
    company since identity is shared and already set). Raises
    AlreadyExistsError only if the caller already has a scenario here.
    """
    company = db.get(Company, payload.company_id)
    if company is not None and get_scenario_optional(db, payload.company_id, actor) is not None:
        raise AlreadyExistsError(f"'{actor}' already has a thesis on company '{payload.company_id}'")

    if company is None:
        industry, niche = _resolve_taxonomy(
            db, payload.classification.broad_industry, payload.classification.specific_niche
        )
        company = Company(
            company_id=payload.company_id,
            name=payload.name,
            broad_industry_id=industry.id,
            specific_niche_id=niche.id,
            operating_model=payload.classification.operating_model,
            currency=payload.classification.currency,
        )
        db.add(company)
        db.flush()

    scenario = ThesisScenario(
        company_id=company.company_id,
        owner=actor,
        label="Thesis",
        status=payload.status,
        status_source="manual",
        last_reviewed=payload.last_reviewed,
    )
    db.add(scenario)
    db.flush()

    version = ThesisVersion(
        company_id=company.company_id,
        scenario_id=scenario.id,
        version_no=1,
        thesis_data=payload.thesis_data.model_dump(mode="json"),
        change_note="initial thesis",
        authored_by=actor,
    )
    db.add(version)
    db.flush()

    _write_kill_triggers(db, version.version_id, payload.thesis_data)

    scenario.current_version_id = version.version_id
    db.commit()
    db.refresh(scenario)
    return scenario


def amend_thesis(
    db: Session, company_id: str, thesis_data: ThesisData, change_note: str, actor: str = ANALYST_NAME
) -> ThesisVersion:
    scenario = get_scenario_optional(db, company_id, actor)
    if scenario is None:
        if db.get(Company, company_id) is None:
            raise NotFoundError(f"company '{company_id}' not found")
        raise ScenarioNotFoundError(f"'{actor}' has no thesis on company '{company_id}' yet - start one first")

    version: ThesisVersion | None = None
    max_attempts = 5
    for attempt in range(max_attempts):
        next_version_no = (
            db.scalar(select(func.max(ThesisVersion.version_no)).where(ThesisVersion.scenario_id == scenario.id))
            or 0
        ) + 1

        version = ThesisVersion(
            company_id=company_id,
            scenario_id=scenario.id,
            version_no=next_version_no,
            thesis_data=thesis_data.model_dump(mode="json"),
            change_note=change_note,
            authored_by=actor,
        )
        db.add(version)
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
            scenario = get_scenario_optional(db, company_id, actor)
            if attempt == max_attempts - 1:
                raise

    _write_kill_triggers(db, version.version_id, thesis_data)
    scenario.current_version_id = version.version_id
    db.commit()
    db.refresh(version)
    return version


def _flatten(obj: Any, prefix: str = "") -> dict[str, Any]:
    flat: dict[str, Any] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            flat.update(_flatten(value, f"{prefix}.{key}" if prefix else key))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            flat.update(_flatten(value, f"{prefix}[{i}]"))
    else:
        flat[prefix] = obj
    return flat


def diff_versions(v1: ThesisVersion, v2: ThesisVersion) -> list[dict[str, Any]]:
    """Flat dotted-path structural diff between two versions' thesis_data."""
    left = _flatten(v1.thesis_data)
    right = _flatten(v2.thesis_data)
    changes = []
    for path in sorted(set(left) | set(right)):
        old, new = left.get(path), right.get(path)
        if old != new:
            changes.append({"path": path, "old": old, "new": new})
    return changes
