"""P1 acceptance criterion (BUILD_PLAN.md §10): create a company, post three
quarters of observations, amend the thesis twice, and retrieve a version
diff — all via HTTP, all covered by tests.
"""
import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"


@pytest.fixture
def golden_payload():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_full_thesis_lifecycle_via_http(client, golden_payload):
    # 1. create the company
    resp = client.post("/api/companies", json=golden_payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["company_id"] == "BALU_FORGE"
    assert body["current_version_id"] is not None

    # 2. post three quarters of observations
    for i, period in enumerate(["FY26Q1", "FY26Q2", "FY26Q3"]):
        resp = client.post(
            "/api/companies/BALU_FORGE/observations",
            json={
                "period": period,
                "period_end": f"2026-0{3 + i * 3}-30",
                "observations": [
                    {"metric_key": "operating_margin_pct", "numeric_value": 20.0 + i},
                    {"metric_key": "capacity_utilization_pct", "numeric_value": 65.0 + i},
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["count"] == 2

    # 3. amend the thesis twice
    amend_1 = {
        "thesis_data": golden_payload["thesis_data"],
        "change_note": "Q2 update: margin holding above redline",
    }
    amend_1["thesis_data"] = copy.deepcopy(amend_1["thesis_data"])
    amend_1["thesis_data"]["proof_points"]["model_specific_metrics"]["operating_margin_pct"] = 21.0
    resp = client.put("/api/companies/BALU_FORGE/thesis", json=amend_1)
    assert resp.status_code == 200, resp.text
    assert resp.json()["version_no"] == 2

    amend_2 = {
        "thesis_data": copy.deepcopy(amend_1["thesis_data"]),
        "change_note": "Q3 update: facility commercialization on schedule",
    }
    amend_2["thesis_data"]["the_big_change"]["expected_completion"] = "Q1 2027"
    resp = client.put("/api/companies/BALU_FORGE/thesis", json=amend_2)
    assert resp.status_code == 200, resp.text
    assert resp.json()["version_no"] == 3

    # 4. retrieve a version diff
    resp = client.get("/api/companies/BALU_FORGE/versions", params={"diff": "1,3"})
    assert resp.status_code == 200, resp.text
    diff_body = resp.json()
    assert len(diff_body["versions"]) == 3
    changed_paths = {c["path"] for c in diff_body["diff"]["changes"]}
    assert "proof_points.model_specific_metrics.operating_margin_pct" in changed_paths
    assert "the_big_change.expected_completion" in changed_paths

    # full record reflects the latest version
    resp = client.get("/api/companies/BALU_FORGE")
    assert resp.status_code == 200, resp.text
    detail = resp.json()
    assert len(detail["versions"]) == 3
    assert detail["current_thesis"]["the_big_change"]["expected_completion"] == "Q1 2027"


def test_create_company_rejects_unknown_taxonomy(client, golden_payload):
    bad = copy.deepcopy(golden_payload)
    bad["classification"]["specific_niche"] = "Not A Real Niche"
    resp = client.post("/api/companies", json=bad)
    assert resp.status_code == 422, resp.text


def test_create_company_requires_api_key(golden_payload):
    with TestClient(app) as anon_client:
        resp = anon_client.post("/api/companies", json=golden_payload)
    assert resp.status_code == 401


def test_taxonomy_and_metrics_endpoints(client):
    resp = client.get("/api/taxonomy")
    assert resp.status_code == 200
    industries = {row["name"] for row in resp.json()}
    assert "Auto & Mobility" in industries

    resp = client.get("/api/metrics", params={"operating_model": "factory"})
    assert resp.status_code == 200
    keys = {row["metric_key"] for row in resp.json()}
    assert "operating_margin_pct" in keys
    assert "arr" not in keys  # subscription-only metric must not leak in


def test_propose_niche(client):
    resp = client.post("/api/taxonomy/niches", json={"broad_industry": "Auto & Mobility", "name": "EV Components"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "EV Components"
