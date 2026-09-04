# Investment Thesis Platform — Implementation Plan

**Audience:** whoever (human or agent) works on this codebase next.
**Status:** implemented. This describes the system as it actually exists in `web/`, not a proposal.
**Supersedes:** `BUILD_PLAN_OLD.md` (the original Python/FastAPI + vanilla-JS plan). See `harness/memory/decisions.md`, ADR-028, for why the rewrite happened and what changed behaviorally (nothing — this was a faithful port, not a redesign).

---

## 0. Stack

| Layer | Choice |
|---|---|
| Framework | **SvelteKit 5** (Svelte 5 runes: `$state`/`$derived`/`$props`/`$effect`), single full-stack app — no separate backend process |
| Language | TypeScript throughout, client and server |
| Database | Self-hosted PostgreSQL 16+ (unchanged from the original plan) |
| ORM | **Drizzle ORM** + `postgres` (postgres.js driver), replacing SQLAlchemy + Alembic |
| Migrations | `drizzle-kit`, SQL files under `web/drizzle/` — `0000_init.sql` is the entire schema squashed from the 8 original Alembic migrations, including both append-only triggers, ported as raw unmodified SQL |
| Validation | **Zod**, replacing Pydantic — `web/src/lib/server/schemas/thesis.ts` |
| Auth | Unchanged shape: PBKDF2-HMAC-SHA256 password hashes (Node's `crypto.pbkdf2Sync`, same `salt_hex$digest_hex` format, 260k iterations — byte-identical to the old Python hashes, so no forced password resets) + JWT via `jose`, or a static `X-API-Key`/`Authorization: Bearer` header. Same bearer/API-key transport as before, not cookie sessions. |
| API layer | SvelteKit `+server.ts` route handlers under `web/src/routes/api/**`, one directory per resource — same mental model as the old FastAPI routers, same `/api/*` paths and response shapes |
| Frontend | SvelteKit routes/components under `web/src/routes/**`, Tailwind v4 (`@tailwindcss/vite`, CSS-first `@theme`) instead of the Tailwind CDN + vanilla JS |
| Testing | Vitest (`web/tests/`), replacing pytest — integration tests run against the same local Postgres container the old tests used (`docker compose up postgres`, port 45432) |
| Deploy | `adapter-vercel`, `vercel.json` builds `web/` via SvelteKit's Build Output API, `bom1` region kept |

**Non-goals, unchanged from the original plan:** automated scraping, multi-tenant orgs, real-time price data, portfolio weighting/PnL, mobile app.

---

## 1. What did NOT change

This was a runtime/language port, not a redesign. Everything in the original `BUILD_PLAN_OLD.md` §1 ("What changes from the original spec") still holds and was preserved exactly:

- Kill triggers are structured rows (`kill_triggers` table), not prose — `metric_key`/`operator`/`threshold`/`severity`/`grace_periods`/`manual_check`, same shape.
- Metrics are a time series (`observations` table keyed by `company_id, period, metric_key`), with the JSONB `thesis_data` copy kept as a denormalized convenience.
- Theses are append-only and versioned. `thesis_versions.version_id` is immutable — `trg_forbid_version_update` (a Postgres trigger, not application logic) blocks `UPDATE`/`DELETE`. Ported as literal SQL, unchanged.
- `position_decisions` (buy/sell log) is append-only the same way, via `trg_forbid_decision_update`.
- One metric registry (`metric_definitions`), one taxonomy (`broad_industries`/`specific_niches`), explicit units/currency — all unchanged.
- The status engine's precedence rules (§5 of the old plan): rule engine → AI reviewer (advisory only, never mutates `companies.status`) → human (authoritative). A fired `kill` trigger cannot be dismissed without a `resolution_note`; the AI reviewer only ever writes `status_proposals` rows.
- The SFT export pipeline: three task shapes (`thesis_synthesis`/`verdict`/`redline_extraction`), the same eligibility filters (no unreviewed AI output, no hindsight leakage via `authored_at < period_end`, ≥3 reasoning steps), company-disjoint train/eval split via `sha256(company_id) % 10000 < 1500`, three output formats (`anthropic`/`openai`/`llama`).

If you're looking for the database schema, JSON contract, status-engine rules, or SFT pipeline design in detail, they're still accurate in `BUILD_PLAN_OLD.md` §2–§7 — only the *implementation language* changed, not the design. This document doesn't repeat that content; it covers what's different about building on the new stack.

---

## 2. Repo layout (current)

```
ThesisTracker/
├── web/                                   # THE APP — SvelteKit, all new work happens here
│   ├── drizzle/                           # drizzle-kit migrations (0000_init.sql = squashed schema)
│   ├── src/
│   │   ├── hooks.server.ts                # populates event.locals.actor (auth), analogous to FastAPI's Depends(get_current_actor)
│   │   ├── lib/
│   │   │   ├── api.ts                     # client-side fetch wrapper, one method per endpoint
│   │   │   ├── format.ts, session.svelte.ts, theme.svelte.ts
│   │   │   ├── components/                # HeaderStats, FacetBar, CompanyCard
│   │   │   └── server/
│   │   │       ├── db/                    # schema.ts (Drizzle schema), index.ts (client)
│   │   │       ├── auth.ts, http.ts, pillars.ts
│   │   │       ├── schemas/thesis.ts       # Zod, mirrors app/schemas/thesis.py
│   │   │       ├── services/               # one file per old app/services/*.py: scenarios, versioning,
│   │   │       │                            # observations, ruleEngine, decisions, pricePerformance,
│   │   │       │                            # audit, customTables, guidance, taxonomy, aiReviewer, exporter
│   │   │       └── llm/                    # client.ts (plain fetch to Anthropic), prompts.ts
│   │   └── routes/
│   │       ├── +page.svelte                # dashboard
│   │       ├── company/[id]/               # company detail: +page.svelte, ActionPanels.svelte, CustomTables.svelte
│   │       ├── ingest/+page.svelte          # create + amend thesis (JSON-paste mode too)
│   │       ├── review/+page.svelte          # proposal review queue
│   │       ├── guidance/+page.svelte
│   │       ├── export/+page.svelte
│   │       └── api/**/+server.ts            # one directory per resource, mirrors old routers/*.py
│   └── tests/                              # Vitest — customTables, services.integration, exporter, aiReviewer
├── app/, frontend/, migrations/, requirements.txt, alembic.ini, tests/  # OLD Python/vanilla-JS app —
│                                            # kept as a rollback safety net, not deleted. See ADR-028.
├── vercel.json                             # builds web/, deploys the new app
├── docker-compose.yml                      # postgres + old python `api` service + new `web` service (all three run side by side)
├── BUILD_PLAN.md                           # this file
├── BUILD_PLAN_OLD.md                       # superseded, historical reference only
└── harness/memory/decisions.md             # ADR log — ADR-028 covers the rewrite in full
```

---

## 3. Status

All phases of the migration (see ADR-028) are complete and committed on `master`:

- **Phase 0–1** — backend foundation + company vertical slice (dashboard, company detail page). Verified live via chrome-devtools MCP: clicking a company card produces zero additional `document` network requests — a genuine SPA transition, fixing the original "opens a slow new tab" complaint.
- **Phase 2** — all remaining backend services (observations, kill-trigger rule engine, position decisions, price/performance, health checks/proposals/audit, custom tables, guidance, taxonomy niches).
- **Phase 3** — remaining frontend views (review queue, guidance tracker, ingest form, custom table builder, company-detail action panels).
- **Phase 4** — AI reviewer + SFT exporter, ported with particular care for fidelity (2-attempt "JSON only" retry, exact verdict validation, exact JSONL shapes and split formula).
- **Phase 5 (cutover) — partial, deliberately.** `vercel.json` now deploys `web/` to production. `docker-compose.yml` runs the new app alongside the old one rather than replacing it. The old `app/`/`frontend/`/`migrations/` are still in the repo, unused, as a rollback safety net — not deleted, pending explicit sign-off after the new app proves itself live.
- **Post-cutover hardening** — closed feature/navigability gaps found by direct comparison against the old app: Amend Thesis UI (was completely missing), AI Review button wiring, a persistent action header + sticky section nav on the company page, the redline proportional-bar meter for kill triggers, per-pillar notes/table tagging, multi-scenario ("also tracked by" / "start your own thesis") support, and a JSON-paste import mode on the ingest page.

Current checks: `cd web && npx svelte-check` — 0 errors/warnings. `cd web && npx vitest run` — 45/45 passing.

**Not yet done:** deleting the old `app/`/`frontend/`/`migrations/` and fully retiring the Python service — explicit follow-up task, not scheduled.

---

## 4. Local development

```bash
docker compose up -d postgres     # or `docker compose up` for postgres + both apps
cd web
npm install
npm run dev                       # http://localhost:5173
```

`web/.env` (gitignored) needs `DATABASE_URL`, `JWT_SECRET`, `API_KEY`, `ANALYST_NAME` — see `web/.env` on any machine that's already run this, or copy the shape from `web/drizzle.config.ts`'s expectations.

```bash
cd web
npm run check      # svelte-check
npx vitest run      # full test suite
```

---

## 5. Conventions for new work in `web/`

- One service file per business-logic concern under `web/src/lib/server/services/`, one `+server.ts` per resource under `web/src/routes/api/**` — mirror the existing pattern, don't invent a new one.
- Zod schemas for all request validation, matching FastAPI's old 422 field-error behavior via the `errorResponse`/`requireActor`/`requireWriteActor` helpers in `web/src/lib/server/http.ts`.
- Svelte 5 runes only — no legacy `$:`/`export let`/stores. Follow `web/src/routes/company/[id]/+page.svelte` and `ingest/+page.svelte` as the reference implementations for form state, API calls, and error surfacing.
- Anything touching `thesis_versions` or `position_decisions` must go through the existing service functions (`versioning.ts`, `decisions.ts`) — never write a raw `UPDATE` against either table, the DB triggers will reject it and that's intentional.
- New Vitest coverage goes in `web/tests/`, following the split already established: pure-logic unit tests (e.g. `customTables.test.ts`, `exporter.test.ts`) vs. DB-backed integration tests (`services.integration.test.ts`) against the same Postgres container.
