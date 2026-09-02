"""AI reviewer prompt (BUILD_PLAN.md §5), as a constant with a version tag —
the same tag gets written into every export row's metadata in P6 (§7.5)."""
import json
from typing import Any, Optional

REVIEWER_PROMPT_VERSION = "v1"

REVIEWER_SYSTEM_PROMPT = (
    "You are an investment thesis auditor. You are given a written thesis and the "
    "latest verified operating data. Decide whether the thesis is intact. You must "
    "reason only from the data provided; if the data does not settle a question, say "
    "so and lower your confidence rather than assuming. Return JSON only."
)


def build_reviewer_user_prompt(
    company_name: str,
    broad_industry: str,
    specific_niche: str,
    operating_model: str,
    authored_at: str,
    thesis_data: dict[str, Any],
    period: str,
    metrics: list[dict],
    narrative: Optional[str],
    rule_engine_findings: list[dict],
) -> str:
    redlines = [t.get("label") for t in thesis_data.get("what_can_kill_it", [])]
    return (
        f"COMPANY: {company_name} | {broad_industry} > {specific_niche} | {operating_model}\n"
        f"THESIS (as written on {authored_at}):\n"
        f"  The Business: {thesis_data.get('the_business', {}).get('what_it_does', '')}\n"
        f"  The Big Change: {thesis_data.get('the_big_change', {}).get('summary', '')}\n"
        f"  Why We Believe It: {thesis_data.get('why_we_believe_it', [])}\n"
        f"  Invalidation Redlines: {redlines}\n"
        f"NEW EVIDENCE ({period}):\n"
        f"  metrics: {json.dumps(metrics)}\n"
        f"  narrative: {narrative or ''}\n"
        f"RULE ENGINE FINDINGS: {json.dumps(rule_engine_findings)}\n\n"
        "Return: {\"verdict\": \"on_track|watch_closely|broken\", \"confidence\": 0.0-1.0, "
        "\"reasoning_chain\": [\"Premise 1: ...\",\"Premise 2: ...\",\"Inference: ...\",\"Conclusion: ...\"], "
        "\"evidence_used\": [\"metric_key\", ...], \"unresolved_questions\": [\"...\"]}"
    )
