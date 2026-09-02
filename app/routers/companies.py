from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.db import get_db
from app.models import BroadIndustry, Company, SpecificNiche, ThesisVersion
from app.schemas.company import (
    CompanyDetail,
    CompanyListResponse,
    CompanyOut,
    ThesisAmend,
    VersionDetail,
    VersionDiffEntry,
    VersionDiffResponse,
    VersionSummary,
)
from app.schemas.thesis import ThesisCreate
from app.services.versioning import (
    AlreadyExistsError,
    NotFoundError,
    TaxonomyError,
    amend_thesis,
    create_company,
    diff_versions,
)

router = APIRouter(prefix="/api", tags=["companies"], dependencies=[Depends(require_api_key)])


def _company_row_to_out(company: Company, industry_name: str, niche_name: str) -> CompanyOut:
    return CompanyOut(
        company_id=company.company_id,
        name=company.name,
        broad_industry=industry_name,
        specific_niche=niche_name,
        operating_model=company.operating_model,
        currency=company.currency,
        status=company.status,
        status_source=company.status_source,
        outcome=company.outcome,
        conviction=company.conviction,
        last_reviewed=company.last_reviewed,
        current_version_id=company.current_version_id,
    )


@router.post("/companies", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
def post_company(payload: ThesisCreate, db: Session = Depends(get_db)):
    try:
        company = create_company(db, payload)
    except AlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except TaxonomyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    industry = db.get(BroadIndustry, company.broad_industry_id)
    niche = db.get(SpecificNiche, company.specific_niche_id)
    return _company_row_to_out(company, industry.name, niche.name)


@router.get("/companies", response_model=CompanyListResponse)
def list_companies(
    db: Session = Depends(get_db),
    broad_industry: Optional[list[str]] = Query(default=None),
    niche: Optional[list[str]] = Query(default=None),
    operating_model: Optional[list[str]] = Query(default=None),
    status_: Optional[list[str]] = Query(default=None, alias="status"),
    outcome: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    review_due: Optional[bool] = Query(default=None),
    sort: str = Query(default="name"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
):
    stmt = select(Company, BroadIndustry.name, SpecificNiche.name).join(
        BroadIndustry, Company.broad_industry_id == BroadIndustry.id
    ).join(SpecificNiche, Company.specific_niche_id == SpecificNiche.id)

    if broad_industry:
        stmt = stmt.where(BroadIndustry.name.in_(broad_industry))
    if niche:
        stmt = stmt.where(SpecificNiche.name.in_(niche))
    if operating_model:
        stmt = stmt.where(Company.operating_model.in_(operating_model))
    if status_:
        stmt = stmt.where(Company.status.in_(status_))
    if outcome:
        stmt = stmt.where(Company.outcome == outcome)
    if q:
        stmt = stmt.where(Company.name.ilike(f"%{q}%"))
    if review_due:
        cutoff = date.today() - timedelta(days=91)
        stmt = stmt.where(Company.last_reviewed < cutoff)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))

    sort_column = {"name": Company.name, "last_reviewed": Company.last_reviewed}.get(sort, Company.name)
    stmt = stmt.order_by(sort_column).offset((page - 1) * page_size).limit(page_size)

    rows = db.execute(stmt).all()
    items = [_company_row_to_out(company, industry_name, niche_name) for company, industry_name, niche_name in rows]

    return CompanyListResponse(items=items, total=total or 0, page=page, page_size=page_size)


@router.get("/companies/{company_id}", response_model=CompanyDetail)
def get_company(company_id: str, db: Session = Depends(get_db)):
    row = db.execute(
        select(Company, BroadIndustry.name, SpecificNiche.name)
        .join(BroadIndustry, Company.broad_industry_id == BroadIndustry.id)
        .join(SpecificNiche, Company.specific_niche_id == SpecificNiche.id)
        .where(Company.company_id == company_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"company '{company_id}' not found")
    company, industry_name, niche_name = row

    current_version = db.get(ThesisVersion, company.current_version_id) if company.current_version_id else None
    versions = db.scalars(
        select(ThesisVersion)
        .where(ThesisVersion.company_id == company_id)
        .order_by(ThesisVersion.version_no.desc())
        .limit(8)
    ).all()

    base = _company_row_to_out(company, industry_name, niche_name)
    return CompanyDetail(
        **base.model_dump(),
        current_thesis=current_version.thesis_data if current_version else {},
        versions=[
            VersionSummary(
                version_id=v.version_id,
                version_no=v.version_no,
                change_note=v.change_note,
                authored_by=v.authored_by,
                authored_at=v.authored_at,
            )
            for v in versions
        ],
    )


@router.put("/companies/{company_id}/thesis", response_model=VersionDetail)
def put_thesis(company_id: str, payload: ThesisAmend, db: Session = Depends(get_db)):
    try:
        version = amend_thesis(db, company_id, payload.thesis_data, payload.change_note)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return VersionDetail(
        version_id=version.version_id,
        version_no=version.version_no,
        change_note=version.change_note,
        authored_by=version.authored_by,
        authored_at=version.authored_at,
        thesis_data=version.thesis_data,
    )


@router.get("/companies/{company_id}/versions")
def get_versions(
    company_id: str,
    diff: Optional[str] = Query(default=None, description="'from,to' version_no pair, e.g. '1,3'"),
    db: Session = Depends(get_db),
):
    versions = db.scalars(
        select(ThesisVersion).where(ThesisVersion.company_id == company_id).order_by(ThesisVersion.version_no)
    ).all()
    if not versions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"company '{company_id}' not found")

    summaries = [
        VersionSummary(
            version_id=v.version_id,
            version_no=v.version_no,
            change_note=v.change_note,
            authored_by=v.authored_by,
            authored_at=v.authored_at,
        )
        for v in versions
    ]

    if diff is None:
        return {"versions": summaries}

    try:
        from_no, to_no = (int(x) for x in diff.split(","))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="diff must be 'from,to' version numbers") from exc

    by_no = {v.version_no: v for v in versions}
    if from_no not in by_no or to_no not in by_no:
        raise HTTPException(status_code=422, detail=f"version_no not found: {from_no} or {to_no}")

    changes = diff_versions(by_no[from_no], by_no[to_no])
    diff_response = VersionDiffResponse(
        from_version_no=from_no,
        to_version_no=to_no,
        changes=[VersionDiffEntry(**c) for c in changes],
    )
    return {"versions": summaries, "diff": diff_response}
