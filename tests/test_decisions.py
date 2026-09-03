"""Buy/sell decision logging - append-only, captures the thesis version
current at the moment of the decision."""
import json
from pathlib import Path

import psycopg
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


def _payload(**overrides):
    body = {
        "action": "buy",
        "price": 245.50,
        "quantity": 100,
        "decided_on": "2026-01-15",
        "rationale": "Initial position - margin trajectory matches thesis.",
    }
    body.update(overrides)
    return body


def test_log_buy_decision(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/decisions", json=_payload())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["action"] == "buy"
    assert body["price"] == 245.50
    assert body["quantity"] == 100
    assert body["company_id"] == company_id
    assert body["version_id"] is not None
    assert body["actor"] == "analyst"


def test_log_sell_decision(client, company_id):
    resp = client.post(
        f"/api/companies/{company_id}/decisions",
        json=_payload(action="sell", price=310.0, rationale="Thesis broken - exiting position."),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["action"] == "sell"


def test_quantity_is_optional(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/decisions", json=_payload(quantity=None))
    assert resp.status_code == 201, resp.text
    assert resp.json()["quantity"] is None


def test_invalid_action_rejected(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/decisions", json=_payload(action="hold"))
    assert resp.status_code == 422


def test_negative_price_rejected(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/decisions", json=_payload(price=-5))
    assert resp.status_code == 422


def test_empty_rationale_rejected(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/decisions", json=_payload(rationale=""))
    assert resp.status_code == 422


def test_unknown_company_404(client):
    resp = client.post("/api/companies/NOT_REAL/decisions", json=_payload())
    assert resp.status_code == 404


def test_list_decisions_ordered_by_date(client, company_id):
    client.post(f"/api/companies/{company_id}/decisions", json=_payload(decided_on="2026-03-01"))
    client.post(f"/api/companies/{company_id}/decisions", json=_payload(decided_on="2026-01-01"))
    client.post(f"/api/companies/{company_id}/decisions", json=_payload(decided_on="2026-02-01"))

    resp = client.get(f"/api/companies/{company_id}/decisions")
    assert resp.status_code == 200
    dates = [d["decided_on"] for d in resp.json()]
    assert dates == sorted(dates)


def test_decision_requires_write_role(client, company_id):
    from app.services.user_auth import create_user, issue_token
    from tests.conftest import TestSession

    db = TestSession()
    try:
        user = create_user(db, "readonly@test.com", "pw12345678", role="read_only")
        token = issue_token(user)
    finally:
        db.close()

    resp = client.post(
        f"/api/companies/{company_id}/decisions",
        json=_payload(),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_decision_requires_auth(company_id):
    from fastapi.testclient import TestClient

    from app.main import app

    anon_client = TestClient(app)
    resp = anon_client.post(f"/api/companies/{company_id}/decisions", json=_payload())
    assert resp.status_code == 401


def test_decisions_are_append_only(client, company_id, db_conn):
    resp = client.post(f"/api/companies/{company_id}/decisions", json=_payload())
    decision_id = resp.json()["id"]

    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        db_conn.execute("UPDATE position_decisions SET price = 999 WHERE id = %s", (decision_id,))
