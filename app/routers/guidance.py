from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Actor, get_current_actor, require_write
from app.db import get_db
from app.models import Company, GuidanceNote
from app.schemas.guidance import GuidanceNoteIn, GuidanceNoteOut

router = APIRouter(prefix="/api", tags=["guidance"], dependencies=[Depends(get_current_actor)])


def _to_out(note: GuidanceNote, company_name: Optional[str] = None) -> GuidanceNoteOut:
    return GuidanceNoteOut(
        id=note.id,
        company_id=note.company_id,
        company_name=company_name,
        block_key=note.block_key,
        note=note.note,
        status=note.status,
        created_by=note.created_by,
        created_at=note.created_at,
        resolved_by=note.resolved_by,
        resolved_at=note.resolved_at,
    )


@router.post(
    "/companies/{company_id}/guidance",
    response_model=GuidanceNoteOut,
    status_code=status.HTTP_201_CREATED,
)
def post_guidance(
    company_id: str,
    payload: GuidanceNoteIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"company '{company_id}' not found")

    note = GuidanceNote(
        company_id=company_id,
        block_key=payload.block_key,
        note=payload.note,
        created_by=actor.identity,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _to_out(note, company.name)


@router.get("/guidance", response_model=list[GuidanceNoteOut])
def list_guidance(
    company_id: Optional[str] = Query(default=None),
    block_key: Optional[str] = Query(default=None),
    status_: Optional[str] = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    stmt = select(GuidanceNote, Company.name).join(Company, GuidanceNote.company_id == Company.company_id)
    if company_id:
        stmt = stmt.where(GuidanceNote.company_id == company_id)
    if block_key:
        stmt = stmt.where(GuidanceNote.block_key == block_key)
    if status_:
        stmt = stmt.where(GuidanceNote.status == status_)
    stmt = stmt.order_by(GuidanceNote.status.asc(), GuidanceNote.created_at.desc())

    rows = db.execute(stmt).all()
    return [_to_out(note, company_name) for note, company_name in rows]


@router.post("/guidance/{guidance_id}/resolve", response_model=GuidanceNoteOut)
def resolve_guidance(
    guidance_id: int,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    note = db.get(GuidanceNote, guidance_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"guidance note {guidance_id} not found")

    note.status = "resolved"
    note.resolved_by = actor.identity
    note.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(note)

    company = db.get(Company, note.company_id)
    return _to_out(note, company.name if company else None)


@router.delete("/guidance/{guidance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_guidance(
    guidance_id: int,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    note = db.get(GuidanceNote, guidance_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"guidance note {guidance_id} not found")

    db.delete(note)
    db.commit()
