"""BUILD_PLAN.md §10 P4 acceptance criterion: /ai-review returns a grounded
proposal, companies.status is provably unchanged, and a malformed model
response fails safe rather than writing garbage.
"""
import copy
import json
import os
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.config import ANALYST_NAME
from app.llm.client import FakeLLMClient, LLMResponseError, get_llm_client
from app.models import StatusProposal
from app.schemas.thesis import ThesisCreate
from app.services.ai_reviewer import AIReviewFailedError, run_ai_review
from app.services.scenarios import get_my_scenario
from app.services.versioning import create_company
from tests.conftest import TestSession as _Session

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"
_BASE_PAYLOAD = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

VALID_RESPONSE = {
    "verdict": "on_track",
    "confidence": 0.8,
    "reasoning_chain": [
        "Premise: margin is holding above the redline this quarter.",
        "Conclusion: thesis remains intact.",
    ],
    "evidence_used": ["operating_margin_pct"],
    "unresolved_questions": [],
}


def _create_balu_forge():
    payload = copy.deepcopy(_BASE_PAYLOAD)
    db = _Session()
    try:
        thesis = ThesisCreate.model_validate(payload)
        create_company(db, thesis)
    finally:
        db.close()


class _RetryThenSucceedClient:
    """Fails once with malformed JSON, then returns a valid response."""

    model_name = "fake-retry-llm"

    def __init__(self):
        self.call_count = 0

    def complete_json(self, system, user):
        self.call_count += 1
        if self.call_count == 1:
            raise LLMResponseError("not json")
        return VALID_RESPONSE


def test_ai_review_writes_grounded_proposal_and_leaves_status_untouched(db_conn):
    _create_balu_forge()
    db = _Session()
    try:
        status_before = get_my_scenario(db, "BALU_FORGE", ANALYST_NAME).status
        proposal = run_ai_review(
            db, "BALU_FORGE", "FY26Q1", "Solid quarter.", FakeLLMClient(response=VALID_RESPONSE), actor=ANALYST_NAME
        )
        status_after = get_my_scenario(db, "BALU_FORGE", ANALYST_NAME).status
    finally:
        db.close()

    assert proposal.source == "ai_proposed"
    assert proposal.state == "pending"
    assert proposal.proposed_status == "on_track"
    assert proposal.evidence["evidence_used"] == ["operating_margin_pct"]
    assert status_before == status_after == "on_track"


def test_ai_review_never_writes_companies_status_even_when_verdict_is_broken(db_conn):
    _create_balu_forge()
    broken_response = {**VALID_RESPONSE, "verdict": "broken"}
    db = _Session()
    try:
        status_before = get_my_scenario(db, "BALU_FORGE", ANALYST_NAME).status
        run_ai_review(db, "BALU_FORGE", "FY26Q1", None, FakeLLMClient(response=broken_response), actor=ANALYST_NAME)
        status_after = get_my_scenario(db, "BALU_FORGE", ANALYST_NAME).status
    finally:
        db.close()
    assert status_before == status_after  # constitution rule 3: proposals only


def test_malformed_response_fails_safe_no_proposal_written(db_conn):
    _create_balu_forge()
    db = _Session()
    try:
        proposal_count_before = db.scalar(select(func.count()).select_from(StatusProposal))
        with pytest.raises(AIReviewFailedError):
            run_ai_review(
                db, "BALU_FORGE", "FY26Q1", None, FakeLLMClient(raw_text="not valid json at all"), actor=ANALYST_NAME
            )
        proposal_count_after = db.scalar(select(func.count()).select_from(StatusProposal))
    finally:
        db.close()
    assert proposal_count_before == proposal_count_after == 0


def test_invalid_verdict_value_fails_safe(db_conn):
    _create_balu_forge()
    bad_response = {**VALID_RESPONSE, "verdict": "somewhat_ok"}
    db = _Session()
    try:
        with pytest.raises(AIReviewFailedError):
            run_ai_review(db, "BALU_FORGE", "FY26Q1", None, FakeLLMClient(response=bad_response), actor=ANALYST_NAME)
    finally:
        db.close()


def test_retries_once_on_malformed_response_then_succeeds(db_conn):
    _create_balu_forge()
    client = _RetryThenSucceedClient()
    db = _Session()
    try:
        proposal = run_ai_review(db, "BALU_FORGE", "FY26Q1", None, client, actor=ANALYST_NAME)
    finally:
        db.close()
    assert client.call_count == 2
    assert proposal.proposed_status == "on_track"


def test_get_llm_client_raises_clearly_when_unconfigured(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        get_llm_client()


def test_ai_review_over_http(client, db_conn):
    from app.llm.client import get_llm_client as get_llm_client_dep
    from app.main import app

    app.dependency_overrides[get_llm_client_dep] = lambda: FakeLLMClient(response=VALID_RESPONSE)
    try:
        resp = client.post("/api/companies", json=copy.deepcopy(_BASE_PAYLOAD))
        assert resp.status_code == 201, resp.text

        status_before = client.get("/api/companies/BALU_FORGE").json()["status"]
        resp = client.post(
            "/api/companies/BALU_FORGE/ai-review", json={"period": "FY26Q1", "narrative": "Solid quarter."}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["source"] == "ai_proposed"
        status_after = client.get("/api/companies/BALU_FORGE").json()["status"]
        assert status_before == status_after
    finally:
        del app.dependency_overrides[get_llm_client_dep]
