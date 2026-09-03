"""Price logging (correctable, upserts by date) and thesis-performance
calculation across both baseline modes."""
import json
from pathlib import Path

import pytest

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"


@pytest.fixture
def golden_payload():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def company_id(client, golden_payload):
    resp = client.post("/api/companies", json=golden_payload)
    assert resp.status_code == 201, resp.text
    return golden_payload["company_id"]


def test_log_price(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-01-15", "price": 250.0})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["price"] == 250.0
    assert body["source"] == "manual"
    assert body["actor"] == "analyst"


def test_negative_price_rejected(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-01-15", "price": -1})
    assert resp.status_code == 422


def test_logging_same_date_twice_corrects_it(client, company_id):
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-01-15", "price": 250.0})
    resp = client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-01-15", "price": 260.0})
    assert resp.status_code == 201

    prices = client.get(f"/api/companies/{company_id}/prices").json()
    assert len(prices) == 1
    assert prices[0]["price"] == 260.0


def test_list_prices_ordered(client, company_id):
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-03-01", "price": 300})
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-01-01", "price": 200})
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-02-01", "price": 250})

    dates = [p["observed_on"] for p in client.get(f"/api/companies/{company_id}/prices").json()]
    assert dates == sorted(dates)


def test_performance_thesis_baseline_no_price_data(client, company_id):
    resp = client.get(f"/api/companies/{company_id}/performance?baseline=thesis")
    assert resp.status_code == 200
    body = resp.json()
    assert body["baseline_mode"] == "thesis"
    assert body["pct_change"] is None
    assert "No price data" in body["note"]


def test_performance_thesis_baseline_uses_price_on_or_after_last_reviewed(client, company_id, golden_payload):
    last_reviewed = golden_payload["last_reviewed"]  # 2026-09-02 in the fixture
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": last_reviewed, "price": 200})
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-12-01", "price": 240})

    resp = client.get(f"/api/companies/{company_id}/performance?baseline=thesis")
    body = resp.json()
    assert body["baseline_price"] == 200
    assert body["baseline_date"] == last_reviewed
    assert body["current_price"] == 240
    assert body["pct_change"] == pytest.approx(20.0)
    assert body["note"] is None


def test_performance_thesis_baseline_falls_back_to_nearest_when_nothing_after(client, company_id, golden_payload):
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2020-01-01", "price": 100})

    resp = client.get(f"/api/companies/{company_id}/performance?baseline=thesis")
    body = resp.json()
    assert body["baseline_price"] == 100
    assert "nearest available price" in body["note"]


def test_performance_decision_baseline_no_buys(client, company_id):
    resp = client.get(f"/api/companies/{company_id}/performance?baseline=decision")
    body = resp.json()
    assert body["baseline_mode"] == "decision"
    assert body["pct_change"] is None
    assert "No buy decisions" in body["note"]


def test_performance_decision_baseline_uses_first_buy_price(client, company_id):
    client.post(
        f"/api/companies/{company_id}/decisions",
        json={
            "action": "buy",
            "price": 220.0,
            "quantity": 50,
            "decided_on": "2026-01-10",
            "rationale": "First tranche.",
        },
    )
    client.post(
        f"/api/companies/{company_id}/decisions",
        json={
            "action": "buy",
            "price": 235.0,
            "quantity": 50,
            "decided_on": "2026-02-10",
            "rationale": "Adding on strength.",
        },
    )
    client.post(f"/api/companies/{company_id}/prices", json={"observed_on": "2026-06-01", "price": 275})

    resp = client.get(f"/api/companies/{company_id}/performance?baseline=decision")
    body = resp.json()
    assert body["baseline_price"] == 220.0
    assert body["baseline_date"] == "2026-01-10"
    assert body["current_price"] == 275
    assert body["pct_change"] == pytest.approx((275 - 220) / 220 * 100)


def test_performance_unknown_company_404(client):
    resp = client.get("/api/companies/NOT_REAL/performance?baseline=thesis")
    assert resp.status_code == 404


def test_log_price_requires_write_role(client, company_id):
    from app.services.user_auth import create_user, issue_token
    from tests.conftest import TestSession

    db = TestSession()
    try:
        user = create_user(db, "readonly2@test.com", "pw12345678", role="read_only")
        token = issue_token(user)
    finally:
        db.close()

    resp = client.post(
        f"/api/companies/{company_id}/prices",
        json={"observed_on": "2026-01-15", "price": 250},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
