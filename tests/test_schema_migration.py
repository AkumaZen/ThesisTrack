"""P0 acceptance criterion: an attempt to UPDATE thesis_versions raises."""
import psycopg
import psycopg.errors
import pytest
from psycopg.types.json import Json


def test_thesis_versions_is_append_only(db_conn):
    db_conn.execute("INSERT INTO broad_industries (name) VALUES (%s)", ("Test Industry",))
    industry_id = db_conn.execute(
        "SELECT id FROM broad_industries WHERE name = %s", ("Test Industry",)
    ).fetchone()[0]

    db_conn.execute(
        "INSERT INTO specific_niches (broad_industry_id, name) VALUES (%s, %s)",
        (industry_id, "Test Niche"),
    )
    niche_id = db_conn.execute(
        "SELECT id FROM specific_niches WHERE name = %s", ("Test Niche",)
    ).fetchone()[0]

    db_conn.execute(
        """INSERT INTO companies
               (company_id, name, broad_industry_id, specific_niche_id, operating_model, last_reviewed)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        ("TEST_CO", "Test Co", industry_id, niche_id, "factory", "2026-09-02"),
    )

    db_conn.execute(
        """INSERT INTO thesis_versions (company_id, version_no, thesis_data, authored_by)
           VALUES (%s, %s, %s, %s)""",
        ("TEST_CO", 1, Json({"the_business": {"what_it_does": "x"}}), "tester"),
    )

    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        db_conn.execute(
            "UPDATE thesis_versions SET change_note = 'edited' WHERE company_id = %s",
            ("TEST_CO",),
        )


def test_thesis_versions_delete_also_blocked(db_conn):
    db_conn.execute("INSERT INTO broad_industries (name) VALUES (%s)", ("Test Industry 2",))
    industry_id = db_conn.execute(
        "SELECT id FROM broad_industries WHERE name = %s", ("Test Industry 2",)
    ).fetchone()[0]

    db_conn.execute(
        "INSERT INTO specific_niches (broad_industry_id, name) VALUES (%s, %s)",
        (industry_id, "Test Niche 2"),
    )
    niche_id = db_conn.execute(
        "SELECT id FROM specific_niches WHERE name = %s", ("Test Niche 2",)
    ).fetchone()[0]

    db_conn.execute(
        """INSERT INTO companies
               (company_id, name, broad_industry_id, specific_niche_id, operating_model, last_reviewed)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        ("TEST_CO_2", "Test Co 2", industry_id, niche_id, "factory", "2026-09-02"),
    )

    db_conn.execute(
        """INSERT INTO thesis_versions (company_id, version_no, thesis_data, authored_by)
           VALUES (%s, %s, %s, %s)""",
        ("TEST_CO_2", 1, Json({"the_business": {"what_it_does": "x"}}), "tester"),
    )

    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        db_conn.execute("DELETE FROM thesis_versions WHERE company_id = %s", ("TEST_CO_2",))
