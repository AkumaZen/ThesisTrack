"""Eval harness entry point (BUILD_PLAN.md §7.6). Run against the eval
split (company-disjoint from training, §7.4):

    python -m eval.run_eval

The `run()` function is the testable unit; `main()` is a thin CLI wrapper.
"""
import json

from sqlalchemy.orm import Session

from app.llm.client import LLMClient
from app.services.exporter import eval_split_verdict_rows
from eval.baseline import predict_verdict
from eval.metrics import reasoning_grounding, verdict_accuracy


def run(db: Session, llm_client: LLMClient, include_open: bool = False) -> dict:
    rows = eval_split_verdict_rows(db, include_open=include_open)

    predictions = []
    labels = []
    grounding_results = []
    for row in rows:
        pred = predict_verdict(llm_client, row)
        predictions.append(pred["verdict"])
        labels.append(row["output"]["verdict"])
        available = {f["metric_key"] for f in row["input"].get("rule_engine_findings", []) if f.get("metric_key")}
        grounding_results.append(reasoning_grounding(pred["evidence_used"], available))

    accuracy = verdict_accuracy(predictions, labels)
    grounded_rate = (
        sum(1 for g in grounding_results if g["grounded"]) / len(grounding_results) if grounding_results else None
    )

    return {
        "n_eval_rows": len(rows),
        "verdict_accuracy": accuracy,
        "reasoning_grounded_rate": grounded_rate,
    }


def main() -> None:
    from app.db import SessionLocal
    from app.llm.client import get_llm_client

    db = SessionLocal()
    try:
        report = run(db, get_llm_client())
    finally:
        db.close()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
