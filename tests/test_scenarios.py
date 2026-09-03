"""Per-user parallel theses on the same company (ADR-026) - the actual new
behavior part 3 introduces. None of the pre-existing tests exercise two
different owners on one company, since every fixture-based test before this
only ever had a single implicit owner (ANALYST_NAME, via the shared X-API-Key
actor) - this file is what actually proves scenarios work.
"""
import copy
import json
from pathlib import Path

import pytest

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"


@pytest.fixture
def golden_payload():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _user_client(email: str, role: str = "read_write"):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.services.user_auth import create_user, issue_token
    from tests.conftest import TestSession

    db = TestSession()
    try:
        user = create_user(db, email, "pw12345678", role=role)
        token = issue_token(user)
    finally:
        db.close()
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


def test_creating_a_company_gives_the_creator_a_scenario(client, golden_payload):
    resp = client.post("/api/companies", json=golden_payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["has_own_scenario"] is True
    assert body["scenario_count"] == 1
    assert body["status"] == "on_track"


def test_second_user_can_start_their_own_thesis_on_an_existing_company(client, golden_payload):
    client.post("/api/companies", json=golden_payload)  # created by the default X-API-Key actor ("analyst")

    other = _user_client("investor2@test.com")
    payload2 = copy.deepcopy(golden_payload)
    payload2["status"] = "watch_closely"  # a genuinely different opinion
    resp = other.post("/api/companies", json=payload2)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["has_own_scenario"] is True
    assert body["status"] == "watch_closely"
    assert body["scenario_count"] == 2  # both the original creator's and this one


def test_same_user_cannot_start_a_second_thesis_on_the_same_company(client, golden_payload):
    client.post("/api/companies", json=golden_payload)
    resp = client.post("/api/companies", json=golden_payload)
    assert resp.status_code == 409


def test_each_users_scenario_is_independent(client, golden_payload):
    client.post("/api/companies", json=golden_payload)
    other = _user_client("investor3@test.com")
    payload2 = copy.deepcopy(golden_payload)
    other.post("/api/companies", json=payload2)

    # analyst logs a health check on their own thesis
    client.post(
        "/api/companies/BALU_FORGE/health-check",
        json={"period": "FY26Q1", "verdict": "watch_closely", "note": "Margin softening."},
    )

    analyst_view = client.get("/api/companies/BALU_FORGE").json()
    other_view = other.get("/api/companies/BALU_FORGE").json()

    assert analyst_view["status"] == "watch_closely"
    assert other_view["status"] == "on_track"  # untouched by the analyst's health check


def test_company_detail_lists_other_scenarios(client, golden_payload):
    client.post("/api/companies", json=golden_payload)
    other = _user_client("investor4@test.com")
    other.post("/api/companies", json=copy.deepcopy(golden_payload))

    detail = client.get("/api/companies/BALU_FORGE").json()
    assert len(detail["other_scenarios"]) == 1
    assert detail["other_scenarios"][0]["owner"] == "investor4@test.com"


def test_viewing_a_company_you_have_no_thesis_on_shows_empty_scenario_state(client, golden_payload):
    client.post("/api/companies", json=golden_payload)
    other = _user_client("investor5@test.com")

    detail = other.get("/api/companies/BALU_FORGE").json()
    assert detail["has_own_scenario"] is False
    assert detail["status"] is None
    assert detail["current_thesis"] == {}
    assert len(detail["other_scenarios"]) == 1


def test_amend_thesis_requires_your_own_existing_scenario(client, golden_payload):
    client.post("/api/companies", json=golden_payload)
    other = _user_client("investor6@test.com")

    resp = other.put(
        "/api/companies/BALU_FORGE/thesis",
        json={"thesis_data": golden_payload["thesis_data"], "change_note": "trying to amend without a thesis"},
    )
    assert resp.status_code == 404


def test_decision_requires_your_own_existing_scenario(client, golden_payload):
    client.post("/api/companies", json=golden_payload)
    other = _user_client("investor7@test.com")

    resp = other.post(
        "/api/companies/BALU_FORGE/decisions",
        json={"action": "buy", "price": 100, "decided_on": "2026-01-01", "rationale": "no thesis yet"},
    )
    assert resp.status_code == 404


def test_rule_engine_evaluates_each_scenario_independently(client, golden_payload):
    """Two users, two different kill-trigger thresholds on the same metric -
    an observation should fire (or not) each scenario's proposal independently."""
    payload1 = copy.deepcopy(golden_payload)
    client.post("/api/companies", json=payload1)

    other = _user_client("investor8@test.com")
    payload2 = copy.deepcopy(golden_payload)
    # loosen this scenario's redline so the same observation does NOT breach it
    for trigger in payload2["thesis_data"]["what_can_kill_it"]:
        if trigger.get("metric_key") == "operating_margin_pct":
            trigger["threshold"] = 5.0
    other.post("/api/companies", json=payload2)

    resp = client.post(
        "/api/companies/BALU_FORGE/observations",
        json={
            "period": "FY26Q1",
            "period_end": "2026-06-30",
            "observations": [{"metric_key": "operating_margin_pct", "numeric_value": 15.0}],
        },
    )
    assert resp.status_code == 201, resp.text

    analyst_proposals = client.get("/api/proposals?company_id=BALU_FORGE").json()
    other_proposals = other.get("/api/proposals?company_id=BALU_FORGE").json()

    # analyst's redline (< 18) is breached by 15.0 - other's (< 5) is not
    assert any(p["source"] == "rule_engine" for p in analyst_proposals)
    assert not any(p["source"] == "rule_engine" for p in other_proposals)
