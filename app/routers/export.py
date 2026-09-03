import json

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.db import get_db
from app.schemas.export import ExportFormat, ExportSplit, ExportStatsResponse, ExportTask
from app.services.exporter import export_rows, export_stats

router = APIRouter(prefix="/api", tags=["export"], dependencies=[Depends(require_api_key)])


@router.get("/export-training-data/stats", response_model=ExportStatsResponse)
def get_export_stats(
    split: ExportSplit = Query(default="all"),
    include_open: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    return export_stats(db, split=split, include_open=include_open)


@router.get("/export-training-data")
def get_export_training_data(
    task: ExportTask = Query(...),
    format: ExportFormat = Query(default="anthropic"),
    split: ExportSplit = Query(default="all"),
    min_confidence: float = Query(default=0.0, ge=0.0, le=1.0),
    include_open: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    rows = export_rows(db, task=task, fmt=format, split=split, include_open=include_open)
    if min_confidence > 0:
        rows = [
            r
            for r in rows
            if r["metadata"].get("confidence") is None or r["metadata"]["confidence"] >= min_confidence
        ]

    def _stream():
        for row in rows:
            yield json.dumps(row) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")
