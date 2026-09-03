"""Frontier-model baseline for the eval harness (BUILD_PLAN.md §7.6):
"a well-prompted frontier model on the identical eval set. If the fine-tune
doesn't clear this, don't ship it."
"""
from app.llm.client import LLMClient, LLMResponseError
from app.llm.prompts import REVIEWER_SYSTEM_PROMPT


def predict_verdict(llm_client: LLMClient, row: dict) -> dict:
    """row is one internal-representation 'verdict' task row (pre-serialization
    shape from app.services.exporter: {"input": {...}, "output": {...}})."""
    user_prompt = (
        f"THESIS: {row['input']['thesis_data']}\n"
        f"PERIOD: {row['input'].get('period')}\n"
        f"RULE ENGINE FINDINGS: {row['input']['rule_engine_findings']}\n\n"
        'Return: {"verdict": "on_track|watch_closely|broken", '
        '"reasoning_chain": ["Premise 1: ...", "Conclusion: ..."], "evidence_used": ["metric_key", ...]}'
    )
    try:
        response = llm_client.complete_json(REVIEWER_SYSTEM_PROMPT, user_prompt)
    except LLMResponseError:
        return {"verdict": None, "reasoning_chain": [], "evidence_used": []}

    return {
        "verdict": response.get("verdict"),
        "reasoning_chain": response.get("reasoning_chain", []),
        "evidence_used": response.get("evidence_used", []),
    }
