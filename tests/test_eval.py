"""BUILD_PLAN.md §7.6 eval harness: verdict accuracy + confusion matrix,
redline recall, reasoning grounding (mechanical hallucination check).
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
from app.services.versioning import create_company
from eval.metrics import reasoning_grounding, redline_recall, verdict_accuracy
from eval.run_eval import run
from tests.conftest import TestSession as _Session

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"
_BASE_PAYLOAD = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_verdict_accuracy_and_confusion_matrix():
    predictions = ["on_track", "broken", "watch_closely", "broken"]
    labels = ["on_track", "watch_closely", "watch_closely", "broken"]
    result = verdict_accuracy(predictions, labels)
    assert result["n"] == 4
    assert result["accuracy"] == 0.75
    assert result["confusion_matrix"]["watch_closely"]["broken"] == 1
    assert result["confusion_matrix"]["broken"]["broken"] == 1


def test_verdict_accuracy_length_mismatch_raises():
    import pytest

    with pytest.raises(ValueError):
        verdict_accuracy(["on_track"], ["on_track", "broken"])


def test_redline_recall():
    actual = [
        {"metric_key": "operating_margin_pct", "operator": "<", "severity": "kill"},
        {"metric_key": None, "operator": None, "severity": "warn"},
    ]
    predicted = [{"metric_key": "operating_margin_pct", "operator": "<", "severity": "kill"}]
    result = redline_recall(predicted, actual)
    assert result["n"] == 2
    assert result["matched"] == 1
    assert result["recall"] == 0.5


def test_reasoning_grounding_flags_hallucinated_metric():
    result = reasoning_grounding(
        evidence_used=["operating_margin_pct", "made_up_metric"],
        available_metric_keys={"operating_margin_pct", "capacity_utilization_pct"},
    )
    assert result["grounded"] is False
    assert result["hallucinated"] == ["made_up_metric"]


def test_reasoning_grounding_clean_case():
    result = reasoning_grounding(
        evidence_used=["operating_margin_pct"], available_metric_keys={"operating_margin_pct"}
    )
    assert result["grounded"] is True
    assert result["hallucinated"] == []


def test_run_eval_against_fake_baseline(db_conn):
    company_id = "EVAL_RUN_CO"
    payload = copy.deepcopy(_BASE_PAYLOAD)
    payload["company_id"] = company_id
    db = _Session()
    try:
        create_company(db, ThesisCreate.model_validate(payload))
    finally:
        db.close()

    db = _Session()
    try:
        db.execute(
            pg_insert(Observation).values(
                company_id=company_id,
                period="FY26Q1",
                period_end=date.today() + timedelta(days=30),
                metric_key="operating_margin_pct",
                numeric_value=20.0,
                ingested_by="tester",
            )
        )
        db.commit()
        proposal = run_ai_review(
            db,
            company_id,
            "FY26Q1",
            None,
            FakeLLMClient(
                response={
                    "verdict": "on_track",
                    "confidence": 0.9,
                    "reasoning_chain": ["Premise 1: x", "Premise 2: y", "Conclusion: z"],
                    "evidence_used": ["operating_margin_pct"],
                    "unresolved_questions": [],
                }
            ),
        )
    finally:
        db.close()
    db = _Session()
    try:
        resolve_proposal(db, proposal.id, action="accept", verdict=None, note=None)
    finally:
        db.close()
    db = _Session()
    try:
        close_outcome(db, company_id, "played_out", "Thesis played out as expected.")
    finally:
        db.close()

    # force this company into the eval split for a deterministic test
    from app.models import TrainingSplit

    db = _Session()
    try:
        db.merge(TrainingSplit(company_id=company_id, split="eval"))
        db.commit()
    finally:
        db.close()

    db = _Session()
    try:
        report = run(db, FakeLLMClient(response={"verdict": "on_track", "reasoning_chain": [], "evidence_used": ["operating_margin_pct"]}))
    finally:
        db.close()

    assert report["n_eval_rows"] >= 1
    assert report["verdict_accuracy"]["n"] == report["n_eval_rows"]
    assert report["reasoning_grounded_rate"] == 1.0
