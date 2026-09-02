# Decisions (append-only ADR log)

## ADR-001: Balu Forge golden fixture is an adapted payload, not the raw original-spec sample
BUILD_PLAN.md's P0 acceptance criterion requires "the Balu Forge sample payload
from the spec" to validate clean, but the platform's own deviations (§1) change
the shape that payload must have. The user supplied the original spec's raw
sample directly in chat (human-readable `operating_model: "Factory"`,
`status: "On Track"`, `model_specific_metrics` as display strings like
`"68%"`, `what_can_kill_it` as `{trigger, prescribed_action}` sentences, no
`classification.currency`).
`tests/fixtures/balu_forge.json` is that payload adapted per BUILD_PLAN.md §1
and §4: `classification.currency: "INR"` added; `model_specific_metrics`
re-keyed to the `metric_definitions` registry's canonical keys
(`capacity_utilization_pct`, `operating_margin_pct`, `working_capital_days`)
with numeric values; `what_can_kill_it` restructured into §1.1's normalized
shape — the margin trigger got full structured fields (this is almost
verbatim BUILD_PLAN.md §1.1's own worked example), the facility-delay trigger
became `manual_check: true` since "delayed > 6 months" isn't a registry
metric; `operating_model`/`status` lowercased to the DB enum values.
Everything else (the_business narrative, the_growth_engine, the_big_change,
proof_points.hard_evidence, why_we_believe_it, health_check, references) is
unchanged from what the user supplied.
Evidence: `tests/fixtures/balu_forge.json`; `app/schemas/thesis.py` (the
Classification/status normalizers implementing the enum-casing rule);
`tests/test_contract.py::test_golden_fixture_validates_clean` passing against
this adapted fixture.

## ADR-002: `why_we_believe_it` stays a plain string array; Premise/Conclusion is a prefix check
BUILD_PLAN.md §1 lists five specific structural deviations from the original
spec (kill triggers, metrics-as-time-series, versioning, metric registry,
taxonomy/units) — `why_we_believe_it` isn't among them, and the original
sample already ships it as prose strings prefixed "Premise 1:", "Inference:",
"Conclusion:". §4's validation rule ("contains at least one Premise and
exactly one Conclusion") is implemented as a case-insensitive prefix check on
those strings, not a structured `type` field.
Evidence: `app/schemas/thesis.py::ThesisData._why_we_believe_it_shape`.

## ADR-003: `health_check` pillar in thesis_data is narrative only; the health_checks table is the operational ledger
The original sample's `health_check` pillar (`latest_quarter_review` +
`historical_checks`) is analyst-authored narrative carried in the versioned
`thesis_data` JSONB, same as every other pillar. It is not the same thing as
the `health_checks` DB table from BUILD_PLAN.md §2/§5, which is the
rule-engine/AI/human verdict ledger populated over time via
`POST /companies/{id}/health-check` (P3). The two aren't reconciled or
deduplicated — this matches §1.2's general pattern of JSONB holding an
authored/denormalized view while a normalized table is the operational
source of truth.
Evidence: `app/schemas/thesis.py::HealthCheckPillar`; BUILD_PLAN.md §2
`health_checks` table, §5 status engine, §6 `POST /companies/{id}/health-check`.

## ADR-004: P0 migration is raw SQL via op.execute(), not SQLAlchemy ORM models
`app/models.py` (SQLAlchemy ORM) is deferred to P1. BUILD_PLAN.md §10 lists P0
as "migrations, seeds, Pydantic models, exported JSON Schema" — it does not
require an ORM layer, and the generated `search_tsv` column plus the
append-only trigger/function aren't well-served by Alembic's `op.*` DSL
anyway. The migration pastes BUILD_PLAN.md §2's DDL near-verbatim via
`op.execute()`, verified to actually apply (including the generated column)
against real Postgres 16 — no tsvector fallback was needed.
Evidence: `migrations/versions/6964238e12f2_p0_schema.py`;
`tests/test_schema_migration.py` passing against a real database.
