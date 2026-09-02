"""BUILD_PLAN.md §11: concurrent PUT /thesis must not produce duplicate
version_no; enforce with the unique constraint plus a retry.
"""
import json
import threading
from pathlib import Path

from app.schemas.thesis import ThesisCreate
from app.services.versioning import amend_thesis, create_company
from tests.conftest import TestSession as _Session

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"


def test_concurrent_amend_does_not_duplicate_version_no(db_conn):
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    thesis = ThesisCreate.model_validate(payload)

    setup_db = _Session()
    try:
        create_company(setup_db, thesis)
    finally:
        setup_db.close()

    results: list[int] = []
    errors: list[Exception] = []

    def worker():
        db = _Session()
        try:
            version = amend_thesis(db, "BALU_FORGE", thesis.thesis_data, "concurrent amendment")
            results.append(version.version_no)
        except Exception as exc:  # noqa: BLE001 - collected and asserted below
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    assert len(results) == 5
    assert len(set(results)) == 5, f"duplicate version_no under concurrency: {results}"
