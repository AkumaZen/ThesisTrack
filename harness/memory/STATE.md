# STATE
Phase: P4 — AI reviewer (not started). P0-P3 complete and verified.
Done:
  - Harness bootstrapped (68ffdec); 4 evolve cycles (evolutions/2026-09-02T-p0/p1/p2/p3.md)
  - P0 (2293665/a462e34) 11 tests, P1 (61b67b3/844a09d) +6, P2 (829d473) +18,
    P3 (6fe172b) +11 -> 46 tests total, all green, all also verified against
    the live docker-compose container at each phase boundary
  - harness/skills/add-api-endpoint.md (updated at P3: point 7 says use
    tests.conftest.TestSession, don't redefine an engine per test file) —
    read it before writing P4's endpoint + tests
In flight: nothing
Blocked: nothing
Last evolution: harness/journal/evolutions/2026-09-02T-p3.md — UPDATEd
  add-api-endpoint.md (a re-derivation signature: 3 test files each
  independently redefined a DB engine before being consolidated)
Next action: BUILD_PLAN.md §5 (AI reviewer prompt block) + §10 P4 acceptance
  criterion. Build:
  - app/llm/client.py: LLMClient.complete_json() interface (BUILD_PLAN.md
    §5: "one adapter interface... so the provider is swappable"). A
    FakeLLMClient for deterministic tests (canned valid/malformed JSON) and
    a real provider client gated behind an env var (e.g. ANTHROPIC_API_KEY)
    — default to Fake if unset so tests never need live network/a key.
  - app/services/ai_reviewer.py: assemble the prompt from current thesis +
    last 4 periods of observations + rule-engine findings (reuse
    rule_engine's trigger_evaluations), call complete_json(), parse with
    retry, write status_proposals(source='ai_proposed', model_name=...) —
    NEVER touch companies.status (constitution rule 3, not just a
    BUILD_PLAN rule). Malformed/unparseable response after retries must
    fail safe: no proposal row written, not a garbage one.
  - Log every call's model name, prompt hash, and raw response to disk
    (BUILD_PLAN.md §5) — a logs/ dir, gitignored.
  - Router: POST /companies/{id}/ai-review -> app/routers/health.py or a
    new ai_review.py; follows add-api-endpoint.md.
  Concrete test target (§10): /ai-review returns a grounded proposal,
  companies.status is provably unchanged (assert before/after equality, not
  just "no crash"), and a malformed model response fails safe.
