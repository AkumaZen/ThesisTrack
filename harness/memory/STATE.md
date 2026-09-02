# STATE
Phase: P6 — Export + eval (not started). P0-P5 complete and verified.
Done:
  - Harness bootstrapped (68ffdec); 6 evolve cycles (evolutions/2026-09-02T-p0..p4.md, 2026-09-03T-p5.md)
  - P0 (2293665/a462e34) 11 tests, P1 (61b67b3/844a09d) +6, P2 (829d473) +18,
    P3 (6fe172b/7c48065) +11, P4 (6b3594e/5057000) +7, P5 (e8b5235) +2
    backend regression tests -> 55 tests total, all green
  - P5 dashboard verified in a real browser end-to-end (chrome-devtools-axi):
    create via JSON tab, dynamic metrics field proven live (inserted a
    metric_definitions row, watched it appear with zero frontend edits),
    observation posting, override-requires-note enforced through the UI,
    badges on header + card confirmed
In flight: nothing
Blocked: nothing for P6 specifically, but see below — two things need the
  human before this session goes further on anything outside BUILD_PLAN.md's
  scope
Last evolution: harness/journal/evolutions/2026-09-03T-p5.md — one gotcha
  (Dockerfile COPY list didn't track new served dirs), two open questions
  raised (not resolved)

## Needs the human (harness/memory/open-questions.md has full detail)
1. A `TO DO` file appeared in the repo root (untracked, not committed) with
   new requests: push to GitHub as "ThesisTrack", multi-user login with
   read/write RBAC for two named users, more form coverage, simpler UI.
   These go beyond BUILD_PLAN.md §0's v1 scope (single-analyst API key,
   "not before" multi-user) — not started, needs explicit confirmation.
2. A `.production.env` file appeared with a live Aiven Postgres credential.
   Never staged for commit (`.gitignore` hardened to `*.env` regardless).
   Not used for anything. Needs the human to say whether/when this session
   should actually deploy against it.

Next action: BUILD_PLAN.md §7 + §10 P6 acceptance criterion. Build:
  - `training_splits` table (new migration — not in the P0 schema; §7.4
    needs it to keep split assignment stable across export runs)
  - app/services/exporter.py: three task shapes (thesis_synthesis, verdict,
    redline_extraction) from one internal representation; three format
    serializers (anthropic/openai/llama) per §7.5, tagging
    REVIEWER_PROMPT_VERSION (already exists in app/llm/prompts.py) into
    each row's metadata
  - Eligibility filters in code, exactly per §7.3: source != 'ai_proposed'
    OR human_confirmed; authored_at < period_end (the leakage check);
    passes schema validation + >= 3 reasoning steps; verdict tasks default
    include_open=false
  - Company-disjoint splits (§7.4), stratified by operating_model, stored
    in training_splits so they're stable across runs
  - Routers: GET /export-training-data (streams JSONL), GET
    /export-training-data/stats (row count per task, class balance, by
    operating_model, leakage check)
  - eval/ dir: run_eval.py, metrics.py (verdict accuracy + confusion
    matrix, redline recall, reasoning grounding check), baseline.py
    (frontier model via the existing app/llm/client.py adapter)
  Concrete test target (§10 + §11): stats endpoint reports zero leakage
  violations, split is company-disjoint; property test asserting no
  exported row has authored_at >= period_end.
