"""BUILD_PLAN.md §10 P3 acceptance criterion: a fired kill trigger cannot be
dismissed without a note, and the resulting status_events row has
override=TRUE. Plus §5 rules 1-3 more broadly.
"""
import copy
import json
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import ANALYST_NAME
from app.models import Observation, StatusEvent
from app.schemas.thesis import ThesisCreate
from app.services.audit import (
    AlreadyResolvedError,
    OverrideRequiresNoteError,
    close_outcome,
    resolve_proposal,
    submit_health_check,
)
from app.services.rule_engine import evaluate_observations
from app.services.scenarios import get_my_scenario
from app.services.versioning import create_company
from tests.conftest import TestSession as _Session

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"
_BASE_PAYLOAD = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _create_balu_forge():
    payload = copy.deepcopy(_BASE_PAYLOAD)
    db = _Session()
    try:
        thesis = ThesisCreate.model_validate(payload)
        create_company(db, thesis)
    finally:
        db.close()


def _fire_kill_trigger():
    """Creates BALU_FORGE and breaches its golden-fixture kill trigger
    (operating_margin_pct < 18), returning the resulting pending proposal."""
    _create_balu_forge()
    db = _Session()
    try:
        db.execute(
            pg_insert(Observation).values(
                company_id="BALU_FORGE",
                period="FY26Q1",
                period_end="2026-06-30",
                metric_key="operating_margin_pct",
                numeric_value=15.0,
                ingested_by="tester",
            )
        )
        db.commit()
        proposals = evaluate_observations(db, "BALU_FORGE", "FY26Q1")
    finally:
        db.close()
    assert len(proposals) == 1
    return proposals[0]


def test_reject_fired_kill_without_note_is_refused(db_conn):
    proposal = _fire_kill_trigger()
    db = _Session()
    try:
        with pytest.raises(OverrideRequiresNoteError):
            resolve_proposal(db, proposal.id, action="reject", verdict=None, note=None)
    finally:
        db.close()


def test_reject_fired_kill_with_note_is_an_override(db_conn):
    proposal = _fire_kill_trigger()
    db = _Session()
    try:
        resolved = resolve_proposal(
            db, proposal.id, action="reject", verdict=None, note="Transient FX effect, thesis intact."
        )
    finally:
        db.close()
    assert resolved.state == "rejected"

    db = _Session()
    try:
        scenario = get_my_scenario(db, "BALU_FORGE", ANALYST_NAME)
        events = db.scalars(select(StatusEvent).where(StatusEvent.company_id == "BALU_FORGE")).all()
    finally:
        db.close()
    assert scenario.status == "on_track"  # unchanged
    assert len(events) == 1
    assert events[0].override is True
    assert events[0].to_status == "on_track"


def test_accept_fired_kill_flips_status_without_override(db_conn):
    proposal = _fire_kill_trigger()
    db = _Session()
    try:
        resolved = resolve_proposal(db, proposal.id, action="accept", verdict=None, note=None)
    finally:
        db.close()
    assert resolved.state == "accepted"

    db = _Session()
    try:
        scenario = get_my_scenario(db, "BALU_FORGE", ANALYST_NAME)
        events = db.scalars(select(StatusEvent).where(StatusEvent.company_id == "BALU_FORGE")).all()
    finally:
        db.close()
    assert scenario.status == "broken"
    assert len(events) == 1
    assert events[0].override is False


def test_resolve_already_resolved_proposal_raises(db_conn):
    proposal = _fire_kill_trigger()
    db = _Session()
    try:
        resolve_proposal(db, proposal.id, action="accept", verdict=None, note=None)
    finally:
        db.close()

    db = _Session()
    try:
        with pytest.raises(AlreadyResolvedError):
            resolve_proposal(db, proposal.id, action="accept", verdict=None, note=None)
    finally:
        db.close()


def test_direct_health_check_override_requires_note(db_conn):
    _fire_kill_trigger()  # leaves an active pending fired-kill proposal
    db = _Session()
    try:
        with pytest.raises(OverrideRequiresNoteError):
            submit_health_check(db, "BALU_FORGE", "FY26Q1", "on_track", note="")
    finally:
        db.close()


def test_direct_health_check_override_with_note_succeeds(db_conn):
    _fire_kill_trigger()
    db = _Session()
    try:
        health = submit_health_check(
            db, "BALU_FORGE", "FY26Q1", "on_track", note="Overriding: one-off cost, margin recovers next quarter."
        )
    finally:
        db.close()
    assert health.verdict == "on_track"
    assert health.human_confirmed is True

    db = _Session()
    try:
        scenario = get_my_scenario(db, "BALU_FORGE", ANALYST_NAME)
    finally:
        db.close()
    assert scenario.status == "on_track"


def test_direct_health_check_without_active_kill_needs_no_special_handling(db_conn):
    _create_balu_forge()
    db = _Session()
    try:
        health = submit_health_check(db, "BALU_FORGE", "FY26Q1", "watch_closely", note="Watching margin trend.")
    finally:
        db.close()
    assert health.verdict == "watch_closely"


def test_close_outcome(db_conn):
    _create_balu_forge()
    db = _Session()
    try:
        company = close_outcome(db, "BALU_FORGE", "played_out", "Thesis played out over two years as expected.")
    finally:
        db.close()
    assert company.outcome == "played_out"
    assert company.exit_date is not None
