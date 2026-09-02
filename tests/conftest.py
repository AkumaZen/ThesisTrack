import os
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
TEST_DB_URL = os.environ["DATABASE_URL_TEST"]


def _psycopg_conninfo(sqlalchemy_url: str) -> str:
    return sqlalchemy_url.replace("postgresql+psycopg://", "postgresql://")


# Shared test engine/session + FastAPI dependency override. Defined here (not
# in a test module) so the override is registered before any test runs,
# regardless of test collection/import order.
TestSession = sessionmaker(
    bind=create_engine(_psycopg_conninfo(TEST_DB_URL).replace("postgresql://", "postgresql+psycopg://")),
    autoflush=False,
    expire_on_commit=False,
)


def _override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


from app.db import get_db  # noqa: E402 - after path/env setup above
from app.main import app  # noqa: E402

app.dependency_overrides[get_db] = _override_get_db


SEED_TAXONOMY_SQL = (ROOT / "seeds" / "taxonomy.sql").read_text(encoding="utf-8")


@pytest.fixture(scope="session", autouse=True)
def _test_database():
    """Creates thesis_test (if missing) and runs migrations against it."""
    db_name = TEST_DB_URL.rsplit("/", 1)[1]
    admin_conninfo = _psycopg_conninfo(TEST_DB_URL.rsplit("/", 1)[0] + "/postgres")
    with psycopg.connect(admin_conninfo, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{db_name}"')

    env = os.environ.copy()
    env["DATABASE_URL"] = TEST_DB_URL
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    with psycopg.connect(_psycopg_conninfo(TEST_DB_URL), autocommit=True) as conn:
        conn.execute(SEED_TAXONOMY_SQL)

    yield


@pytest.fixture
def db_conn():
    with psycopg.connect(_psycopg_conninfo(TEST_DB_URL), autocommit=True) as conn:
        yield conn
        # Reset to the seeded baseline (taxonomy present, everything else empty)
        # so tests stay independent of run order and repeatable across sessions.
        conn.execute(
            "TRUNCATE thesis_versions, companies, specific_niches, broad_industries RESTART IDENTITY CASCADE"
        )
        conn.execute(SEED_TAXONOMY_SQL)


@pytest.fixture
def metric_registry(db_conn):
    rows = db_conn.execute("SELECT metric_key, operating_model FROM metric_definitions").fetchall()
    return {key: model for key, model in rows}


@pytest.fixture
def client(db_conn):
    from app.config import API_KEY

    return TestClient(app, headers={"X-API-Key": API_KEY})
