# Investment Thesis Platform — Implementation Plan (SUPERSEDED)

> **Superseded.** This was the original plan for the Python/FastAPI +
> vanilla-JS implementation (`app/`, `frontend/`). That stack was replaced
> by a SvelteKit 5 full-stack rewrite (`web/`) — see `BUILD_PLAN.md` for
> the current plan and `harness/memory/decisions.md` (ADR-028) for why.
> The old `app/`/`frontend/` code is kept in the repo as a rollback safety
> net, not because this document is still authoritative. Kept for
> historical reference only.

**Audience:** the coding agent building this system.
**Status:** approved plan. Build in phase order. Do not skip P0.

---

## 0. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Database | **Self-hosted PostgreSQL 16+**. No Supabase, no PostgREST, no RLS-as-authorization. | Portability; the logic below (trigger evaluation, versioning, JSONL assembly) belongs in application code. |
| Backend | **Python 3.11 + FastAPI + SQLAlchemy 2.x + Alembic + Pydantic v2** | The fine-tuning pipeline is Python either way. Pydantic gives the JSON contract validation for free. Swappable for Node/Express if the agent's toolchain demands it — but then use Zod + Kysely + node-pg-migrate and keep every table and endpoint name below identical. |
| Migrations | Alembic, one migration per phase, never edited after being applied | |
| Frontend | Single-page HTML + Tailwind (CDN) + vanilla JS, no build step | Matches the original deliverable. Upgrade path to React is deliberate, not accidental. |
| Auth (v1) | Static API key in `X-API-Key` header, single analyst | Scoped up in P6 if needed, not before |
| Status setting | **Hybrid: rule engine + AI proposal + human typing.** See §5. | |
| Export target | **A real SFT run.** See §7 — this constrains the schema, so read it before writing migrations. | |

**Non-goals for v1:** automated scraping of filings/concalls, multi-tenant orgs, real-time price data, portfolio weighting/PnL, mobile app.

---

## 1. What changes from the original spec, and why

The agent must implement these deviations. Each one exists because the spec as written cannot do something the spec also asks for.

### 1.1 Kill triggers become structured rows, not sentences

`"Operating profit margin drops below 18%"` is prose. Nothing can evaluate it, so `status` would only ever be a field a human types, and the "Health Check" pillar would be decorative.

Every entry in `what_can_kill_it` is stored **both** as the display sentence (for the JSON contract and the export) **and** as a normalized row:

```json
{
  "label": "Operating profit margin drops below 18%",
  "metric_key": "operating_margin_pct",
  "operator": "<",
  "threshold": 18,
  "unit": "pct",
  "action": "EXIT",
  "severity": "kill",
  "grace_periods": 1
}
```

`severity`: `kill` (fires → status becomes `broken`) or `warn` (fires → `watch_closely`).
`grace_periods`: how many consecutive breaching periods before firing. `1` = fires immediately.
Some redlines genuinely aren't quantifiable ("promoter pledges shares"). Allow `metric_key: null` with `manual_check: true` — the engine surfaces these as questions at review time instead of evaluating them.

### 1.2 Metrics become a time series

`model_specific_metrics` in the spec is a single snapshot inside JSONB. But pillar 7 is a quarterly question and every proof point is only meaningful as a trend. Metrics live in an `observations` table keyed by `(company_id, period, metric_key)`. The JSONB block keeps the *latest* values as a denormalized convenience copy for the card render and for the export payload — the observations table is the source of truth, and the JSONB copy is rewritten by the application on every ingest.

### 1.3 Theses are append-only and versioned

If a thesis is edited in place, you lose what was believed on the date it was believed. That destroys the training data (see §7.3) and destroys your own ability to audit whether you actually called it. `thesis_versions` is append-only; `companies.current_version_id` points at the head. An `UPDATE` on `thesis_versions` is blocked by a database trigger.

### 1.4 One metric registry

The dynamic form, the API validator, the display formatter and the trigger engine all need to know that `Factory` has `capacity_utilization`. Defined once in `metric_definitions`, seeded by migration, read by everything.

### 1.5 Taxonomy is controlled, not free text

Free-text `specific_niche` makes faceted filtering useless within three months. Two lookup tables with an explicit "propose new niche" path in the UI.

### 1.6 Units and currency are explicit

The spec says `$`; the worked example is an INR-listed company. Every company has a `currency`; every metric definition has a `unit` from a fixed set (`pct`, `days`, `ratio`, `currency`, `count`, `currency_per_unit`).

---

## 2. Database schema

Postgres 16+. Extensions: `pg_trgm` (fuzzy company search), `btree_gin`.

```sql
-- ============ enums ============
CREATE TYPE operating_model  AS ENUM ('factory','subscription','money_lending','retail_stores','services');
CREATE TYPE thesis_status    AS ENUM ('on_track','watch_closely','broken');
CREATE TYPE verdict_source   AS ENUM ('manual','rule_engine','ai_proposed');
CREATE TYPE thesis_outcome   AS ENUM ('open','played_out','invalidated','exited_early','superseded');
CREATE TYPE metric_unit      AS ENUM ('pct','days','ratio','currency','count','currency_per_unit');
CREATE TYPE trigger_severity AS ENUM ('warn','kill');
CREATE TYPE proposal_state   AS ENUM ('pending','accepted','rejected','superseded');

-- ============ taxonomy ============
CREATE TABLE broad_industries (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) UNIQUE NOT NULL,
    is_active    BOOLEAN DEFAULT TRUE
);

CREATE TABLE specific_niches (
    id                 SERIAL PRIMARY KEY,
    broad_industry_id  INT NOT NULL REFERENCES broad_industries(id),
    name               VARCHAR(120) NOT NULL,
    is_active          BOOLEAN DEFAULT TRUE,
    UNIQUE (broad_industry_id, name)
);

-- ============ metric registry ============
CREATE TABLE metric_definitions (
    metric_key       VARCHAR(60) PRIMARY KEY,
    label            VARCHAR(120) NOT NULL,
    operating_model  operating_model,          -- NULL = universal, applies to all models
    unit             metric_unit NOT NULL,
    higher_is_better BOOLEAN,                  -- NULL = neutral/contextual
    decimals         SMALLINT DEFAULT 1,
    is_core          BOOLEAN DEFAULT FALSE,    -- shown on the collapsed card
    help_text        TEXT,
    sort_order       SMALLINT DEFAULT 100
);

-- ============ companies ============
CREATE TABLE companies (
    company_id          VARCHAR(50) PRIMARY KEY,        -- ticker or slug, ^[A-Z0-9_]{2,50}$
    name                VARCHAR(255) NOT NULL,
    broad_industry_id   INT NOT NULL REFERENCES broad_industries(id),
    specific_niche_id   INT NOT NULL REFERENCES specific_niches(id),
    operating_model     operating_model NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    status              thesis_status NOT NULL DEFAULT 'on_track',
    status_source       verdict_source NOT NULL DEFAULT 'manual',
    outcome             thesis_outcome NOT NULL DEFAULT 'open',
    conviction          SMALLINT CHECK (conviction BETWEEN 1 AND 5),
    entry_date          DATE,
    exit_date           DATE,
    last_reviewed       DATE NOT NULL,
    current_version_id  BIGINT,                          -- FK added after thesis_versions
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============ append-only thesis versions ============
CREATE TABLE thesis_versions (
    version_id    BIGSERIAL PRIMARY KEY,
    company_id    VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    version_no    INT NOT NULL,
    thesis_data   JSONB NOT NULL,          -- the 7 pillars, validated against JSON Schema at the API layer
    change_note   TEXT,
    authored_by   VARCHAR(80) NOT NULL,
    authored_at   TIMESTAMPTZ DEFAULT NOW(),
    search_tsv    tsvector GENERATED ALWAYS AS (
                     to_tsvector('english', jsonb_path_query_array(thesis_data, '$.**?(@.type() == "string")')::text)
                  ) STORED,
    UNIQUE (company_id, version_no)
);

ALTER TABLE companies
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id) REFERENCES thesis_versions(version_id);

-- block edits: versions are immutable
CREATE FUNCTION forbid_version_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'thesis_versions is append-only; write a new version'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_version_update
BEFORE UPDATE OR DELETE ON thesis_versions
FOR EACH ROW EXECUTE FUNCTION forbid_version_update();

-- ============ observations (metric time series) ============
CREATE TABLE observations (
    id             BIGSERIAL PRIMARY KEY,
    company_id     VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    period         VARCHAR(10) NOT NULL,        -- 'FY26Q1' / '2026-Q1', one canonical format, validated
    period_end     DATE NOT NULL,
    metric_key     VARCHAR(60) NOT NULL REFERENCES metric_definitions(metric_key),
    numeric_value  NUMERIC(20,4),
    text_value     TEXT,
    source_type    VARCHAR(40),                 -- filing | concall | presentation | news | manual
    source_url     TEXT,
    note           TEXT,
    ingested_by    VARCHAR(80) NOT NULL,
    ingested_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, period, metric_key)
);
CREATE INDEX idx_obs_company_period ON observations(company_id, period_end DESC);

-- ============ kill triggers (normalized from thesis_data) ============
CREATE TABLE kill_triggers (
    id             BIGSERIAL PRIMARY KEY,
    version_id     BIGINT NOT NULL REFERENCES thesis_versions(version_id) ON DELETE CASCADE,
    label          TEXT NOT NULL,
    metric_key     VARCHAR(60) REFERENCES metric_definitions(metric_key),  -- NULL => manual_check
    operator       VARCHAR(4) CHECK (operator IN ('<','<=','>','>=','==','!=')),
    threshold      NUMERIC(20,4),
    severity       trigger_severity NOT NULL DEFAULT 'kill',
    action         TEXT NOT NULL,               -- 'Exit position' | 'Cut 50%' | free text
    grace_periods  SMALLINT NOT NULL DEFAULT 1,
    manual_check   BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (manual_check OR (metric_key IS NOT NULL AND operator IS NOT NULL AND threshold IS NOT NULL))
);

CREATE TABLE trigger_evaluations (
    id             BIGSERIAL PRIMARY KEY,
    trigger_id     BIGINT NOT NULL REFERENCES kill_triggers(id) ON DELETE CASCADE,
    period         VARCHAR(10) NOT NULL,
    observed_value NUMERIC(20,4),
    breached       BOOLEAN NOT NULL,
    fired          BOOLEAN NOT NULL,            -- breached AND grace_periods exhausted
    evaluated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (trigger_id, period)
);

-- ============ health checks (the quarterly verdict) ============
CREATE TABLE health_checks (
    id                BIGSERIAL PRIMARY KEY,
    company_id        VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    version_id        BIGINT NOT NULL REFERENCES thesis_versions(version_id),
    period            VARCHAR(10) NOT NULL,
    verdict           thesis_status NOT NULL,
    source            verdict_source NOT NULL,
    note              TEXT NOT NULL,
    reasoning_chain   JSONB,                    -- premise/premise/inference/conclusion for this period
    evidence          JSONB,                    -- metric_keys + values + source urls the verdict rests on
    human_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
    model_name        VARCHAR(80),              -- set when source = 'ai_proposed'
    author            VARCHAR(80),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, period)
);

-- ============ status proposals + audit ============
CREATE TABLE status_proposals (
    id               BIGSERIAL PRIMARY KEY,
    company_id       VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    period           VARCHAR(10),
    proposed_status  thesis_status NOT NULL,
    source           verdict_source NOT NULL,
    rationale        TEXT NOT NULL,
    evidence         JSONB,
    state            proposal_state NOT NULL DEFAULT 'pending',
    model_name       VARCHAR(80),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    resolved_by      VARCHAR(80),
    resolved_at      TIMESTAMPTZ,
    resolution_note  TEXT
);

CREATE TABLE status_events (
    id           BIGSERIAL PRIMARY KEY,
    company_id   VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    from_status  thesis_status,
    to_status    thesis_status NOT NULL,
    source       verdict_source NOT NULL,
    proposal_id  BIGINT REFERENCES status_proposals(id),
    rationale    TEXT NOT NULL,
    override     BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE when a fired kill-trigger was overruled
    actor        VARCHAR(80) NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============ indexes ============
CREATE INDEX idx_companies_industry  ON companies(broad_industry_id);
CREATE INDEX idx_companies_niche     ON companies(specific_niche_id);
CREATE INDEX idx_companies_model     ON companies(operating_model);
CREATE INDEX idx_companies_status    ON companies(status);
CREATE INDEX idx_companies_reviewed  ON companies(last_reviewed);
CREATE INDEX idx_companies_name_trgm ON companies USING GIN (name gin_trgm_ops);
CREATE INDEX idx_versions_gin        ON thesis_versions USING GIN (thesis_data jsonb_path_ops);
CREATE INDEX idx_versions_fts        ON thesis_versions USING GIN (search_tsv);
CREATE INDEX idx_proposals_pending   ON status_proposals(company_id) WHERE state = 'pending';
```

**Note on `search_tsv`:** if the `jsonb_path_query_array` expression proves non-immutable on the target Postgres build, replace the generated column with a plain `tsvector` column populated by an application-side write. Do not drop full-text search.

---

## 3. Metric registry seed data

Seeded in the P0 migration. `is_core = TRUE` means it renders on the collapsed card.

| metric_key | label | model | unit | higher_is_better | core |
|---|---|---|---|---|---|
| `revenue_growth_yoy_pct` | Revenue Growth YoY | *(universal)* | pct | true | ✔ |
| `debt_to_equity` | Debt to Equity | *(universal)* | ratio | false | |
| `capacity_utilization_pct` | Capacity Utilization | factory | pct | true | ✔ |
| `capex_remaining` | Capex Outlay Remaining | factory | currency | false | |
| `operating_margin_pct` | Operating Margin | factory | pct | true | ✔ |
| `working_capital_days` | Working Capital Days | factory | days | false | ✔ |
| `arr` | Annual Recurring Revenue | subscription | currency | true | ✔ |
| `nrr_pct` | Net Revenue Retention | subscription | pct | true | ✔ |
| `cac` | Customer Acquisition Cost | subscription | currency | false | |
| `monthly_churn_pct` | Monthly Churn | subscription | pct | false | ✔ |
| `nim_pct` | Net Interest Margin | money_lending | pct | true | ✔ |
| `gross_npa_pct` | Gross NPA | money_lending | pct | false | ✔ |
| `loan_book_growth_pct` | Loan Book Growth | money_lending | pct | true | ✔ |
| `cost_of_funds_pct` | Cost of Funds | money_lending | pct | false | |
| `sssg_pct` | Same-Store Sales Growth | retail_stores | pct | true | ✔ |
| `store_count` | Store Footprint | retail_stores | count | true | ✔ |
| `inventory_turns` | Inventory Turnover | retail_stores | ratio | true | |
| `revenue_per_sqft` | Revenue per Sq Ft | retail_stores | currency_per_unit | true | ✔ |
| `billable_headcount` | Billable Headcount | services | count | true | ✔ |
| `blended_billing_rate` | Blended Billing Rate | services | currency_per_unit | true | ✔ |
| `utilization_rate_pct` | Utilization Rate | services | pct | true | ✔ |
| `attrition_pct` | Voluntary Attrition | services | pct | false | ✔ |

Adding a metric later = one INSERT. No code change, no migration of existing rows.

---

## 4. JSON contract

The payload shape from the original spec is preserved exactly (so anything already written against it still works), with three additions: `classification.currency`, structured fields inside `what_can_kill_it[]`, and `outcome`.

Implement as a Pydantic model set in `app/schemas/thesis.py` and export a JSON Schema artifact to `contracts/thesis.schema.json` — the frontend validates against the same file so error messages match.

Validation rules the agent must enforce:

- `company_id` matches `^[A-Z0-9_]{2,50}$`
- `revenue_split[].share_pct` sums to 100 ± 0.5
- every `metric_key` used in `model_specific_metrics` and in `what_can_kill_it[]` exists in `metric_definitions` **and** is either universal or belongs to this company's `operating_model` — reject with a 422 naming the offending key
- `why_we_believe_it` has ≥ 3 entries and contains at least one `Premise` and exactly one `Conclusion`
- `what_can_kill_it` has ≥ 1 entry with `severity = kill`
- `references[].url` is a valid absolute URL (strip the markdown-link wrapping seen in the sample payload)
- `period` matches `^FY\d{2}Q[1-4]$` or `^FY\d{2}$`, one format chosen at P0 and enforced everywhere

---

## 5. Status engine (typed + AI, as requested)

Three sources write verdicts. They do **not** have equal authority.

```
observations ingested
        │
        ▼
[1] RULE ENGINE  ─ deterministic, runs on every ingest
        │  evaluates kill_triggers for the current version against the period's observations
        │  writes trigger_evaluations; any fired kill → status_proposal(broken, source=rule_engine)
        │  any fired warn → status_proposal(watch_closely, source=rule_engine)
        ▼
[2] AI REVIEWER  ─ advisory, runs on demand or nightly
        │  input: current thesis_data + last 4 periods of observations + new narrative text
        │  output: proposed verdict + reasoning chain + confidence + cited evidence
        │  writes status_proposal(source=ai_proposed) and NEVER writes companies.status
        ▼
[3] HUMAN        ─ authoritative
           accepts / rejects / overrides any proposal, or types a verdict directly
           every resolution writes a status_events row
```

Rules the agent must implement:

1. **The AI never mutates `companies.status` directly.** It only ever creates a `status_proposals` row. This is not a safety nicety — see §7.3, an AI-written verdict that silently becomes ground truth will end up in your training set and you will fine-tune a model on its own output.
2. **A fired `kill` trigger cannot be dismissed silently.** Overriding it requires a non-empty `resolution_note`, and the resulting `status_events` row is written with `override = TRUE`. The dashboard shows a persistent badge on any company carrying an active override.
3. **Precedence when sources disagree:** human > rule engine > AI. But if the rule engine has a fired kill and the human sets `on_track`, that is an override, not a normal edit.
4. **Grace periods:** a trigger with `grace_periods = 2` fires only after two consecutive breaching periods. Track consecutive breaches by reading back `trigger_evaluations` ordered by `period_end`.
5. **Staleness:** any company with `last_reviewed` older than one quarter appears in a "Review due" queue regardless of status.

### AI reviewer prompt (`app/services/ai_reviewer.py`)

```
System: You are an investment thesis auditor. You are given a written thesis and the
latest verified operating data. Decide whether the thesis is intact. You must reason
only from the data provided; if the data does not settle a question, say so and lower
your confidence rather than assuming. Return JSON only.

User:
COMPANY: {name} | {broad_industry} > {specific_niche} | {operating_model}
THESIS (as written on {authored_at}):
  The Business: ...
  The Big Change: ...
  Why We Believe It: ...
  Invalidation Redlines: ...
NEW EVIDENCE ({period}):
  metrics: [{metric_key, value, prior_value, source_url}, ...]
  narrative: ...
RULE ENGINE FINDINGS: [{trigger, threshold, observed, breached}, ...]

Return: {
  "verdict": "on_track|watch_closely|broken",
  "confidence": 0.0-1.0,
  "reasoning_chain": ["Premise 1: ...","Premise 2: ...","Inference: ...","Conclusion: ..."],
  "evidence_used": ["metric_key", ...],
  "unresolved_questions": ["..."]
}
```

Model call goes through one adapter interface (`LLMClient.complete_json()`) so the provider is swappable. Log every call's model name, prompt hash, and raw response to disk — you will want these later to measure whether the fine-tuned model beats the base model on the same inputs.

---

## 6. REST API

All routes under `/api`, JSON in/out, `X-API-Key` required, 422 for schema violations with a field-level error list.

| Method | Path | Purpose |
|---|---|---|
| POST | `/companies` | Create company + thesis v1. Writes `companies`, `thesis_versions`, `kill_triggers`. Transactional. |
| GET | `/companies` | List. Query: `broad_industry[]`, `niche[]`, `operating_model[]`, `status[]`, `outcome`, `q` (FTS+trigram), `review_due=true`, `sort`, `page`, `page_size`. Returns cards + facet counts. |
| GET | `/companies/{id}` | Full record: current thesis, last 8 periods of observations, health check history, pending proposals, active overrides. |
| PUT | `/companies/{id}/thesis` | New version. Requires `change_note`. Re-normalizes `kill_triggers`. Never mutates the prior version. |
| GET | `/companies/{id}/versions` | Version list + diff between any two versions. |
| POST | `/companies/{id}/observations` | Bulk upsert for one period. Triggers rule engine synchronously; returns any new proposals in the response. |
| POST | `/companies/{id}/health-check` | Human verdict. Writes `health_checks` (`source=manual`, `human_confirmed=true`), updates `companies.status` + `last_reviewed`, writes `status_events`. *(Also accept `PUT` for spec compatibility.)* |
| POST | `/companies/{id}/ai-review` | Runs the AI reviewer for a period. Returns the proposal. Does not change status. |
| GET | `/proposals?state=pending` | Review queue across all companies. |
| POST | `/proposals/{id}/resolve` | Body: `{action: accept\|reject, verdict?, note}`. Accepting writes `health_checks` with `human_confirmed=true` and flips status. |
| POST | `/companies/{id}/outcome` | Close the thesis: `played_out` / `invalidated` / `exited_early` + retrospective note. **Gates export eligibility.** |
| GET | `/metrics?operating_model=` | Drives the dynamic form. |
| GET | `/taxonomy` | Industries + niches, with counts. |
| POST | `/taxonomy/niches` | Propose a new niche. |
| GET | `/export-training-data` | See §7. Query: `format`, `split`, `min_confidence`, `include_open`. Streams JSONL. |
| GET | `/export-training-data/stats` | Dataset size, class balance, leakage check — call this before every training run. |

---

## 7. SFT pipeline

You want a real fine-tuning run, so this section is a build constraint, not an afterthought.

### 7.1 The honest volume problem, and how the schema solves it

Thirty hand-written theses is thirty examples. That is not a fine-tuning dataset; a LoRA on a 7–8B model wants roughly 500–2,000 clean examples before it beats a well-prompted base model, and a full fine-tune wants far more. The schema above is built to generate real volume from a modest number of companies without fabricating anything:

| Source | Examples from 40 companies |
|---|---|
| Current thesis → structured output | 40 |
| Each historical `thesis_version` (a genuinely different input state) | ~120 |
| Each quarterly `health_check` → verdict + reasoning chain | ~320 (8 quarters avg) |
| Broken/invalidated theses → negative examples | however many you have — **these are the most valuable rows in the set** |

That is ~480 examples from 40 companies with two years of quarterly reviews, every one of them human-authored. Realistic path: **LoRA/QLoRA on Llama 3.1 8B or Qwen 2.5 7B**, evaluated against a well-prompted frontier model as the baseline. If the LoRA doesn't beat the baseline, the answer is more data, not more epochs.

### 7.2 Task shapes to emit

Do not emit one giant task. Three narrower tasks train better and are individually evaluable:

- **`thesis_synthesis`** — raw company data → the 7-pillar structured thesis (the original spec's format)
- **`verdict`** — thesis + new quarter's evidence → `on_track|watch_closely|broken` + reasoning chain *(highest value; this is the actual judgment task)*
- **`redline_extraction`** — thesis narrative → structured invalidation triggers

Each JSONL row carries a `task` field so you can train on a mixture or ablate one out.

### 7.3 Export eligibility — enforce these filters in code

A row is exportable only if **all** hold:

1. `source != 'ai_proposed'` **OR** `human_confirmed = TRUE`. Never train on unreviewed model output; that is a self-training loop that will amplify whatever the model already gets wrong.
2. The version was authored **before** the period it is reasoning about. Query on `authored_at < period_end`. Without this you leak hindsight into the input and train a model that looks brilliant in eval and useless in production.
3. Passes schema validation and has ≥ 3 reasoning steps.
4. For `verdict` tasks: `include_open=false` by default — prefer companies with a resolved `outcome`, so the label reflects something that actually happened rather than something you believed at the time.

`/export-training-data/stats` must report: row count per task, class balance across the three verdicts, distribution across operating models, and a **leakage check** confirming rule 2 held for every row.

### 7.4 Splits

Split **by company, not by row.** Random row splitting puts FY25Q1 and FY25Q2 of the same company on both sides and the eval score becomes meaningless. Hold out ~15% of companies entirely, stratified by operating model. Store the split assignment in a `training_splits` table so it is stable across runs.

### 7.5 Output formats

`format=anthropic|openai|llama`. All three from one internal representation; only the serializer differs. System prompt is the one from the original spec, stored as a constant with a version tag written into every row's metadata.

### 7.6 Eval harness

Ship alongside the exporter, in `eval/`:

- **Verdict accuracy** on held-out companies — exact match, plus a confusion matrix (confusing `watch_closely` with `broken` is a different failure than confusing it with `on_track`)
- **Redline recall** — did the model extract the same kill triggers you wrote?
- **Reasoning grounding** — does every cited metric in the chain exist in the input? Mechanical check, catches hallucinated numbers.
- Baseline row: a well-prompted frontier model on the identical eval set. If the fine-tune doesn't clear this, don't ship it.

---

## 8. Frontend plan

Built in P5 against the live API. One `index.html`, Tailwind CDN, ES modules, no bundler.

1. **Header stats** — total tracked, counts by status (green/amber/red), review-due count, active-override count.
2. **Facet bar** — multi-select industry / niche / model / status, driven by `/taxonomy` and facet counts from `/companies`. Filter state in the URL query string so views are shareable and reloadable.
3. **Cards** — name, classification chips, status pill, 3–4 `is_core` metrics with sparkline and delta arrow colored by `higher_is_better`, days-since-review. Expandable drawer with all 7 pillars, the reasoning chain rendered as a numbered deduction, redlines with live observed-vs-threshold bars, and the health-check timeline.
4. **Ingestion modal** — two tabs. *Form* renders fields from `/metrics?operating_model=`, so adding a metric to the registry makes it appear with no frontend change. *JSON* tab accepts a raw payload, validates client-side against `contracts/thesis.schema.json`, shows field-level errors.
5. **Review queue** — pending proposals with accept/reject/override, showing rule-engine findings and AI reasoning side by side. This is the screen that gets used weekly; give it real attention.
6. **Export button** — task/format/split options, calls the stats endpoint first and shows the dataset summary before downloading.

---

## 9. Repo layout

```
thesis-platform/
├── contracts/thesis.schema.json          # generated from Pydantic, consumed by frontend
├── migrations/                           # alembic, one per phase
├── app/
│   ├── main.py
│   ├── db.py  models.py
│   ├── schemas/         thesis.py  observation.py  export.py
│   ├── routers/         companies.py  observations.py  health.py  taxonomy.py  export.py
│   ├── services/        rule_engine.py  ai_reviewer.py  versioning.py  exporter.py
│   └── llm/             client.py  prompts.py
├── frontend/            index.html  app.js  components/
├── eval/                run_eval.py  metrics.py  baseline.py
├── seeds/               metrics.sql  taxonomy.sql  demo_companies.json
├── tests/
└── docker-compose.yml                    # postgres:16 + api
```

---

## 10. Phases and acceptance criteria

Each phase ends with passing tests. Do not start the next phase until the criteria are met.

**P0 — Contracts and schema.** All migrations, all seeds, Pydantic models, exported JSON Schema, docker-compose up.
*Done when:* the Balu Forge sample payload from the spec validates clean, and an attempt to `UPDATE thesis_versions` raises.

**P1 — Core API.** Company CRUD, versioning, observations, taxonomy, metrics.
*Done when:* create a company, post three quarters of observations, amend the thesis twice, and retrieve a version diff — all via HTTP, all covered by tests.

**P2 — Rule engine.** Trigger normalization, evaluation, grace periods, proposal creation.
*Done when:* posting an observation of `operating_margin_pct = 17.2` against an 18% kill trigger creates a pending `broken` proposal, and 18.5 does not.

**P3 — Human verdicts + audit.** Health checks, proposal resolution, override flow.
*Done when:* a fired kill trigger cannot be dismissed without a note, and the resulting `status_events` row has `override = TRUE`.

**P4 — AI reviewer.** LLM adapter, prompt, JSON parsing with retry, proposal writing.
*Done when:* `/ai-review` returns a grounded proposal, `companies.status` is provably unchanged, and a malformed model response fails safe rather than writing garbage.

**P5 — Dashboard.** All six screens above.
*Done when:* adding a row to `metric_definitions` makes a new field appear in the ingestion form with zero frontend edits.

**P6 — Export + eval.** Three task shapes, three formats, eligibility filters, splits, stats endpoint, eval harness.
*Done when:* the stats endpoint reports zero leakage violations and the split is company-disjoint.

---

## 11. Testing requirements

- **Rule engine:** table-driven tests across all six operators, both severities, grace periods of 1 and 3, and missing observations (a missing metric is *not* a breach — it's a data gap that surfaces in the review queue).
- **Versioning:** concurrent `PUT /thesis` must not produce duplicate `version_no`; enforce with the unique constraint plus a retry.
- **Export leakage:** a property test asserting no exported row has `authored_at >= period_end`.
- **Contract:** the spec's sample payload lives in `tests/fixtures/` as a golden file.
- **Seed data:** at least one company per operating model in `demo_companies.json`, including one `broken` and one `played_out`, so the dashboard and exporter can both be exercised without real data.