# STATE
Phase: P1 — Core API (not started). P0 complete and verified.
Done:
  - Harness bootstrapped (harness: H_min bootstrap, commit 68ffdec)
  - P0: full BUILD_PLAN.md §2 schema + §3 metric seed applied via one raw-SQL
    Alembic migration (migrations/versions/6964238e12f2_p0_schema.py),
    verified against real Postgres 16 (commit 2293665)
  - ThesisCreate Pydantic contract (app/schemas/thesis.py) implementing every
    §4 validation rule; contracts/thesis.schema.json generated from it
  - Golden fixture tests/fixtures/balu_forge.json (adapted from the
    user-supplied original-spec sample — see decisions.md ADR-001..003)
  - 11/11 tests passing (tests/test_contract.py, tests/test_schema_migration.py)
  - docker-compose (postgres:16 on host port 55432 + FastAPI /health) builds
    and runs end-to-end
In flight: nothing
Blocked: nothing
Last evolution: harness/journal/evolutions/2026-09-02T-p0.md — one gotcha
  logged (port 5432 collision), one skill created (skills/bin/evolve.sh),
  no prompt/sub-agent edits warranted (nothing recurred yet)
Next action: read BUILD_PLAN.md §6 and §9 (app/models.py, routers/,
  services/versioning.py), start P1 — SQLAlchemy ORM models, then
  POST/GET /companies, PUT /thesis (versioning), POST /observations,
  GET /taxonomy, GET /metrics. P1 "done when": create a company, post three
  quarters of observations, amend the thesis twice, retrieve a version diff —
  all via HTTP, all covered by tests.
