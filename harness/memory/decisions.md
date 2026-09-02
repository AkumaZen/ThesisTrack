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

## ADR-005: taxonomy resolution on company creation is lookup-only, never auto-create
BUILD_PLAN.md §1.5 controls taxonomy specifically to stop free text; silently
creating a `broad_industries`/`specific_niches` row on an unrecognized name at
company-creation time would defeat that. `POST /companies` looks up both by
name and returns 422 naming the missing one if either isn't found.
`broad_industries` is seed-managed (`seeds/taxonomy.sql` — no create endpoint
exists in §6); `specific_niches` has the explicit propose path,
`POST /taxonomy/niches`.
Evidence: `app/services/versioning.py::_resolve_taxonomy`;
`tests/test_api_companies.py::test_create_company_rejects_unknown_taxonomy`.

## ADR-006: rule-engine hook on POST /observations deferred to P2
BUILD_PLAN.md §6's endpoint table says this route "triggers rule engine
synchronously; returns any new proposals" — but §10 explicitly scopes the
rule engine itself to P2, and P1's acceptance criterion only requires posting
observations via HTTP, not proposal generation. P1's implementation persists
observations (upsert per `(company_id, period, metric_key)`) and validates
`metric_key` against the registry; P2 adds the synchronous rule-engine call
into this same endpoint without changing its request/response shape for the
fields already used by P1's tests.
Evidence: `app/routers/observations.py` (comment at the return statement).

## ADR-007: thesis amendment payload is {thesis_data, change_note} only — classification isn't re-submitted per version
`classification` (broad_industry, specific_niche, operating_model, currency)
lives on the `companies` row, set once at creation; only `thesis_data` (the
pillars) is versioned in `thesis_versions`. `PUT /companies/{id}/thesis`
therefore takes `ThesisAmend {thesis_data, change_note}`, not a full
`ThesisCreate` — there's no schema table column for classification-per-version,
and BUILD_PLAN.md never describes reclassifying a company mid-thesis.
Evidence: `app/schemas/company.py::ThesisAmend`;
`app/routers/companies.py::put_thesis`.

## ADR-008: grace-period continuity is scoped to kill_triggers.id, not the redline's meaning across amendments
BUILD_PLAN.md §5 rule 4 says to track consecutive breaches "by reading back
trigger_evaluations ordered by period_end" but doesn't say what happens when
a thesis amendment changes a trigger's threshold or removes/re-adds it.
Since `kill_triggers` rows belong to a specific `version_id` (a new row with
a new `id` is written on every amendment per §1.3's append-only versioning),
a breach streak naturally resets to zero when the thesis is amended — there
is no prior `trigger_evaluations` row for the new trigger `id` to read back.
This is the conservative reading: an amended redline (possibly a different
threshold) shouldn't inherit breach history accumulated under the old one.
Evidence: `app/services/rule_engine.py::_consecutive_breach_streak` (keyed
on `trigger.id`, which changes every amendment).

## ADR-009: status_proposals has no trigger_id column — dedup by evidence.trigger_id instead
BUILD_PLAN.md §2's `status_proposals` table has no FK back to
`kill_triggers`. To stop the rule engine from spamming a new pending
proposal every time the same already-fired trigger re-evaluates for the same
period (e.g., re-posting corrected data for a period that already breached),
`evaluate_observations` checks existing pending `rule_engine` proposals for
this company+period and reads `evidence->trigger_id` (a field the rule
engine itself writes into the JSONB) rather than adding a schema column not
in BUILD_PLAN.md §2.
Evidence: `app/services/rule_engine.py::_existing_pending_trigger_ids`;
`tests/test_rule_engine.py::test_repeated_post_same_period_does_not_duplicate_pending_proposal`.

## ADR-010: outcome-close retrospective note has no dedicated column — stored as a status_events row
`POST /companies/{id}/outcome` (§6) takes an outcome + "retrospective note,"
but `companies` (§2) has no free-text column for it and `outcome` isn't
itself a status transition. Recorded as a `status_events` row with
`from_status == to_status` (status is genuinely unchanged by closing the
outcome) and the note as `rationale` — keeps the note durable and queryable
without adding a column BUILD_PLAN.md's schema doesn't have.
Evidence: `app/services/audit.py::close_outcome`.

## ADR-011: "override" is defined as (fired-kill proposal) AND (final status != 'broken')
BUILD_PLAN.md §5 rule 2 says overriding a fired kill needs a note and an
`override=TRUE` status_events row, but doesn't give the exact predicate for
"this resolution is an override." Implemented as: the proposal being
resolved came from the rule engine with `proposed_status='broken'` (i.e., a
kill, not a warn — P2 never proposes 'broken' any other way), AND the
resolution's resulting status is anything other than 'broken' (a reject, or
an accept with a human-supplied `verdict` that isn't 'broken'). Accepting a
fired kill's own recommendation (verdict left unset, defaults to 'broken')
is compliance, not an override. The same predicate is reused for direct
`POST /health-check` entries by checking for any pending fired-kill
proposal on the company.
Evidence: `app/services/audit.py::resolve_proposal`, `_find_active_fired_kill`;
`tests/test_audit.py` (override vs. non-override cases).

## ADR-012: get_llm_client() raises when unconfigured, never silently degrades
BUILD_PLAN.md §5 doesn't say what to do when no LLM provider is configured.
The tempting default — fall back to a canned/neutral response — would mean
`/ai-review` could return what looks like a real AI opinion when none was
actually formed, which is precisely the "unreviewed model output becomes
ground truth" failure constitution rule 3 and BUILD_PLAN.md §7.3 exist to
prevent (the difference here is *fabricated* rather than *unreviewed*, but
the harm is the same shape). `get_llm_client()` raises `RuntimeError`
clearly instead; tests inject `FakeLLMClient` via FastAPI's
`dependency_overrides`, the same mechanism already used for `get_db`.
Verified live: an unconfigured `/ai-review` fails with a 500 naming the
missing env var, not a fabricated verdict.
Evidence: `app/llm/client.py::get_llm_client`;
`tests/test_ai_reviewer.py::test_get_llm_client_raises_clearly_when_unconfigured`.
