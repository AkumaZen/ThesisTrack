"""BUILD_PLAN.md §11 rule-engine table-driven tests, plus §10's literal P2
acceptance criterion: operating_margin_pct=17.2 against an 18% kill trigger
creates a pending 'broken' proposal, and 18.5 does not.
"""
import copy
import json
from pathlib import Path

import pytest
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models import Observation
from app.schemas.thesis import ThesisCreate
from app.services.rule_engine import evaluate_observations
from app.services.versioning import create_company
from tests.conftest import TestSession as _Session

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"
_BASE_PAYLOAD = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _make_company(company_id, metric_key, operator, threshold, severity, grace_periods):
    payload = copy.deepcopy(_BASE_PAYLOAD)
    payload["company_id"] = company_id
    payload["name"] = f"Test Co {company_id}"
    payload["thesis_data"]["what_can_kill_it"] = [
        {
            "label": f"test trigger {operator} {threshold}",
            "metric_key": metric_key,
            "operator": operator,
            "threshold": threshold,
            "unit": "pct",
            "action": "Exit position",
            "severity": severity,
            "grace_periods": grace_periods,
        }
    ]
    if severity != "kill":
        # schema requires >= 1 kill-severity entry regardless of what we're testing
        payload["thesis_data"]["what_can_kill_it"].append(
            {
                "label": "always-present manual kill (schema requires >= 1 kill entry)",
                "action": "Exit position",
                "severity": "kill",
                "manual_check": True,
            }
        )
    thesis = ThesisCreate.model_validate(payload)
    db = _Session()
    try:
        create_company(db, thesis)
    finally:
        db.close()


def _post_observation(company_id, period, period_end, metric_key, value):
    db = _Session()
    try:
        stmt = (
            pg_insert(Observation)
            .values(
                company_id=company_id,
                period=period,
                period_end=period_end,
                metric_key=metric_key,
                numeric_value=value,
                ingested_by="tester",
            )
            .on_conflict_do_update(
                index_elements=["company_id", "period", "metric_key"], set_={"numeric_value": value}
            )
        )
        db.execute(stmt)
        db.commit()
        return evaluate_observations(db, company_id, period)
    finally:
        db.close()


OPERATOR_CASES = [
    ("<", 18, 17.9, True),
    ("<", 18, 18.1, False),
    ("<=", 18, 18.0, True),
    ("<=", 18, 18.1, False),
    (">", 18, 18.1, True),
    (">", 18, 17.9, False),
    (">=", 18, 18.0, True),
    (">=", 18, 17.9, False),
    ("==", 18, 18.0, True),
    ("==", 18, 18.1, False),
    ("!=", 18, 18.1, True),
    ("!=", 18, 18.0, False),
]


@pytest.mark.parametrize("operator,threshold,observed,should_breach", OPERATOR_CASES)
def test_operator_breach_detection(db_conn, operator, threshold, observed, should_breach):
    safe_op = {"<": "LT", "<=": "LTE", ">": "GT", ">=": "GTE", "==": "EQ", "!=": "NE"}[operator]
    safe_val = str(observed).replace(".", "_")
    company_id = f"RE_{safe_op}_{safe_val}"
    _make_company(company_id, "operating_margin_pct", operator, threshold, "kill", grace_periods=1)
    proposals = _post_observation(company_id, "FY26Q1", "2026-06-30", "operating_margin_pct", observed)
    if should_breach:
        assert len(proposals) == 1
        assert proposals[0].proposed_status == "broken"
    else:
        assert proposals == []


def test_warn_severity_proposes_watch_closely_not_broken(db_conn):
    _make_company("RE_WARN_CO", "operating_margin_pct", "<", 18, "warn", grace_periods=1)
    proposals = _post_observation("RE_WARN_CO", "FY26Q1", "2026-06-30", "operating_margin_pct", 15.0)
    assert len(proposals) == 1
    assert proposals[0].proposed_status == "watch_closely"


def test_grace_periods_3_requires_three_consecutive_breaches(db_conn):
    _make_company("RE_GRACE3", "operating_margin_pct", "<", 18, "kill", grace_periods=3)
    assert _post_observation("RE_GRACE3", "FY26Q1", "2026-06-30", "operating_margin_pct", 15.0) == []
    assert _post_observation("RE_GRACE3", "FY26Q2", "2026-09-30", "operating_margin_pct", 15.0) == []
    fired = _post_observation("RE_GRACE3", "FY26Q3", "2026-12-31", "operating_margin_pct", 15.0)
    assert len(fired) == 1
    assert fired[0].proposed_status == "broken"


def test_grace_period_streak_resets_on_a_non_breaching_period(db_conn):
    _make_company("RE_RESET", "operating_margin_pct", "<", 18, "kill", grace_periods=2)
    assert _post_observation("RE_RESET", "FY26Q1", "2026-06-30", "operating_margin_pct", 15.0) == []
    assert _post_observation("RE_RESET", "FY26Q2", "2026-09-30", "operating_margin_pct", 20.0) == []  # not breached
    assert _post_observation("RE_RESET", "FY26Q3", "2026-12-31", "operating_margin_pct", 15.0) == []  # streak=1 again
    fired = _post_observation("RE_RESET", "FY26Q4", "2027-03-31", "operating_margin_pct", 15.0)  # streak=2
    assert len(fired) == 1


def test_missing_observation_is_not_a_breach(db_conn):
    _make_company("RE_MISSING", "operating_margin_pct", "<", 18, "kill", grace_periods=1)
    db = _Session()
    try:
        proposals = evaluate_observations(db, "RE_MISSING", "FY26Q1")
    finally:
        db.close()
    assert proposals == []


def test_repeated_post_same_period_does_not_duplicate_pending_proposal(db_conn):
    _make_company("RE_DEDUP", "operating_margin_pct", "<", 18, "kill", grace_periods=1)
    first = _post_observation("RE_DEDUP", "FY26Q1", "2026-06-30", "operating_margin_pct", 15.0)
    assert len(first) == 1
    second = _post_observation("RE_DEDUP", "FY26Q1", "2026-06-30", "operating_margin_pct", 15.0)
    assert second == []


def test_acceptance_criterion_margin_17_2_fires_18_5_does_not(db_conn):
    """BUILD_PLAN.md §10 P2 'done when', verbatim."""
    _make_company("RE_ACCEPT_FIRE", "operating_margin_pct", "<", 18, "kill", grace_periods=1)
    fired = _post_observation("RE_ACCEPT_FIRE", "FY26Q1", "2026-06-30", "operating_margin_pct", 17.2)
    assert len(fired) == 1
    assert fired[0].proposed_status == "broken"
    assert fired[0].state == "pending"

    _make_company("RE_ACCEPT_NOFIRE", "operating_margin_pct", "<", 18, "kill", grace_periods=1)
    not_fired = _post_observation("RE_ACCEPT_NOFIRE", "FY26Q1", "2026-06-30", "operating_margin_pct", 18.5)
    assert not_fired == []
