"""Evaluation metrics for the SFT tasks (BUILD_PLAN.md §7.6)."""
from typing import Any, Optional


def verdict_accuracy(predictions: list[Optional[str]], labels: list[str]) -> dict[str, Any]:
    """Exact-match accuracy plus a confusion matrix (labels x predictions).
    The confusion matrix - not just the accuracy scalar - is what lets you
    tell "confused watch_closely with broken" apart from "confused
    watch_closely with on_track" (§7.6: these are different failure modes)."""
    if len(predictions) != len(labels):
        raise ValueError("predictions and labels must be the same length")
    if not predictions:
        return {"accuracy": None, "n": 0, "confusion_matrix": {}}

    correct = sum(p == label for p, label in zip(predictions, labels))
    matrix: dict[str, dict[str, int]] = {}
    for pred, label in zip(predictions, labels):
        row = matrix.setdefault(label, {})
        key = pred if pred is not None else "(no prediction)"
        row[key] = row.get(key, 0) + 1

    return {"accuracy": correct / len(predictions), "n": len(predictions), "confusion_matrix": matrix}


def redline_recall(predicted: list[dict], actual: list[dict]) -> dict[str, Any]:
    """Did the model extract the same kill triggers the analyst wrote?
    Matched on (metric_key, operator, severity) - the exact threshold isn't
    required to match, since a recovered redline with a slightly different
    number is still a recovered redline, not a miss."""
    if not actual:
        return {"recall": None, "n": 0, "matched": 0}

    def _key(trigger: dict) -> tuple:
        return (trigger.get("metric_key"), trigger.get("operator"), trigger.get("severity"))

    predicted_keys = {_key(t) for t in predicted}
    matched = sum(1 for t in actual if _key(t) in predicted_keys)
    return {"recall": matched / len(actual), "n": len(actual), "matched": matched}


def reasoning_grounding(evidence_used: list[str], available_metric_keys: set[str]) -> dict[str, Any]:
    """Mechanical check: does every metric_key the model cited as evidence
    actually exist in the input it was given? Catches hallucinated numbers -
    it verifies the citation is real input, not that the cited value itself
    is correct."""
    hallucinated = [key for key in evidence_used if key not in available_metric_keys]
    return {
        "cited": list(evidence_used),
        "hallucinated": hallucinated,
        "grounded": len(hallucinated) == 0,
    }
