# STATE
Phase: P2 — Rule engine (not started). P0 and P1 complete and verified.
Done:
  - Harness bootstrapped (commit 68ffdec); H_min, then 2 evolve cycles
    (harness/journal/evolutions/2026-09-02T-p0.md, -p1.md)
  - P0: schema + contracts (commit 2293665, evolve a462e34) — 11 tests
  - P1: core API — company CRUD, versioning, observations, taxonomy, metrics
    (commit 61b67b3) — 17 tests total, verified against both TestClient and
    the live docker-compose container
  - harness/skills/add-api-endpoint.md and
    harness/knowledge/sqlalchemy-fastapi-notes.md exist — read them before
    writing P2's rule-engine-triggered endpoint work
In flight: nothing
Blocked: nothing
Last evolution: harness/journal/evolutions/2026-09-02T-p1.md — CREATEd one
  skill (add-api-endpoint.md, pattern recurred 3x) and one knowledge doc
  (sqlalchemy-fastapi-notes.md); no prompt/sub-agent edits warranted
Next action: BUILD_PLAN.md §5 (status engine) and §10 P2 acceptance
  criterion — build app/services/rule_engine.py: evaluate kill_triggers for
  a version against the period's observations posted in
  POST /companies/{id}/observations (app/routers/observations.py — this is
  where ADR-006's deferred hook goes), writing trigger_evaluations (grace
  periods = consecutive breaching periods, read back ordered by period_end)
  and status_proposals (fired kill -> proposed_status=broken,
  source=rule_engine; fired warn -> watch_closely). Table-driven tests per
  §11: all six operators, both severities, grace_periods of 1 and 3, and a
  missing observation must NOT count as a breach (data gap, not failure).
  Concrete test: operating_margin_pct=17.2 against an 18% kill trigger ->
  pending 'broken' proposal; 18.5 -> no proposal.
