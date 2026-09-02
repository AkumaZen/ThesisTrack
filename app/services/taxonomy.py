"""Taxonomy lookup and the propose-new-niche path (BUILD_PLAN.md §1.5)."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import BroadIndustry, Company, SpecificNiche


class TaxonomyError(Exception):
    pass


def list_taxonomy(db: Session) -> list[dict]:
    industries = db.scalars(select(BroadIndustry).order_by(BroadIndustry.name)).all()
    company_counts_by_niche = dict(
        db.execute(
            select(Company.specific_niche_id, func.count(Company.company_id)).group_by(Company.specific_niche_id)
        ).all()
    )
    company_counts_by_industry = dict(
        db.execute(
            select(Company.broad_industry_id, func.count(Company.company_id)).group_by(Company.broad_industry_id)
        ).all()
    )

    result = []
    for industry in industries:
        niches = db.scalars(
            select(SpecificNiche).where(SpecificNiche.broad_industry_id == industry.id).order_by(SpecificNiche.name)
        ).all()
        result.append(
            {
                "id": industry.id,
                "name": industry.name,
                "company_count": company_counts_by_industry.get(industry.id, 0),
                "niches": [
                    {
                        "id": niche.id,
                        "name": niche.name,
                        "is_active": niche.is_active,
                        "company_count": company_counts_by_niche.get(niche.id, 0),
                    }
                    for niche in niches
                ],
            }
        )
    return result


def propose_niche(db: Session, broad_industry_name: str, niche_name: str) -> SpecificNiche:
    industry = db.scalar(select(BroadIndustry).where(BroadIndustry.name == broad_industry_name))
    if industry is None:
        raise TaxonomyError(f"unknown broad_industry '{broad_industry_name}'")

    existing = db.scalar(
        select(SpecificNiche).where(
            SpecificNiche.broad_industry_id == industry.id, SpecificNiche.name == niche_name
        )
    )
    if existing is not None:
        return existing

    niche = SpecificNiche(broad_industry_id=industry.id, name=niche_name, is_active=True)
    db.add(niche)
    db.commit()
    db.refresh(niche)
    return niche
