# STATE
Phase: P3 — Human verdicts + audit (not started). P0, P1, P2 complete and verified.
Done:
  - Harness bootstrapped (68ffdec); 3 evolve cycles (evolutions/2026-09-02T-p0/p1/p2.md)
  - P0: schema + contracts (2293665, evolve a462e34) — 11 tests
  - P1: core API (61b67b3, evolve 844a09d) — +6 tests (17 total)
  - P2: rule engine (829d473) — +18 tests (35 total). app/services/rule_engine.py
    evaluates kill_triggers on every POST /observations, writes
    trigger_evaluations + pending status_proposals (fired kill->broken,
    fired warn->watch_closely). Grace-period streak resets on thesis
    amendment (ADR-008); dedup via evidence.trigger_id (ADR-009, since
    status_proposals has no trigger_id FK).
  - harness/skills/add-api-endpoint.md reused successfully in P2 — trust it
    for P3's new endpoints too
In flight: nothing
Blocked: nothing
Last evolution: harness/journal/evolutions/2026-09-02T-p2.md — clean window,
  no edits (nothing broken to refine)
Next action: BUILD_PLAN.md §5 rules 1-3 + §6 + §10 P3 acceptance criterion.
  Build:
  - POST /companies/{id}/health-check (also accept PUT): human types a
    verdict directly for a period. Writes health_checks(source=manual,
    human_confirmed=true), updates companies.status + last_reviewed,
    writes status_events.
  - POST /proposals/{id}/resolve: {action: accept|reject, verdict?, note}.
    Accepting writes health_checks(human_confirmed=true) and flips status.
  - GET /proposals?state=pending: review queue across all companies.
  - Override rule (§5 rule 2, the important one): a fired KILL-severity
    proposal (proposed_status='broken', source='rule_engine') cannot be
    dismissed/overridden without a non-empty resolution_note; the resulting
    status_events row must have override=TRUE. "Every resolution writes a
    status_events row" (§5 diagram) — always write one, not just on override.
  - POST /companies/{id}/outcome: close the thesis (played_out/invalidated/
    exited_early + retrospective note). Needed by P6's export eligibility
    filter #4 (prefer resolved outcomes) — build it now even though §10
    doesn't list it explicitly under P3.
  Concrete test target (§10): a fired kill trigger cannot be dismissed
  without a note, and the resulting status_events row has override=TRUE.
