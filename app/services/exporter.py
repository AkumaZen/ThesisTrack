"""SFT dataset export (BUILD_PLAN.md §7).

Three task shapes from one internal representation (§7.2), serialized to
three formats (§7.5), gated by the eligibility filters in §7.3, split
company-disjoint and stratified by operating_model (§7.4).

Constitution rule 4: these filters are correctness requirements, not
preferences - never relaxed to raise row count.
"""
import hashlib
from datetime import date, datetime
from typing import Any, Iterator, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm.prompts import REVIEWER_PROMPT_VERSION, REVIEWER_SYSTEM_PROMPT
from app.models import Company, HealthCheck, KillTrigger, Observation, ThesisVersion, TrainingSplit
from app.schemas.thesis import ThesisData

VALID_TASKS = {"thesis_synthesis", "verdict", "redline_extraction"}
VALID_FORMATS = {"anthropic", "openai", "llama"}
VALID_SPLITS = {"train", "eval", "all"}

_EVAL_HOLDOUT_BUCKET = 1500  # ~15% of 10000

SYSTEM_PROMPTS = {
    "thesis_synthesis": (
        "You are an investment analyst. Given raw company data (classification and "
        "prior operating metrics), produce a structured 7-pillar investment thesis. "
        "Return JSON only."
    ),
    "verdict": REVIEWER_SYSTEM_PROMPT,
    "redline_extraction": (
        "You are an investment analyst. Given an investment thesis narrative, extract "
        "the structured invalidation triggers (kill switches) it implies. Return JSON only."
    ),
}


def _to_float(value) -> Optional[float]:
    return float(value) if value is not None else None


def _hash_split(company_id: str) -> str:
    digest = int(hashlib.sha256(company_id.encode("utf-8")).hexdigest(), 16)
    return "eval" if (digest % 10000) < _EVAL_HOLDOUT_BUCKET else "train"


def ensure_split_assignments(db: Session) -> None:
    """Assigns any company missing a training_splits row. Deterministic on
    first assignment (hash of company_id); the row itself is then the
    source of truth so a later manual override survives future exports."""
    company_ids = set(db.scalars(select(Company.company_id)).all())
    existing = set(db.scalars(select(TrainingSplit.company_id)).all())
    for company_id in company_ids - existing:
        db.add(TrainingSplit(company_id=company_id, split=_hash_split(company_id)))
    db.commit()


def _company_ids_for_split(db: Session, split: str) -> set[str]:
    ensure_split_assignments(db)
    stmt = select(TrainingSplit.company_id)
    if split != "all":
        stmt = stmt.where(TrainingSplit.split == split)
    return set(db.scalars(stmt).all())


def _period_end_for(db: Session, company_id: str, period: str) -> Optional[date]:
    return db.scalar(
        select(Observation.period_end).where(
            Observation.company_id == company_id, Observation.period == period
        )
    )


def _thesis_synthesis_rows(db: Session, company_ids: set[str]) -> Iterator[dict[str, Any]]:
    if not company_ids:
        return
    versions = db.scalars(
        select(ThesisVersion).where(ThesisVersion.company_id.in_(company_ids))
    ).all()
    for version in versions:
        try:
            ThesisData.model_validate(version.thesis_data)
        except Exception:
            continue  # rule 3: must pass schema validation

        company = db.get(Company, version.company_id)
        # "Raw company data" input, honestly limited by the schema: classification
        # plus whatever was observed before this version was authored. This
        # platform has no filings/concall text store, so that's the real proxy
        # available - not a stand-in for it.
        prior_observations = db.scalars(
            select(Observation).where(
                Observation.company_id == version.company_id,
                Observation.period_end < version.authored_at,
            )
        ).all()
        yield {
            "task": "thesis_synthesis",
            "company_id": version.company_id,
            "input": {
                "company_name": company.name,
                "operating_model": company.operating_model,
                "currency": company.currency,
                "as_of": version.authored_at.date().isoformat(),
                "prior_observations": [
                    {"period": o.period, "metric_key": o.metric_key, "value": _to_float(o.numeric_value) or o.text_value}
                    for o in prior_observations
                ],
            },
            "output": version.thesis_data,
            "metadata": {"version_no": version.version_no, "authored_at": version.authored_at.isoformat()},
        }


def _verdict_rows(db: Session, company_ids: set[str], include_open: bool) -> Iterator[dict[str, Any]]:
    if not company_ids:
        return
    checks = db.scalars(
        select(HealthCheck).where(HealthCheck.company_id.in_(company_ids))
    ).all()
    for hc in checks:
        # rule 1: never train on unreviewed model output
        if hc.source == "ai_proposed" and not hc.human_confirmed:
            continue
        # rule 3: >= 3 reasoning steps
        if not hc.reasoning_chain or len(hc.reasoning_chain) < 3:
            continue

        company = db.get(Company, hc.company_id)
        # rule 4: default to resolved-outcome companies only for this task
        if not include_open and company.outcome == "open":
            continue

        version = db.get(ThesisVersion, hc.version_id)
        period_end = _period_end_for(db, hc.company_id, hc.period)
        # rule 2, the leakage check: the version must predate the period it's
        # reasoning about. No period_end on record means we can't verify it -
        # exclude rather than assume it's safe.
        if period_end is None or version.authored_at.date() >= period_end:
            continue

        triggers = db.scalars(
            select(KillTrigger).where(KillTrigger.version_id == hc.version_id)
        ).all()
        rule_engine_findings = [
            {
                "trigger": t.label,
                "metric_key": t.metric_key,
                "threshold": _to_float(t.threshold),
                "severity": t.severity,
            }
            for t in triggers
        ]

        yield {
            "task": "verdict",
            "company_id": hc.company_id,
            "input": {
                "thesis_data": version.thesis_data,
                "period": hc.period,
                "rule_engine_findings": rule_engine_findings,
            },
            "output": {
                "verdict": hc.verdict,
                "reasoning_chain": hc.reasoning_chain,
                "confidence": (hc.evidence or {}).get("confidence"),
            },
            "metadata": {
                "period": hc.period,
                "authored_at": version.authored_at.isoformat(),
                "period_end": period_end.isoformat(),
                "health_check_id": hc.id,
                "confidence": (hc.evidence or {}).get("confidence"),
            },
        }


def _redline_extraction_rows(db: Session, company_ids: set[str]) -> Iterator[dict[str, Any]]:
    if not company_ids:
        return
    versions = db.scalars(
        select(ThesisVersion).where(ThesisVersion.company_id.in_(company_ids))
    ).all()
    for version in versions:
        triggers = db.scalars(
            select(KillTrigger).where(KillTrigger.version_id == version.version_id)
        ).all()
        if not triggers:
            continue
        thesis_data = version.thesis_data or {}
        narrative = " ".join(
            [
                thesis_data.get("the_business", {}).get("what_it_does", ""),
                *thesis_data.get("the_growth_engine", []),
                thesis_data.get("the_big_change", {}).get("summary", ""),
                *thesis_data.get("why_we_believe_it", []),
            ]
        ).strip()
        if not narrative:
            continue

        yield {
            "task": "redline_extraction",
            "company_id": version.company_id,
            "input": {"thesis_narrative": narrative},
            "output": [
                {
                    "label": t.label,
                    "metric_key": t.metric_key,
                    "operator": t.operator,
                    "threshold": _to_float(t.threshold),
                    "severity": t.severity,
                    "action": t.action,
                    "grace_periods": t.grace_periods,
                    "manual_check": t.manual_check,
                }
                for t in triggers
            ],
            "metadata": {"version_no": version.version_no, "authored_at": version.authored_at.isoformat()},
        }


def _rows_for_task(db: Session, task: str, company_ids: set[str], include_open: bool) -> list[dict[str, Any]]:
    if task == "thesis_synthesis":
        return list(_thesis_synthesis_rows(db, company_ids))
    if task == "verdict":
        return list(_verdict_rows(db, company_ids, include_open))
    if task == "redline_extraction":
        return list(_redline_extraction_rows(db, company_ids))
    raise ValueError(f"unknown task {task!r}")


def _serialize(row: dict[str, Any], fmt: str) -> dict[str, Any]:
    system_prompt = SYSTEM_PROMPTS[row["task"]]
    user_content = row["input"] if isinstance(row["input"], str) else row["input"]
    metadata = {
        **row["metadata"],
        "task": row["task"],
        "company_id": row["company_id"],
        "prompt_version": REVIEWER_PROMPT_VERSION,
    }

    if fmt == "anthropic":
        return {
            "system": system_prompt,
            "messages": [
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": row["output"]},
            ],
            "metadata": metadata,
        }
    if fmt == "openai":
        return {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": row["output"]},
            ],
            "metadata": metadata,
        }
    if fmt == "llama":
        return {
            "prompt": f"<s>[INST] <<SYS>>\n{system_prompt}\n<</SYS>>\n\n{user_content} [/INST]",
            "completion": row["output"],
            "metadata": metadata,
        }
    raise ValueError(f"unknown format {fmt!r}")


def export_rows(
    db: Session, task: str, fmt: str, split: str = "all", include_open: bool = False
) -> list[dict[str, Any]]:
    if task not in VALID_TASKS:
        raise ValueError(f"task must be one of {sorted(VALID_TASKS)}")
    if fmt not in VALID_FORMATS:
        raise ValueError(f"format must be one of {sorted(VALID_FORMATS)}")
    if split not in VALID_SPLITS:
        raise ValueError(f"split must be one of {sorted(VALID_SPLITS)}")

    company_ids = _company_ids_for_split(db, split)
    rows = _rows_for_task(db, task, company_ids, include_open)
    return [_serialize(r, fmt) for r in rows]


def eval_split_verdict_rows(db: Session, include_open: bool = False) -> list[dict[str, Any]]:
    """Pre-serialization 'verdict' task rows for the eval-split companies -
    the input the eval harness (eval/run_eval.py) actually needs, without
    reaching into this module's underscore-prefixed internals."""
    company_ids = _company_ids_for_split(db, "eval")
    return list(_verdict_rows(db, company_ids, include_open))


def export_stats(db: Session, split: str = "all", include_open: bool = False) -> dict[str, Any]:
    ensure_split_assignments(db)
    company_ids = _company_ids_for_split(db, split)

    row_counts: dict[str, int] = {}
    class_balance: dict[str, dict[str, int]] = {}
    by_operating_model: dict[str, dict[str, int]] = {}
    leakage_violations = 0

    companies_by_id = {c.company_id: c for c in db.scalars(select(Company)).all()}

    for task in VALID_TASKS:
        rows = _rows_for_task(db, task, company_ids, include_open)
        row_counts[task] = len(rows)

        if task == "verdict":
            balance: dict[str, int] = {}
            for r in rows:
                v = r["output"]["verdict"]
                balance[v] = balance.get(v, 0) + 1
            class_balance[task] = balance

        model_counts: dict[str, int] = {}
        for r in rows:
            company = companies_by_id.get(r["company_id"])
            key = company.operating_model if company else "unknown"
            model_counts[key] = model_counts.get(key, 0) + 1
        by_operating_model[task] = model_counts

    # Leakage check across ALL verdict-eligible rows regardless of the include_open
    # filter, since this is a correctness audit, not a dataset-shape query.
    for r in _verdict_rows(db, _company_ids_for_split(db, "all"), include_open=True):
        authored_at = datetime.fromisoformat(r["metadata"]["authored_at"]).date()
        period_end = date.fromisoformat(r["metadata"]["period_end"])
        if authored_at >= period_end:
            leakage_violations += 1

    split_counts = {
        s: len(_company_ids_for_split(db, s)) for s in ("train", "eval")
    }

    return {
        "row_count": sum(row_counts.values()),
        "row_count_by_task": row_counts,
        "class_balance": class_balance,
        "by_operating_model": by_operating_model,
        "leakage_violations": leakage_violations,
        "companies_by_split": split_counts,
    }
