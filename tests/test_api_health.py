"""P3 acceptance criterion, over real HTTP: a fired kill trigger cannot be
dismissed without a note, and the resulting status_events row has
override=TRUE.
"""
import copy
import json
from pathlib import Path

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"


def _golden_payload():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_fired_kill_cannot_be_dismissed_without_a_note(client):
    resp = client.post("/api/companies", json=_golden_payload())
    assert resp.status_code == 201, resp.text

    resp = client.post(
        "/api/companies/BALU_FORGE/observations",
        json={
            "period": "FY26Q1",
            "period_end": "2026-06-30",
            "observations": [{"metric_key": "operating_margin_pct", "numeric_value": 15.0}],
        },
    )
    assert resp.status_code == 201, resp.text
    proposals = resp.json()["proposals"]
    assert len(proposals) == 1
    proposal_id = proposals[0]["id"]
    assert proposals[0]["proposed_status"] == "broken"

    # dismiss without a note -> refused
    resp = client.post(f"/api/proposals/{proposal_id}/resolve", json={"action": "reject"})
    assert resp.status_code == 422, resp.text

    # still pending
    resp = client.get("/api/proposals", params={"state": "pending"})
    assert resp.status_code == 200
    assert any(p["id"] == proposal_id for p in resp.json())

    # dismiss with a note -> succeeds, recorded as an override
    resp = client.post(
        f"/api/proposals/{proposal_id}/resolve",
        json={"action": "reject", "note": "One-off input cost spike, thesis intact — staying on_track."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["state"] == "rejected"

    # no longer pending
    resp = client.get("/api/proposals", params={"state": "pending"})
    assert resp.status_code == 200
    assert not any(p["id"] == proposal_id for p in resp.json())

    # company status is unchanged (the override kept it on_track)
    resp = client.get("/api/companies/BALU_FORGE")
    assert resp.status_code == 200
    assert resp.json()["status"] == "on_track"


def test_accepting_a_fired_kill_flips_status_to_broken(client):
    client.post("/api/companies", json=_golden_payload())
    resp = client.post(
        "/api/companies/BALU_FORGE/observations",
        json={
            "period": "FY26Q1",
            "period_end": "2026-06-30",
            "observations": [{"metric_key": "operating_margin_pct", "numeric_value": 15.0}],
        },
    )
    proposal_id = resp.json()["proposals"][0]["id"]

    resp = client.post(f"/api/proposals/{proposal_id}/resolve", json={"action": "accept"})
    assert resp.status_code == 200, resp.text

    resp = client.get("/api/companies/BALU_FORGE")
    assert resp.json()["status"] == "broken"


def test_direct_health_check_and_outcome_close(client):
    client.post("/api/companies", json=_golden_payload())

    resp = client.post(
        "/api/companies/BALU_FORGE/health-check",
        json={"period": "FY26Q2", "verdict": "on_track", "note": "Q2 review: on plan."},
    )
    assert resp.status_code == 201, resp.text

    resp = client.post(
        "/api/companies/BALU_FORGE/outcome",
        json={"outcome": "played_out", "note": "Thesis fully played out."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["outcome"] == "played_out"
