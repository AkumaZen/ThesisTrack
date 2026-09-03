"""BUILD_PLAN.md §10 P6 acceptance criterion: the stats endpoint reports
zero leakage violations and the split is company-disjoint. Plus §11's
property test: no exported row has authored_at >= period_end.
"""
import copy
import json
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.llm.client import FakeLLMClient
from app.models import Observation
from app.schemas.thesis import ThesisCreate
from app.services.ai_reviewer import run_ai_review
from app.services.audit import close_outcome, resolve_proposal
from app.services.exporter import _company_ids_for_split, export_rows, export_stats
from app.services.versioning import create_company
from tests.conftest import TestSession as _Session

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"
_BASE_PAYLOAD = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

VALID_AI_RESPONSE = {
    "verdict": "on_track",
    "confidence": 0.85,
    "reasoning_chain": [
        "Premise 1: margin held above the redline this quarter.",
        "Premise 2: growth engine milestones are on schedule.",
        "Conclusion: thesis remains intact.",
    ],
    "evidence_used": ["operating_margin_pct"],
    "unresolved_questions": [],
}


def _create_company(company_id: str):
    payload = copy.deepcopy(_BASE_PAYLOAD)
    payload["company_id"] = company_id
    payload["name"] = f"Test Co {company_id}"
    db = _Session()
    try:
        thesis = ThesisCreate.model_validate(payload)
        create_company(db, thesis)
    finally:
        db.close()


def _post_observation(company_id: str, period: str, period_end: date, value: float = 20.0):
    db = _Session()
    try:
        db.execute(
            pg_insert(Observation).values(
                company_id=company_id,
                period=period,
                period_end=period_end,
                metric_key="operating_margin_pct",
                numeric_value=value,
                ingested_by="tester",
            )
        )
        db.commit()
    finally:
        db.close()


def _run_and_accept_ai_review(company_id: str, period: str):
    db = _Session()
    try:
        proposal = run_ai_review(db, company_id, period, "Solid quarter.", FakeLLMClient(response=VALID_AI_RESPONSE))
    finally:
        db.close()

    db = _Session()
    try:
        resolve_proposal(db, proposal.id, action="accept", verdict=None, note=None)
    finally:
        db.close()


def _close_outcome(company_id: str):
    db = _Session()
    try:
        close_outcome(db, company_id, "played_out", "Thesis played out as expected.")
    finally:
        db.close()


def test_eligible_verdict_row_is_exported(db_conn):
    company_id = "EXP_ELIGIBLE"
    _create_company(company_id)
    period_end = date.today() + timedelta(days=30)  # in the future relative to authored_at=now
    _post_observation(company_id, "FY26Q1", period_end)
    _run_and_accept_ai_review(company_id, "FY26Q1")
    _close_outcome(company_id)

    db = _Session()
    try:
        rows = export_rows(db, task="verdict", fmt="anthropic", split="all", include_open=False)
    finally:
        db.close()

    assert company_id in {r["metadata"]["company_id"] for r in rows}
    row = next(r for r in rows if r["metadata"]["company_id"] == company_id)
    assert row["messages"][1]["content"]["verdict"] == "on_track"
    assert len(row["messages"][1]["content"]["reasoning_chain"]) >= 3


def test_leaking_row_is_excluded_from_export_and_stats_report_zero_violations(db_conn):
    company_id = "EXP_LEAKY"
    _create_company(company_id)
    # backdated period_end BEFORE the thesis version's authored_at (= now) -
    # this simulates reasoning about a period that predates the thesis itself.
    period_end = date.today() - timedelta(days=400)
    _post_observation(company_id, "FY23Q1", period_end)
    _run_and_accept_ai_review(company_id, "FY23Q1")
    _close_outcome(company_id)

    db = _Session()
    try:
        rows = export_rows(db, task="verdict", fmt="anthropic", split="all", include_open=False)
        stats = export_stats(db, split="all", include_open=False)
    finally:
        db.close()

    exported_company_ids = {r["metadata"]["company_id"] for r in rows}
    assert company_id not in exported_company_ids  # excluded by the leakage filter
    assert stats["leakage_violations"] == 0  # and the self-audit confirms no violation slipped through


def test_open_outcome_excluded_from_verdict_by_default(db_conn):
    company_id = "EXP_OPEN"
    _create_company(company_id)  # outcome defaults to 'open', never closed
    period_end = date.today() + timedelta(days=30)
    _post_observation(company_id, "FY26Q1", period_end)
    _run_and_accept_ai_review(company_id, "FY26Q1")

    db = _Session()
    try:
        rows_default = export_rows(db, task="verdict", fmt="anthropic", split="all", include_open=False)
        rows_include_open = export_rows(db, task="verdict", fmt="anthropic", split="all", include_open=True)
    finally:
        db.close()

    assert company_id not in {r["metadata"]["company_id"] for r in rows_default}
    assert company_id in {r["metadata"]["company_id"] for r in rows_include_open}


def test_rejected_proposal_never_exported(db_conn):
    """Rejecting a proposal writes no health_checks row at all (app/services/audit.py) -
    confirms there's nothing for the exporter to accidentally pick up."""
    company_id = "EXP_REJECTED"
    _create_company(company_id)
    period_end = date.today() + timedelta(days=30)
    _post_observation(company_id, "FY26Q1", period_end)

    db = _Session()
    try:
        proposal = run_ai_review(db, company_id, "FY26Q1", None, FakeLLMClient(response=VALID_AI_RESPONSE))
    finally:
        db.close()
    db = _Session()
    try:
        resolve_proposal(db, proposal.id, action="reject", verdict=None, note="Disagree with the AI's read.")
    finally:
        db.close()
    _close_outcome(company_id)

    db = _Session()
    try:
        rows = export_rows(db, task="verdict", fmt="anthropic", split="all", include_open=False)
    finally:
        db.close()
    assert company_id not in {r["metadata"]["company_id"] for r in rows}


def test_splits_are_company_disjoint_and_stable_across_calls(db_conn):
    for i in range(6):
        _create_company(f"EXP_SPLIT_{i}")

    db = _Session()
    try:
        train_first = _company_ids_for_split(db, "train")
        eval_first = _company_ids_for_split(db, "eval")
    finally:
        db.close()

    assert train_first.isdisjoint(eval_first)
    assert (train_first | eval_first) >= {f"EXP_SPLIT_{i}" for i in range(6)}

    # calling again must not reassign anyone
    db = _Session()
    try:
        train_second = _company_ids_for_split(db, "train")
        eval_second = _company_ids_for_split(db, "eval")
    finally:
        db.close()
    assert train_first == train_second
    assert eval_first == eval_second


def test_redline_extraction_and_thesis_synthesis_tasks_export(db_conn):
    company_id = "EXP_SYNTH"
    _create_company(company_id)

    db = _Session()
    try:
        synth_rows = export_rows(db, task="thesis_synthesis", fmt="openai", split="all")
        redline_rows = export_rows(db, task="redline_extraction", fmt="llama", split="all")
    finally:
        db.close()

    assert any(r["metadata"]["company_id"] == company_id for r in synth_rows)
    assert any(r["metadata"]["company_id"] == company_id for r in redline_rows)
    # llama format shape
    assert "prompt" in redline_rows[0] and "completion" in redline_rows[0]
    # openai format shape
    assert synth_rows[0]["messages"][0]["role"] == "system"
