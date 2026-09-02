"""P0 acceptance criterion: the Balu Forge sample payload validates clean."""
import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.export_contract import CONTRACT_PATH
from app.schemas.thesis import ThesisCreate

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "balu_forge.json"


@pytest.fixture
def golden_payload():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _context(payload: dict, registry: dict) -> dict:
    return {"metric_registry": registry, "operating_model": payload["classification"]["operating_model"]}


def test_golden_fixture_validates_clean(golden_payload, metric_registry):
    thesis = ThesisCreate.model_validate(golden_payload, context=_context(golden_payload, metric_registry))
    assert thesis.company_id == "BALU_FORGE"
    assert thesis.classification.operating_model == "factory"


def test_revenue_split_must_sum_to_100(golden_payload):
    bad = copy.deepcopy(golden_payload)
    bad["thesis_data"]["the_business"]["revenue_split"][0]["share_pct"] = 10
    with pytest.raises(ValidationError, match="revenue_split"):
        ThesisCreate.model_validate(bad)


def test_unknown_metric_key_rejected(golden_payload, metric_registry):
    bad = copy.deepcopy(golden_payload)
    bad["thesis_data"]["proof_points"]["model_specific_metrics"]["not_a_real_metric"] = 1
    with pytest.raises(ValidationError, match="not_a_real_metric"):
        ThesisCreate.model_validate(bad, context=_context(bad, metric_registry))


def test_metric_key_from_wrong_operating_model_rejected(golden_payload, metric_registry):
    bad = copy.deepcopy(golden_payload)
    bad["thesis_data"]["proof_points"]["model_specific_metrics"]["arr"] = 1000  # subscription-only metric
    with pytest.raises(ValidationError, match="arr"):
        ThesisCreate.model_validate(bad, context=_context(bad, metric_registry))


def test_missing_conclusion_rejected(golden_payload):
    bad = copy.deepcopy(golden_payload)
    bad["thesis_data"]["why_we_believe_it"] = [
        e for e in bad["thesis_data"]["why_we_believe_it"] if not e.startswith("Conclusion")
    ]
    with pytest.raises(ValidationError, match="Conclusion"):
        ThesisCreate.model_validate(bad)


def test_company_id_pattern_rejected(golden_payload):
    bad = copy.deepcopy(golden_payload)
    bad["company_id"] = "bad id!"
    with pytest.raises(ValidationError):
        ThesisCreate.model_validate(bad)


def test_no_kill_severity_rejected(golden_payload):
    bad = copy.deepcopy(golden_payload)
    for trigger in bad["thesis_data"]["what_can_kill_it"]:
        trigger["severity"] = "warn"
    with pytest.raises(ValidationError, match="severity"):
        ThesisCreate.model_validate(bad)


def test_markdown_wrapped_url_is_stripped(golden_payload):
    good = copy.deepcopy(golden_payload)
    good["thesis_data"]["references"][0]["url"] = (
        "[Investor Presentation](https://api.dashboard.internal/docs/presentation.pdf)"
    )
    thesis = ThesisCreate.model_validate(good)
    assert thesis.thesis_data.references[0].url == "https://api.dashboard.internal/docs/presentation.pdf"


def test_exported_json_schema_is_current():
    on_disk = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    assert on_disk == ThesisCreate.model_json_schema()
