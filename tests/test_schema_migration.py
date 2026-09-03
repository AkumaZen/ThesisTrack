"""P0 acceptance criterion: an attempt to UPDATE thesis_versions raises."""
import psycopg
import psycopg.errors
import pytest
from psycopg.types.json import Json


def _make_company_and_scenario(db_conn, industry_name, niche_name, company_id):
    db_conn.execute("INSERT INTO broad_industries (name) VALUES (%s)", (industry_name,))
    industry_id = db_conn.execute(
        "SELECT id FROM broad_industries WHERE name = %s", (industry_name,)
    ).fetchone()[0]

    db_conn.execute(
        "INSERT INTO specific_niches (broad_industry_id, name) VALUES (%s, %s)",
        (industry_id, niche_name),
    )
    niche_id = db_conn.execute(
        "SELECT id FROM specific_niches WHERE name = %s", (niche_name,)
    ).fetchone()[0]

    db_conn.execute(
        """INSERT INTO companies
               (company_id, name, broad_industry_id, specific_niche_id, operating_model)
           VALUES (%s, %s, %s, %s, %s)""",
        (company_id, "Test Co", industry_id, niche_id, "factory"),
    )

    db_conn.execute(
        """INSERT INTO thesis_scenarios (company_id, owner, last_reviewed)
           VALUES (%s, %s, %s)""",
        (company_id, "tester", "2026-09-02"),
    )
    return db_conn.execute(
        "SELECT id FROM thesis_scenarios WHERE company_id = %s", (company_id,)
    ).fetchone()[0]


def test_thesis_versions_is_append_only(db_conn):
    scenario_id = _make_company_and_scenario(db_conn, "Test Industry", "Test Niche", "TEST_CO")

    db_conn.execute(
        """INSERT INTO thesis_versions (company_id, scenario_id, version_no, thesis_data, authored_by)
           VALUES (%s, %s, %s, %s, %s)""",
        ("TEST_CO", scenario_id, 1, Json({"the_business": {"what_it_does": "x"}}), "tester"),
    )

    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        db_conn.execute(
            "UPDATE thesis_versions SET change_note = 'edited' WHERE company_id = %s",
            ("TEST_CO",),
        )


def test_thesis_versions_delete_also_blocked(db_conn):
    scenario_id = _make_company_and_scenario(db_conn, "Test Industry 2", "Test Niche 2", "TEST_CO_2")

    db_conn.execute(
        """INSERT INTO thesis_versions (company_id, scenario_id, version_no, thesis_data, authored_by)
           VALUES (%s, %s, %s, %s, %s)""",
        ("TEST_CO_2", scenario_id, 1, Json({"the_business": {"what_it_does": "x"}}), "tester"),
    )

    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        db_conn.execute("DELETE FROM thesis_versions WHERE company_id = %s", ("TEST_CO_2",))
