from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Actor, get_current_actor, require_write
from app.db import get_db
from app.models import Company, CustomTable, CustomTableRow
from app.schemas.custom_tables import (
    CustomTableColumn,
    CustomTableCreate,
    CustomTableDetail,
    CustomTableOut,
    CustomTableRowIn,
    CustomTableRowOut,
    CustomTableUpdate,
)

router = APIRouter(prefix="/api", tags=["custom_tables"], dependencies=[Depends(get_current_actor)])


def _validate_row_data(columns: list[dict], row_data: dict[str, Any]) -> dict[str, Any]:
    """Type-check row_data against the table's column defs, coercing where sensible.
    Unknown keys and blank cells (missing/None/'') are rejected/skipped respectively -
    partial rows are fine, typo'd column keys are not (mirrors the unknown-metric_key
    rejection in app/routers/observations.py)."""
    by_key = {c["key"]: c for c in columns}
    unknown = set(row_data) - set(by_key)
    if unknown:
        raise ValueError(f"unknown column key(s): {sorted(unknown)}")

    cleaned: dict[str, Any] = {}
    for key, value in row_data.items():
        if value is None or value == "":
            continue
        col_type = by_key[key]["type"]
        if col_type == "number":
            try:
                cleaned[key] = float(value)
            except (TypeError, ValueError):
                raise ValueError(f"column '{key}' expects a number, got {value!r}")
        elif col_type == "date":
            try:
                date.fromisoformat(str(value))
            except ValueError:
                raise ValueError(f"column '{key}' expects an ISO date (YYYY-MM-DD), got {value!r}")
            cleaned[key] = str(value)
        elif col_type == "enum":
            options = by_key[key].get("options") or []
            if value not in options:
                raise ValueError(f"column '{key}' expects one of {options}, got {value!r}")
            cleaned[key] = value
        else:
            cleaned[key] = str(value)
    return cleaned


def _table_to_out(table: CustomTable, row_count: int = 0) -> CustomTableOut:
    return CustomTableOut(
        id=table.id,
        company_id=table.company_id,
        name=table.name,
        columns=[CustomTableColumn(**c) for c in table.columns],
        section=table.section,
        created_by=table.created_by,
        created_at=table.created_at,
        updated_at=table.updated_at,
        row_count=row_count,
    )


def _row_to_out(row: CustomTableRow) -> CustomTableRowOut:
    return CustomTableRowOut(
        id=row.id,
        table_id=row.table_id,
        row_data=row.row_data,
        row_order=row.row_order,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.post(
    "/companies/{company_id}/tables",
    response_model=CustomTableOut,
    status_code=status.HTTP_201_CREATED,
)
def post_table(
    company_id: str,
    payload: CustomTableCreate,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"company '{company_id}' not found")

    table = CustomTable(
        company_id=company_id,
        name=payload.name,
        columns=[c.model_dump() for c in payload.columns],
        section=payload.section,
        created_by=actor.identity,
    )
    db.add(table)
    db.commit()
    db.refresh(table)
    return _table_to_out(table)


@router.get("/companies/{company_id}/tables", response_model=list[CustomTableOut])
def list_tables(company_id: str, db: Session = Depends(get_db)):
    tables = db.scalars(
        select(CustomTable).where(CustomTable.company_id == company_id).order_by(CustomTable.created_at)
    ).all()
    return [_table_to_out(t, len(t.rows)) for t in tables]


@router.get("/tables/{table_id}", response_model=CustomTableDetail)
def get_table(table_id: int, db: Session = Depends(get_db)):
    table = db.get(CustomTable, table_id)
    if table is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"table {table_id} not found")

    base = _table_to_out(table, len(table.rows))
    return CustomTableDetail(**base.model_dump(), rows=[_row_to_out(r) for r in table.rows])


@router.patch("/tables/{table_id}", response_model=CustomTableOut)
def patch_table(
    table_id: int,
    payload: CustomTableUpdate,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    table = db.get(CustomTable, table_id)
    if table is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"table {table_id} not found")

    # model_fields_set (not "is not None") distinguishes "field omitted" from
    # "field explicitly sent as null" - needed for section, since null is a
    # meaningful value here (unattach the table from its pillar), not just
    # "don't touch this field".
    fields_set = payload.model_fields_set
    if "name" in fields_set and payload.name is not None:
        table.name = payload.name
    if "columns" in fields_set and payload.columns is not None:
        table.columns = [c.model_dump() for c in payload.columns]
    if "section" in fields_set:
        table.section = payload.section
    db.commit()
    db.refresh(table)
    return _table_to_out(table, len(table.rows))


@router.delete("/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_table(
    table_id: int,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    table = db.get(CustomTable, table_id)
    if table is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"table {table_id} not found")

    db.delete(table)
    db.commit()


@router.post("/tables/{table_id}/rows", response_model=CustomTableRowOut, status_code=status.HTTP_201_CREATED)
def post_row(
    table_id: int,
    payload: CustomTableRowIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    table = db.get(CustomTable, table_id)
    if table is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"table {table_id} not found")

    try:
        cleaned = _validate_row_data(table.columns, payload.row_data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    next_order = max((r.row_order for r in table.rows), default=-1) + 1
    row = CustomTableRow(table_id=table_id, row_data=cleaned, row_order=next_order, created_by=actor.identity)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_out(row)


@router.put("/tables/{table_id}/rows/{row_id}", response_model=CustomTableRowOut)
def put_row(
    table_id: int,
    row_id: int,
    payload: CustomTableRowIn,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    table = db.get(CustomTable, table_id)
    if table is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"table {table_id} not found")
    row = db.get(CustomTableRow, row_id)
    if row is None or row.table_id != table_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"row {row_id} not found on table {table_id}")

    try:
        cleaned = _validate_row_data(table.columns, payload.row_data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    row.row_data = cleaned
    db.commit()
    db.refresh(row)
    return _row_to_out(row)


@router.delete("/tables/{table_id}/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_row(
    table_id: int,
    row_id: int,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_write),
):
    row = db.get(CustomTableRow, row_id)
    if row is None or row.table_id != table_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"row {row_id} not found on table {table_id}")

    db.delete(row)
    db.commit()
