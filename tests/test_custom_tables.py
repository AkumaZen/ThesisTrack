"""Data Tables ("Excel-like" per-company custom tables) - CRUD on the table
itself and its rows, plus the section tag (Tier 2 of the "more
customization" request: a table can optionally attach to one of the 7
thesis pillars instead of only sitting in the generic unattached list).
"""
import copy
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


def test_create_table_defaults_to_unattached(client, company_id):
    resp = client.post(f"/api/companies/{company_id}/tables", json={"name": "Shareholding", "columns": []})
    assert resp.status_code == 201, resp.text
    assert resp.json()["section"] is None


def test_create_table_with_valid_section(client, company_id):
    resp = client.post(
        f"/api/companies/{company_id}/tables",
        json={"name": "Extra Evidence", "columns": [], "section": "proof_points"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["section"] == "proof_points"


def test_create_table_rejects_unknown_section(client, company_id):
    resp = client.post(
        f"/api/companies/{company_id}/tables",
        json={"name": "Bad", "columns": [], "section": "not_a_real_pillar"},
    )
    assert resp.status_code == 422, resp.text


def test_patch_table_can_change_section(client, company_id):
    created = client.post(f"/api/companies/{company_id}/tables", json={"name": "T", "columns": []}).json()
    resp = client.patch(f"/api/tables/{created['id']}", json={"section": "the_business"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["section"] == "the_business"

    fetched = client.get(f"/api/tables/{created['id']}")
    assert fetched.json()["section"] == "the_business"


def test_patch_table_can_clear_section_back_to_unattached(client, company_id):
    """section=null must actually unattach, not be treated as "omitted"."""
    created = client.post(
        f"/api/companies/{company_id}/tables", json={"name": "T", "columns": [], "section": "the_business"}
    ).json()
    resp = client.patch(f"/api/tables/{created['id']}", json={"section": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["section"] is None


def test_patch_table_omitting_section_leaves_it_untouched(client, company_id):
    created = client.post(
        f"/api/companies/{company_id}/tables", json={"name": "T", "columns": [], "section": "the_business"}
    ).json()
    resp = client.patch(f"/api/tables/{created['id']}", json={"name": "Renamed"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["section"] == "the_business"


def test_patch_table_columns_after_creation_is_excel_like(client, company_id):
    """Tier 1: columns aren't locked in at creation - add/remove/rename anytime."""
    created = client.post(
        f"/api/companies/{company_id}/tables",
        json={"name": "Holders", "columns": [{"key": "holder", "label": "Holder", "type": "text"}]},
    ).json()
    assert len(created["columns"]) == 1

    resp = client.patch(
        f"/api/tables/{created['id']}",
        json={
            "columns": [
                {"key": "holder", "label": "Holder Name", "type": "text"},
                {"key": "pct_held", "label": "% Held", "type": "number"},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    columns = resp.json()["columns"]
    assert len(columns) == 2
    assert columns[1]["key"] == "pct_held"


def test_list_tables_for_company(client, company_id):
    client.post(f"/api/companies/{company_id}/tables", json={"name": "A", "columns": []})
    client.post(f"/api/companies/{company_id}/tables", json={"name": "B", "columns": [], "section": "health_check"})
    resp = client.get(f"/api/companies/{company_id}/tables")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_row_crud(client, company_id):
    table = client.post(
        f"/api/companies/{company_id}/tables",
        json={"name": "Rows", "columns": [{"key": "note", "label": "Note", "type": "text"}]},
    ).json()

    created_row = client.post(f"/api/tables/{table['id']}/rows", json={"row_data": {"note": "first"}})
    assert created_row.status_code == 201, created_row.text
    row_id = created_row.json()["id"]

    updated = client.put(f"/api/tables/{table['id']}/rows/{row_id}", json={"row_data": {"note": "second"}})
    assert updated.status_code == 200
    assert updated.json()["row_data"]["note"] == "second"

    deleted = client.delete(f"/api/tables/{table['id']}/rows/{row_id}")
    assert deleted.status_code == 204

    detail = client.get(f"/api/tables/{table['id']}").json()
    assert detail["rows"] == []


def test_delete_table(client, company_id):
    table = client.post(f"/api/companies/{company_id}/tables", json={"name": "Temp", "columns": []}).json()
    resp = client.delete(f"/api/tables/{table['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/tables/{table['id']}").status_code == 404
