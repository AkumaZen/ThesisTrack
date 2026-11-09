# ThesisTrack system reference

Written 2026-11-03 from the code on branch `feat/guest-mode` (33 commits ahead of `master`).
It is for any agent or developer who needs to understand, rebuild or change the app.
Every claim here points at a file; when this document and the code disagree, the code wins, and this file should be corrected.

How to use it:
read sections 1 to 6 once (architecture, rules that apply everywhere), then jump to the feature you are changing in section 7.
Section 11 has step-by-step recipes for the most common changes.
Section 12 lists the invariants that must not be broken.

---

## 1. What the product is

ThesisTrack ("Thesis Tracker" in the UI) is an internal research app for a small team of analysts covering Indian listed equities, mostly small and mid caps.
It started as a structured investment-thesis log and later absorbed a separate "Valuation Dashboard" app, so it now has five modules:

| Module | Landing URL | Tools (nav tabs) |
| --- | --- | --- |
| Thesis | `/` | Companies, Review queue, Scorecard (plus Guidance at `/guidance`, New company at `/ingest`, thesis Sectors at `/sectors`) |
| Valuation | `/valuation` | Watchlist, Master Tracker, Concalls, Red flags, Compare |
| Markets | `/valuation/sector-rotation` | Sector rotation, Breadth, Returns, Breakout scanner, Results |
| Filings | `/valuation/announcements` | Announcements, Insider trades, Ex-dates |
| Alerts | `/valuation/alerts` | Inbox, Tracked companies, Price alerts |

Nav grouping lives in `web/src/lib/modules.ts` (path prefix to module, longest prefix wins) and `web/src/lib/components/shell/AppHeader.svelte` (tabs per module).
URLs of every non-thesis tool stay under `/valuation/...` for historical reasons; only the nav grouping differs.
The account menu holds Settings (`/valuation/settings`), Sector baskets (`/valuation/sectors`, admin), Team and access (`/admin/users`, admin) and Change password (`/account/password`).
Keyboard shortcuts (`web/src/lib/components/shell/KeyboardShortcuts.svelte`): `?` lists them, `g` then a letter jumps (h Companies, r Review queue, u Guidance, i Ingest, w Watchlist, c Compare, s Sector rotation, b Breakout scanner, a Alerts, t Settings), `/` opens global search.

Product principles that shape the code (from `PRODUCT.md`, still valid even though that file's stack description is outdated):

- A thesis is captured in a falsifiable, structured shape (kill triggers with thresholds, reasoning chains) so the data can later train a model (SFT).
- Thesis history is never rewritten: versions and buy/sell decisions are append-only, enforced by database triggers.
- Automation (rule engine, AI reviewer) only proposes a status; a human resolves it, and an override needs a written reason.
- Extend data without code where possible: taxonomy, operating models, metrics and custom tables are rows, not migrations.
- Multi-user: the team shares visibility; roles gate writes.

The user guide for end users is `docs/user-guide.md`.

---

## 2. Architecture at a glance

```
Browser (Svelte 5 SPA, CSR only)                    cron-job.org (every minute)
   |  session cookie tt_session / guest cookie tt_guest        |  Bearer CRON_SECRET
   v                                                          v
Vercel project "thesis-track", region sin1, Node 24 runtime
  SvelteKit app (web/)                                   Python function (same deployment)
   - hooks.server.ts: auth, access policy, guest mode     /_internal/concall-research
   - +page.server.ts loads (valuation tools)              services/concall (FastAPI + downloader)
   - /api/** JSON endpoints                                 fetches concall PDFs from
   - /api/cron/** scheduled jobs                            Screener links, NSE, BSE, company IR
   |                                                         |
   v                                                         v
Neon Postgres (pooled connection)  <---------------------- stores PDFs in valuation.master_tracker_documents
   schema public    : thesis tables, users, sessions, showcase
   schema valuation : everything else (prices, valuations, alerts, filings, scans...)

External data:  Screener.in (HTML scrape + JSON)   Angel One SmartAPI (prices, candles, quotes)
                NSE JSON APIs (announcements, insider, SAST, actions, deals, board meetings)
                OpenAI Responses API (gpt-5.6-luna)  Anthropic Messages API (thesis AI review only)
Delivery:       Web Push (VAPID)   Telegram bot (optional)   SMTP email (optional, alert inbox only)
```

The one rule that explains most of the data flow:
**a page view only ever reads stored data.**
Prices, financials and filings are fetched by scheduled jobs or by an explicit button (Refresh, Load missing..., Analyse), never because someone opened a page.
This keeps pages fast, keeps within Angel One and Screener rate limits, and keeps serverless functions inside their time limits.
Many file headers repeat this rule (for example `companyGrowthSeries.ts`, `sparklineCache.ts`, `thesisInsights.ts`, `scorecardData.ts`).

---

## 3. Repository map

Live code:

| Path | What it is |
| --- | --- |
| `web/` | The whole app: SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind 4, Drizzle ORM over `postgres` (postgres.js). |
| `web/src/hooks.server.ts` | Request pipeline: session, guest mode, access policy, error logging, in-process schedulers. |
| `web/src/lib/access.ts`, `web/src/lib/guest.ts`, `web/src/lib/auth.ts` | Pure access policy, guest policy, roles. Unit-tested. |
| `web/src/lib/server/` | Thesis-side server code: DB client and schemas, accounts and sessions, thesis services, LLM client, guest redaction, Web Push, Telegram. |
| `web/src/lib/server/db/schema.ts` | Drizzle model of the `public` schema. |
| `web/src/lib/server/db/valuationSchema.ts`, `marketIntelSchema.ts` | Drizzle model of the `valuation` schema. |
| `web/src/lib/valuation/` | Pure, unit-tested logic for every valuation/markets/filings/alerts tool (runs in browser and server). |
| `web/src/lib/valuation/server/` | Server-only stores, jobs and external clients (Angel One, Screener, NSE, OpenAI). |
| `web/src/lib/valuation/concall/` | Concall analysis, guidance checks, red flags (pure plus one model call). |
| `web/src/lib/valuation/components/` | Svelte components for the valuation tools. |
| `web/src/lib/components/` | Thesis components and the app shell (`shell/`). |
| `web/src/routes/` | Pages and API endpoints (section 9 lists every endpoint). |
| `web/drizzle/` | Raw SQL migrations `0000` to `0037` (there is no `0029`). |
| `web/scripts/` | One-off and operational Node scripts (section 10). |
| `web/_prod_*.mjs` | Production database tools that refuse any non-production host. |
| `web/tests/` | Vitest integration tests, Playwright e2e (`tests/e2e`) and opt-in live tests (`tests/live`). |
| `web/vercel.json` | Region `sin1` and the two Vercel crons. |
| `services/concall/` | Python document downloader for the Master Tracker and Concalls (packaged into the same Vercel deployment). |
| `research/` | Inputs and notes for the market cap universe and sector taxonomy (CSV, JSON, findings). |
| `docs/` | This file, the user guide, Master Tracker notes and test reports. |
| `.claude/project-memory.md` | Running status notes for agents (current work, open decisions). Read it before meaningful work. |
| `harness/skills/master-tracker-testing.md` | Saved procedure for Master Tracker browser tests. Read before that work. |

Historical or stale, do not treat as current:

| Path | Status |
| --- | --- |
| `app/`, `api/`, `migrations/`, `seeds/`, `eval/`, `tests/` (repo root) | Untracked leftovers (`__pycache__` only) of the original FastAPI backend. The TypeScript code still says "Ports app/..." in comments because it was ported from there. |
| `PRODUCT.md` | Product intent is still right; the stack description (FastAPI, vanilla JS) is outdated. |
| `DESIGN.md` | Describes an older visual design (Poppins/Inter, cream paper). The live design is in `web/src/routes/layout.css` (section 4). |
| `BUILD_PLAN.md`, `BUILD_PLAN_OLD.md`, `Steps-to-be-executed.md`, `Continual Harness.md`, `TO DO`, `BUGS-TO-FIX.md` | Planning history. |
| `harness/memory/*`, `harness/journal/*`, `harness/skills/add-api-endpoint.md`, `harness/skills/continuous-review.md` | Older agent-harness records; `add-api-endpoint.md` describes the FastAPI shape. |
| `web/README.md` | The default SvelteKit template README. |
| root `vercel.json` (`{}`), root `package.json`, `neon.ts` | Not used by the app build. |
| `.production.env` | Points at a retired Aiven database. Never use it. |

---

## 4. Tech stack and conventions

- SvelteKit 2 with `@sveltejs/adapter-vercel` (`runtime: 'nodejs24.x'`), Svelte 5 runes forced for all project files (`web/vite.config.ts`).
- The root layout sets `ssr = false` (`web/src/routes/+layout.ts`): the app is client-rendered. Thesis pages load data in universal `+page.ts` loads through `$lib/api` (passing SvelteKit's `fetch`); valuation tools use `+page.server.ts` loads, which still run on the server.
- Database: Drizzle ORM (`drizzle-orm/postgres-js`). The SQL files in `web/drizzle/` are the source of truth for the schema; the Drizzle TypeScript files describe it for queries. Drizzle's journal only lists `0000` to `0009`; later migrations are applied by hand (section 6.3).
- Validation: zod 4 on every API body and every AI output.
- Styling: Tailwind 4 plus hand-written CSS. Neo-brutalist design: white `#ffffff` background, ink `#0a0a0a`, zero border radius everywhere, hard offset shadows (`2px 2px 0 0` to `6px 6px 0 0`), fonts Plus Jakarta Sans (body), Space Grotesk (display), JetBrains Mono (numbers). Tokens and shared classes (`btn`, `tag`, `tag-good|warn|danger|info|muted`, `calm-btn`, `calm-disclosure`, `calm-toolbar`, `calm-field`, `calm-more`, `calm-data`, `calm-meta`, `calm-flat`) are in `web/src/routes/layout.css`; the shell in `web/src/lib/styles/shell.css`; valuation pages are scoped under `.vd` in `web/src/lib/valuation/styles/dashboard.css` and `marketIntel.css`.
- Page layout conventions (the "declutter" pass): a one-sentence subtitle; long help inside a `calm-disclosure` titled "How this works"; filters on one row with extras under "More filters"; maintenance actions under a "Data" disclosure or a quiet button at the toolbar end; text-style row actions.
- Every page must fit a 390px-wide phone without horizontal scroll (`web/tests/e2e/mobile-overflow.spec.ts` checks it).
- Pure logic goes in `web/src/lib/valuation/*.ts` (or `web/src/lib/*.ts`) with a sibling `*.test.ts`; I/O goes in `server/*Store.ts` or `server/*Job.ts`. Jobs take a `deps` object so tests can replace the network.
- A few modules are plain `.js` with `// @ts-nocheck` (`entryPrice.js`, `mcapUniverse.js`, `mcapBuild.js`, `sectorTaxonomyMerge.js`) because Node scripts import them directly.
- Errors from thesis APIs use the FastAPI shape `{"detail": "..."}` (`web/src/lib/server/http.ts`); valuation APIs use SvelteKit `error()`/`json({message})`. The browser helper `apiErrorMessage` in `web/src/lib/api.ts` reads both.
- Writing rules for code comments, UI text and docs: no em dash characters, plain language, no unnecessary abstractions or dependencies.
- Timestamps: thesis tables use `timestamptz`; most valuation tables store epoch milliseconds as `bigint`; newer valuation tables use `timestamptz`. Market days are IST calendar days (`YYYY-MM-DD`), see `istDay` in `web/src/lib/valuation/boardMeetings.ts`.

---

## 5. Request pipeline, identity and access

### 5.1 Identity

- Accounts: `public.users` (email, PBKDF2 password hash, role, display name, `must_change_password`). Roles: `admin`, `read_write` (shown as "Analyst"), `read_only`. Types and validation: `web/src/lib/auth.ts`. Account operations: `web/src/lib/server/accounts.ts`.
- Passwords: PBKDF2-HMAC-SHA256, 260k iterations, stored as `saltHex$digestHex` (compatible with the original Python backend) in `web/src/lib/server/password.ts`.
- Sessions: an httpOnly cookie `tt_session`, valid 14 days. Only the SHA-256 of the token is stored in `public.sessions`. Deleting a user cascades to their sessions.
- Login (`web/src/routes/login/+page.server.ts`, also `POST /api/auth/login`) is throttled per account in memory (`web/src/lib/server/loginThrottle.ts`).
- New or reset accounts get a temporary password and must change it before anything else (`/account/password`).
- Scripts can call thesis APIs (not valuation APIs) with `X-API-Key: $API_KEY` (acts as `ANALYST_NAME`, role read_write) or `Authorization: Bearer <JWT>` signed with `JWT_SECRET` (`web/src/lib/server/auth.ts`). Thesis routes act through `locals.actor`.
- Authors are recorded by display name (for example `Rohit.Negi`) in valuation tables and by actor identity (email) in thesis tables.

### 5.2 Access policy

`web/src/lib/access.ts` `decideAccess()` is the whole policy as one pure function returning `allow | login | forbidden | change-password | locked`; `hooks.server.ts` only enforces it.

- Public: `/login`, `/logout`, `/api/auth/login`, `/api/auth/guest`, `/api/health`, `/api/cron/*` (checks `CRON_SECRET` itself), `/api/telegram/webhook` (checks its own secret header).
- No user: API calls with a script credential are allowed except under `/api/valuation`, `/api/admin`, `/api/account`; everything else goes to `/login?next=...` (APIs get 401 JSON).
- `must_change_password`: only the password page, its API, logout and `/api/auth/me`.
- Admin only: pages `/admin/*` and `/valuation/sectors`; all of `/api/admin/*`; writes to `/api/valuation/sectors`, `/api/valuation/sector-rotation-import`, `/api/valuation/breadth/backfill`.
- `read_only`: any write under `/api/valuation` is refused except personal ones (`/api/valuation/me`, `/strength/prefs`, `/tracking`, `/push`). Thesis APIs refuse their writes through `requireWrite`.
- Guests: see 5.3.

### 5.3 Guest mode (only on `feat/guest-mode`, not yet on master)

Anyone can explore without an account.

- "Explore without an account" on `/login` calls `POST /api/auth/guest`, which sets the unsigned cookie `tt_guest=1` (30 days). A real session always wins over it.
- The guest is the stand-in user `GUEST_USER` (id 0, role `guest`) from `web/src/lib/guest.ts`. Id 0 matches no account, so personal stores come back empty.
- Policy (`web/src/lib/guest.ts`): every non-GET is 403 with `{guest: true, message: GUEST_WRITE_MESSAGE}`; APIs are deny-by-default with an allowlist (`guestMayCallApi`); pages use `guestMayOpenPage`; locked features (keys `master-tracker`, `alerts`, `lists`, `scans`, `settings`, `team-review`, `ai-import`, `sectors`) redirect to a preview at `/locked/<key>`; other pages go to `/guest/members-only`.
- Showcase: guests only see companies listed in `public.showcase_symbols` (migration `0037`, read through `web/src/lib/server/showcase.ts`, 30 second cache). The row `'*'` (`SHOWCASE_ALL`) shows every company, including future ones; production has it. Requests about other companies return 404 as if they did not exist. Admins toggle per company with `ShowcaseToggle.svelte` (`PUT /api/admin/showcase`).
- No live loads: each guest request runs inside `runAsGuest()` (`web/src/lib/server/guestContext.ts`), where any cross-origin `fetch` throws `GuestLiveFetchError`. Code that would scrape or call an API serves stored data or a friendly "sign in to load it" 404 (for example `CompanyNotLoadedError` in `companyCache.ts`).
- Identity redaction: every guest response passes `redactGuestResponse` (`guestResponse.ts`, pure rules in `guestRedact.ts`): person fields become "Analyst N" (stable by account age; unknown people "Team member"), account ids become null, `members` lists are emptied, emails and display names inside text are replaced. A guest's `?owner=Analyst N` is mapped back on the way in (`unmaskGuestParams`).
- UI: guest banner, locks on nav tabs, `LockedAction.svelte` ("Subscribers only - coming soon") in place of write buttons, `GuestNotice.svelte` toast for refused calls (`guestNotice.svelte.ts` wraps `fetch`), `GuestNote.svelte` in valuation panels, a guest card in `+error.svelte`.

### 5.4 Hook order (`web/src/hooks.server.ts`)

1. On a long-running server (not Vercel, not build, `DISABLE_BACKGROUND_JOBS != 'true'`), start the in-process schedulers (section 8).
2. Local Playwright mock scope: when `MASTER_TRACKER_TEST_MODE=true` in dev on a loopback host, Master Tracker, Compare and Ingest routes get a fake user and mocked responses (`masterTrackerMock.ts`). Never active in production builds.
3. Resolve the session cookie to a user, else the guest cookie to `GUEST_USER`; resolve `locals.actor`.
4. Apply `decideAccess` (redirect or JSON error).
5. For guests: showcase check, unmask params, run inside `runAsGuest`, redact the response.
6. On Vercel with a direct (non-pooler) database URL, keep the instance awake `IDLE_GRACE_MS` after replying so idle connections close.
7. `handleError` logs one line with an 8-character error id and shows only that id to the user.

---

## 6. Data layer

### 6.1 Connection (`web/src/lib/server/db/index.ts`)

- `DATABASE_URL` is required (except during `vite build`).
- Production uses Neon's pooler host (contains `-pooler.`): prepared statements are turned off (PgBouncer transaction mode), pool max 3.
- A direct URL on Vercel uses max 1 connection with a 1 second idle timeout (a burst of instances once exhausted a small database's connection limit).
- One Drizzle instance covers both schemas.

### 6.2 Schemas and tables

`public` (thesis core, `web/src/lib/server/db/schema.ts`):

| Table | Purpose |
| --- | --- |
| `broad_industries`, `specific_niches`, `operating_models` | Controlled taxonomy (industry > niche) and operating models (factory, subscription, money_lending, retail_stores, services, plus user-added). Rows, not enums. |
| `metric_definitions` | Metric registry (key, label, free-form unit, higher-is-better, operating model, core flag). |
| `companies` | Thesis companies. `company_id` derives from the NSE ticker, else BSE ticker. |
| `thesis_scenarios` | One thesis per (company, owner). Status (`on_track/watch_closely/broken`), status source, outcome (`open/played_out/invalidated/exited_early/superseded`), conviction 1-5, entry date/price/source, `needs_price`, lesson, `current_version_id`. |
| `thesis_versions` | Append-only versions: `thesis_data` JSONB, version number per scenario, change note, author. Generated `search_tsv` for full-text search. |
| `kill_triggers` | Triggers copied out of each version (metric, operator, threshold, severity warn/kill, grace periods, manual check). |
| `trigger_evaluations` | Rule-engine result per (trigger, period). |
| `observations` | Metric values per (company, period, metric). |
| `status_proposals` | Pending/accepted/rejected/superseded status proposals from the rule engine or the AI reviewer. |
| `status_events` | Audit trail of status changes, with override flag and rationale. |
| `health_checks` | Quarterly reviews, one per (company, period), with verdict, reasoning chain and evidence. |
| `position_decisions` | Append-only buy/sell log with price, quantity, rationale. |
| `price_observations` | Manually logged prices per company and day. |
| `guidance_notes` | Analyst guidance notes per thesis block, optional structured target (metric, value, unit, period, expected results date) and outcome (`pending/achieved/missed`). |
| `custom_tables`, `custom_table_rows` | User-defined tables attached to a company and a thesis section. |
| `custom_notes` | Company notes made of ordered text and table blocks. |
| `sectors`, `sector_companies` | Thesis-side sector groupings (separate from the market sector taxonomy). |
| `training_splits` | Train/eval split per company for the future SFT export. |
| `users`, `sessions` | Accounts and sessions. |
| `showcase_symbols` | Guest showcase (migration 0037). |

`valuation` (everything else, `valuationSchema.ts` and `marketIntelSchema.ts`):

| Area | Tables |
| --- | --- |
| Price and data caches | `company_cache` (Screener record per symbol, plus `STMT:` keys for Compare statements), `company_growth_series_cache` (daily OHLCV, about 700 days), `sparkline_cache`, `benchmark_series_cache` (Nifty 50), `nifty500_series_cache`, `long_term_highs` (5-year high, 3-year-ago close, weekly 3Y closes), `company_segments`, `symbol_name_cache`, `stage_scan_cache` |
| Saved valuations | `saved_valuations` (one per symbol, team-shared, optimistic `version`), `valuation_versions` (history incl. delete/restore), `valuation_status`, `valuation_templates`, `valuation_template_defaults`, `company_notes` (thesis/note/comment), `coverage`, `activity_log` |
| Lists | `watchlist_sections`, `watchlist_section_items` (personal lists with flags); legacy team `watchlists`, `watchlist_members`, `watchlist_list_copies` (kept as backup after 0034) |
| Sector taxonomy | `sector_majors` (ordered basket keys), `sector_baskets` (symbol arrays), legacy `user_sectors` |
| Preferences and settings | `user_prefs`, `strength_filter_prefs`, `alert_settings` (shared key/value, includes analysis settings and RS thresholds), `app_meta` (flags, cursors, leases) |
| Alert inbox | `alerts`, `alert_reads`, `alert_user_prefs`, `alert_state`, `strength_rules` |
| Market cap universe | `mcap_universe` (AMFI companies above Rs 500 Cr with Angel One tokens) |
| Announcements and delivery | `tracked_companies`, `announcements`, `announcement_deliveries`, `announcement_keywords`, `push_subscriptions`, `user_notification_settings`, `telegram_links`, `telegram_link_tokens`, `symbol_refresh` (per-source refresh throttle) |
| Market feeds | `board_meetings`, `market_deals`, `deal_deliveries`, `shareholding_snapshots`, `insider_trades`, `sast_disclosures`, `corporate_actions` |
| Personal alert rules | `price_alert_rules`, `holding_alert_settings`, `holding_alert_deliveries` |
| Analytics | `saved_scans`, `scan_snapshots`, `market_breadth`, `breadth_closes`, `market_breadth_dma` |
| Master Tracker and Concalls | `master_tracker_companies` (state JSON + version), `master_tracker_research` (cached research bundles), `master_tracker_previews` (per-user drafts), `master_tracker_documents` (PDF bytes, SQL-only table used by Python), `concall_company_scan`, `concall_analyses`, `concall_guidance` |

### 6.3 Migrations

- Files: `web/drizzle/NNNN_name.sql`, statements separated by `--> statement-breakpoint`. New files should be idempotent (`IF NOT EXISTS`) and additive.
- Never edit an applied migration; add a new one.
- Local: `docker exec -i thesistrack-postgres-1 psql -U thesis -d thesis < web/drizzle/NNNN_x.sql` (Docker Postgres from the root `docker-compose.yml`, port 45432).
- Production: `node web/_prod_migrate.mjs <envFile> web/drizzle/NNNN_x.sql`. `_prod_db.mjs` reads `NEON_DB_URL` or `DATABASE_URL` from the env file, switches to the direct host, prints only the host and refuses anything that is not Neon endpoint `ep-damp-haze-azf572ro`.
- Order: apply a required migration to production before pushing the code that depends on it (pushing master deploys). Production migrations need explicit user approval.
- After adding a table, also describe it in the Drizzle schema files if the app queries it.

### 6.4 Append-only enforcement

- `thesis_versions` and `position_decisions` have `BEFORE UPDATE OR DELETE` triggers (`forbid_version_update`, `forbid_decision_update`) that always reject UPDATE.
- DELETE is allowed only when the transaction ran `set_config('app.allow_thesis_delete', 'on', true)`; only the admin delete-company endpoint (`DELETE /api/companies/[id]`) does that (migrations `0011`, `0017`).
- To change a thesis, append a new version (`amendThesis` in `web/src/lib/server/services/versioning.ts`).

---

## 7. Features (the tools)

Each subsection lists: what it does, where the UI is, the APIs, the server code, the pure logic, the tables and the rules worth knowing.

### 7.1 Thesis: companies and the thesis document

- UI: `/` (dashboard of companies, `web/src/routes/+page.svelte`, `CompanyCard.svelte`, `FacetBar.svelte`, `HeaderStats.svelte`), `/company/[id]` (thesis page, `+page.svelte`, `ActionPanels.svelte`, `CustomTables.svelte`), `/ingest` (New company, Start your own thesis, Amend, JSON paste import).
- Thesis JSON shape (`web/src/lib/server/schemas/thesis.ts`, sections in `web/src/lib/sections.ts`): `the_business {what_it_does, revenue_split[]}`, `the_growth_engine[]`, `the_big_change {summary, expected_completion}`, `proof_points {hard_evidence[], model_specific_metrics{}}`, `what_can_kill_it[]` (kill triggers), `why_we_believe_it[]`, `health_check {latest_quarter_review, historical_checks[]}`, `trackables[]`, `buy_sell_decision`, `references[]`, `pillar_notes{section: [{blocks}]}`. Nothing is required; a thesis is built up over time. Only unknown `pillar_notes` keys are rejected.
- Create (`POST /api/companies` -> `createCompany`): derive `company_id` from tickers, resolve taxonomy and operating model (must exist; propose new ones via `/api/taxonomy/*`), resolve the entry price, then in one transaction insert company, scenario, version 1 and kill triggers. If the analyst already has an empty placeholder scenario (no substantive content, see `isSubstantiveThesis`), it is adopted instead of failing.
- Amend (`PUT /api/companies/[id]/thesis` -> `amendThesis`): new version number, copy kill triggers, move `current_version_id`.
- Versions and diff: `GET /api/companies/[id]/versions`, `diffVersions` flattens JSON paths.
- Company page panels: Log Observation, Position Decisions, Price and Performance, Quarterly Review, Close Out Thesis, Edit Details, Run AI Review, the nine numbered sections plus References, custom tables and notes, guidance notes.
- Entry price (`web/src/lib/entryPrice.js`, `server/services/entryPrice.ts`): manual price, else the stored close on or before the entry date, else `needs_price`. Sources: `manual`, `auto`, `backfill_buy`, `backfill_history`, `no_data`. Reads stored prices only. `GET /api/entry-price` previews it; `web/scripts/backfill-entry-price.mjs` fills old theses.
- Price target (`web/src/lib/priceTarget.ts`, `thesisInsights.ts`): progress from entry price toward the saved valuation's base-case FY+2E target.
- Stale thesis (`web/src/lib/staleThesis.ts`): needs a look when last reviewed more than 90 days ago or the price moved 20% or more since the review.
- Custom tables and notes: `server/services/customTables.ts` (typed columns, row validation, bulk rows), `customNotes.ts` (blocks of text and table references). APIs under `/api/companies/[id]/tables`, `/api/tables/*`, `/api/companies/[id]/notes`, `/api/notes/[noteId]`.
- Thesis sectors (`/sectors`, `server/services/sectors.ts`, `/api/sectors/*`): group thesis companies for a rollup; a company's health is its most recently updated scenario. Not in the nav. Different from the market sector taxonomy in 7.10.
- Taxonomy and metrics: `GET/POST /api/taxonomy`, `/api/taxonomy/niches`, `/api/taxonomy/operating-models`, `GET/POST /api/metrics` (`normalizeMetricKey`).

### 7.2 Thesis: status workflow (rule engine, AI reviewer, review queue)

- Observations (`POST /api/companies/[id]/observations`, `server/services/observations.ts`) store metric values for a period, then run the rule engine.
- Rule engine (`server/services/ruleEngine.ts`): for each scenario's current-version kill triggers that are fully configured and not manual-check, compare the observation for the period with the threshold. A breach must persist for `grace_periods` consecutive periods to fire. A fired `kill` proposes `broken`, a fired `warn` proposes `watch_closely`, as a pending `status_proposals` row (deduplicated per trigger and period). Missing data is a gap, not a breach. `web/scripts/sync-observations.mjs` turns a thesis's `model_specific_metrics` snapshot into observations.
- AI reviewer (`POST /api/companies/[id]/ai-review`, `server/services/aiReviewer.ts`, prompt `server/llm/prompts.ts`): sends the thesis, the last four periods of observations and rule findings to the Anthropic Messages API (`ANTHROPIC_API_KEY`, model `ANTHROPIC_MODEL`, default `claude-sonnet-5`), expects JSON `{verdict, confidence, reasoning_chain, evidence_used, unresolved_questions}`, retries once on bad JSON and writes an `ai_proposed` proposal. It never sets the status itself. Every call is logged to `logs/llm_calls` (or `/tmp` on Vercel).
- Resolution (`POST /api/proposals/[id]/resolve`, `server/services/audit.ts` `resolveProposal`): accept or reject; overriding a fired kill trigger requires a non-empty note; writes `status_events` with an `override` flag.
- Quarterly review (`POST/PUT /api/companies/[id]/health-check`, `submitHealthCheck`): one `health_checks` row per period; a verdict that overrides an active fired kill trigger also needs a note.
- Close out (`POST /api/companies/[id]/outcome`, `closeOutcome`): sets outcome, exit date and a one-line lesson.
- Decisions (`/api/companies/[id]/decisions`): append-only buy/sell log.
- Review queue (`/review`, `GET /api/trackables`): trackables across companies, flagged when stale. Pending proposals: `GET /api/proposals`.
- Guidance notes page (`/guidance`, `/api/guidance*`, `server/services/guidance.ts`): open/resolved notes with targets and achieved/missed outcomes.

### 7.3 Thesis: Scorecard

- UI `/scorecard`, API `GET /api/scorecard`, data gathering `server/services/scorecardData.ts`, pure maths `web/src/lib/scorecard.ts`.
- Headline numbers use closed theses (outcome not `open`): return from entry price to exit price versus Nifty 50 over the same dates, holding days, hit rate, best and worst calls, grouped by analyst, conviction and sector. Open theses get a paper return at the latest stored close, reported separately. Rows that cannot be priced are listed with an exclusion reason. Stored prices only.

### 7.4 Valuation: Watchlist, company valuation page, lists

- UI: `/valuation` (watchlist, `routes/valuation/+page.svelte`), `/valuation/company/[symbol]` (full valuation page), `/valuation/lists` (manage lists).
- Model (`web/src/lib/valuation/valuationEngine.ts`): four methods `pe`, `pb`, `ev_ebitda`, `mcap_sales`; three scenarios `bear`, `base`, `bull`; three projected years each. Per year: `sales = prevSales * (1 + growth%)`, `expenses = sales * expensePct%` (a margin, not a growth rate), `EBITDA = sales - expenses`, `PBT = EBITDA + otherIncome - interest - depreciation`, `tax = PBT * taxPct%`, `PAT = PBT - tax`, owners' PAT subtracts minority PAT, `EPS = ownersPAT / shares`, book value per share rolls forward with retained EPS and new equity. Implied price: PE `EPS * multiple`; PB `BVPS * multiple`; EV/EBITDA `(EBITDA * multiple - netDebt) / shares`; Mcap/Sales `sales * multiple / shares`. Defaults: growth 8/15/22%, expenses 85%, tax 25%, multiples PE 20, PB 3, EV/EBITDA 12, Mcap/Sales 3.
- Base data: the Screener record from `company_cache` (`server/scraper.ts`, `server/companyCache.ts`, 24 hour freshness, 0.8 s gap between Screener requests). Base sales is the last historical year.
- Fair value (`fairValue.ts`): base-case FY+2E implied price times the team's fair value percentage (Settings, default 80%). Upside and CAGR read FY+2E.
- Method diagnosis (`valuationDiagnosis.ts`, `businessQuality.ts`, `pegAnalysis.ts`, `reverseDcf.ts`): rule-based recommendation of the method, quality flags citing their numbers, PEG on historical PAT CAGR, reverse DCF solving the growth the market cap implies (12% discount, 4% terminal, 10 years by default).
- Saving (`savedValuations.ts` client, `server/savedValuationsStore.ts`, `PUT /api/valuation/valuations/[symbol]`): one record per symbol shared by the team. Optimistic concurrency: a save carrying an older `version` gets 409 and a diff of what the other person changed (`valuationDiff.ts`). History in `valuation_versions`; autosaves by the same person within 10 minutes are one version. Removing keeps a `delete` version; removed valuations stay restorable (`/api/valuation/valuations/removed`, `/restore`, `/history`).
- JSON import (`importValuation.ts`): flat fields or per-year overrides; anything missing falls back to `freshScenario`.
- Templates (`templates.ts`, `server/templatesStore.ts`, `/api/valuation/templates*`): named starting assumptions, with a default per user or per sector basket.
- Team panel (`CompanyTeam.svelte`, `server/teamStore.ts`): company notes (thesis, note, comment), review status (`draft`, `review_needed`, `approved`, stale when the valuation version moved on), coverage (which analyst covers it). Changes go to `activity_log` (`ActivityFeed.svelte`, `/api/valuation/activity`).
- Company page extras: price chart with 50/200 DMA (`priceChart.ts`, `/price-chart`), stage analysis (`/stage-analysis`), market depth (`/depth`), segments (`segments.ts`, `server/segmentStore.ts`; numbers need a Screener premium `SCREENER_SESSION_ID`), filings (`CompanyFilings.svelte`), concall panel (shown only for Master Tracker companies), data integrity checks (`dataIntegrity.ts`), Excel export (`valuationWorkbook.ts`, `exportXlsx.ts`, exceljs loaded on demand).
- Watchlist rows: price, CAGR, fair value, sparkline from stored closes (`server/sparklineCache.ts`, `trendState.ts` explains every empty state), preset badges (`PresetBadges.svelte`, `/api/valuation/presets`). Columns, sort and view are per-user preferences (`prefs.ts`, `/api/valuation/me/prefs`).
- Lists (`watchlistSections.ts`, `/api/valuation/watchlist-sections*`): personal lists, at most 20 lists of 200 companies, each item with an optional colour flag and short label. Migration `0034` copied the old team lists into them.
- Add a company (`AddCompanyPanel.svelte`, `POST /api/valuation/company-add`, `CompanyPicker.svelte`, `/api/valuation/symbol-search`): symbols are verified against Screener, never guessed (`server/symbolVerify.ts`).

### 7.5 Valuation: Master Tracker

What management promised against what was delivered, with sourced evidence, plus an AI-built three-scenario valuation.
More operational detail: `docs/master-tracker.md`; testing procedure: `harness/skills/master-tracker-testing.md`.

- UI `/valuation/master-tracker` (`TrackerCompanyRow.svelte`, `TrackerPreview.svelte`, `TrackerValuation.svelte`, `TrackerProgress.svelte`, `TrackerSources.svelte`).
- APIs: `GET/POST/DELETE /api/valuation/master-tracker` (list, create, remove), `GET /identity` (detect BSE code), `POST /api/valuation/master-tracker/[symbol]` (actions: load quarters, analyse, accept/discard drafts; streams NDJSON progress), `POST /sample` (mock harness only).
- Schemas and validation: `web/src/lib/valuation/masterTracker.ts`. Guidance statuses `Pending, Met, Beat, Miss, Revised, Withdrawn`; guidance items form threads (original, revision, execution) linked by `threadId` and `previousId`; manual edits are protected. `validateAnalysis` rejects any citation whose excerpt is not found on the cited page of the supplied research.
- Flow (`server/masterTrackerProvider.ts`):
  1. Identity: Screener company overview gives the BSE code (or a six-digit symbol is the BSE code).
  2. Research: Screener financials (built-in scraper `trackerFinancials.ts`, or an optional Screener MCP server via `SCREENER_MCP_*`), reported quarters, document links.
  3. Documents for the selected quarters: the Python service (`services/concall`) through `internalTrackerDocuments` (same deployment) or `CONCALL_SERVICE_URL`. Research bundles are cached a day in `master_tracker_research`.
  4. Analysis: OpenAI Responses API, model `OPENAI_MODEL` (default and required for live tests: `gpt-5.6-luna`), strict JSON schema, the model returns evidence ids and the server inserts the exact excerpt, URL and page. Historical tax is reconciled to PBT minus PAT.
  5. The result is a per-user draft in `master_tracker_previews`; the analyst accepts, edits or excludes each item; saving checks the company `version` (409 on conflict). Accepted valuations can be synced to the watchlist record (`trackerWatchlist.ts`) without overwriting other methods.
- Python document service (`services/concall/server.py`, `internal.py`, `concall_downloader/`): FastAPI `POST /research` (Bearer `CONCALL_SERVICE_TOKEN`) with `bseCode`, optional `nseSymbol`, `isin`, `documentLinks`, quarter-end dates. It downloads transcripts, presentations, annual reports and other updates for the window from 92 days before the first quarter to 100 days after the last, using Screener links, NSE, BSE and company investor-relations pages, classifies and dates them, extracts page text with pypdf (over 200 pages or no text is reported, never truncated) and returns pages. `internal.py` stores PDFs in `valuation.master_tracker_documents` under a Postgres advisory lock. BSE's API often returns 403 from cloud hosts; Screener and NSE cover most cases. `web/scripts/package-concall.mjs` bundles it as a Python 3.12 Vercel function at `/_internal/concall-research` (300 s).
- Mock harness: `npm run dev:tracker` (port 5180, in-memory, fake database URL) and Playwright `npm run test:tracker` (port 5179). Requires dev build, loopback host and `MASTER_TRACKER_TEST_MODE=true`.

### 7.6 Valuation: Concalls and Red flags

Built on the Master Tracker's companies and stored research; no new scraping on page view.

- UI: `/valuation/concalls` (one row per company and quarter), `/valuation/concalls/[symbol]`, `/valuation/red-flags`; per-company `ConcallPanel.svelte`.
- APIs: `POST /api/valuation/concalls/run` with mode `refresh` (read latest financials into `concall_company_scan`) or `analyse` (analyse new transcripts); the browser repeats small batches (`concallClient.ts`). `GET /api/valuation/concalls/company/[symbol]`.
- Server: `server/concallJob.ts` (at most 5 analyses per run, time-boxed), `server/concallStore.ts`, `server/concallPanel.ts`.
- Model step (`concall/analysis.ts`): one OpenAI call per transcript (up to 120,000 characters, longer is cut and flagged) returning sentiment score, tone, up to three positives and negatives, and up to 12 guidance statements. Cached by transcript hash and `PROMPT_VERSION` (currently 2; bump it when the prompt or schema changes). Guidance whose quote is not found in the transcript is dropped.
- Rule steps (no model): guidance evaluation against later quarterly results (`concall/guidance.ts`; metrics revenue, ebitda, ebitda_margin, pat, other; bases `growth_pct`, `level`, `margin_pct`, `margin_change_pp`; comparators at_least, at_most, approx, between; tolerance 5% relative, 1 point for percentages, 0.5 point for margin-change targets), result quality per quarter (`concall/resultQuality.ts`: YoY growth versus the mean of the three prior quarters' YoY, 5 point band, net score of sales, operating profit and net profit), red flags (`concall/redFlags.ts`: cash from operations at least 0.6 of PAT, receivable days rising 1.25 times and at least 10 days, other income share at most 30%, pledge at most 10%), congratulation counts (`concall/transcripts.ts`).

### 7.7 Valuation: Compare

- UI `/valuation/compare?symbols=A,B,...` (up to 10). The page fetches `GET /api/valuation/compare/[symbol]` per company in parallel.
- `server/compareStatements.ts` scrapes every row of Screener's P&L, balance sheet, cash flow, ratios and shareholding (including expandable sub-rows) plus year-end valuation multiples, cached in `company_cache` under `STMT:` keys. `compareMetrics.ts` builds the metric catalogue, default selection and period alignment.

### 7.8 Markets: price data and refresh machinery

This is shared by sector rotation, scanner, breadth, returns, watchlist trends and alerts.

- Angel One client (`server/angelone.ts`): login with `ANGEL_CLIENT_CODE`, `ANGEL_PIN`, TOTP from `ANGEL_TOTP_SECRET`, `ANGEL_API_KEY`. Scrip master lookup (NSE `-EQ` preferred, then other series, then BSE), LTP, daily candles, index candles, market depth, batched quotes (50 tokens per request). Concurrent identical requests are collapsed.
- Rate limits (`server/rateLimiter.ts`): multi-window sliding limiter per endpoint (login, candles about 2 per second, LTP, quote).
- Stored series: `company_growth_series_cache` (about 700 calendar days so a 200-day average is complete across a year of chart). `readCachedSeries` never fetches.
- Refresh from one quote (`server/refreshMerge.ts`, `server/batchRefresh.ts`): if the stored series is one session behind, append today's quote; if current, leave it; if a jump over 20% (split or bonus), refetch the full history. Quotes before about 15:30 IST plus settlement are provisional.
- Gap fill: a series up to 45 days behind (a missed run, a holiday week, a special session such as Sunday Muhurat trading, which a quote cannot bring) gets only the missing days from one short history fetch (`mergeGapFill`). The fetch must overlap the last stored session at the same close (within 2%) and show no jump over 20%, or the full history is refetched. Further behind, or no stored series: full refetch.
- Who refreshes:
  - "Refresh all sectors" and "Load missing history" in the browser (`refreshAll.ts`, `historyLoad.ts`) send batches of 50 (25 for full-history loads) to `POST /api/valuation/refresh-batch`.
  - Long batch jobs run in a module-level `BackgroundRun` (`backgroundRun.svelte.ts`, `valuationRuns.ts`) so they continue across page navigation; `shell/BackgroundRuns.svelte` shows progress and Cancel on every page. A full reload ends them. (On `feat/guest-mode`; not on master yet.)
  - Scheduled: section 8.
- Benchmarks: Nifty 50 (`benchmarkSeries.ts`, sector RS) and Nifty 500 (`nifty500Series.ts`, scanner Mansfield RS); index tokens in `server/sectorIndices.ts`.

### 7.9 Markets: Sector rotation and Sector manager

- UI: `/valuation/sector-rotation` (major sector cards), `/valuation/sector-rotation/[key]` (subsectors), `/valuation/sector-rotation/[key]/[subKey]` (companies with charts and timeframes 1W to 1Y), search box (`sectorSearch.ts`).
- Taxonomy: majors hold an ordered list of basket keys; a basket (subsector) holds symbols and may sit under several majors. Stored in `sector_majors` and `sector_baskets`; seeded once from `server/customSectors.ts` (`CUSTOM_SECTORS`, `MAJOR_SECTORS`) and afterwards the database is the only source of truth (`server/sectorStore.ts`). Bulk changes use `web/scripts/import-sector-taxonomy.mjs` with `research/sector_taxonomy_v2.json` (add-only by default, `--replace` makes listed baskets exact).
- Sector manager (admin, `/valuation/sectors`, `/api/valuation/sectors/*`): create, rename, delete majors and baskets, add or remove symbols. Every added symbol passes `verifySymbol` (exact Screener slug match or the BSE-code page with the same name; fuzzy matches are only suggestions). Names are cached in `symbol_name_cache`; static names in `symbolNames.ts`.
- Maths (`sectorRotation.ts`): a basket's index is the equal-weighted chain of its members' daily returns starting at 100 (`buildEqualWeightedIndex`; a late listing joins from its first day without shortening the window). Returns over 1, 5, 21, 63, 126, 252 trading days; relative strength = sector return minus Nifty 50 return. Signal: compare RS per trading day over short, mid and long windows (default 21, 63, 126 days); `Rotating In` when short > mid > long rate and short RS above `minRsPct`; `Rotating Out` is the mirror; otherwise the badge reads Outperforming, Underperforming, Recovering or Fading from 1M and 3M RS (`rotationBadge`). Windows and threshold are team settings.
- APIs: `GET /api/valuation/sector-rotation/[key]` (one basket), `/sector-rotation-major/[key]`, `/sector-symbols/[key]`, `/sector-refresh-plan`, admin `/sector-rotation-import` (legacy JSON import). Computed on demand from stored prices (`server/sectorRotationCache.ts`); cards are cached in the browser for 30 minutes (`cardCache.ts`).
- Sector earnings (`sectorEarnings.ts`, `SectorEarnings.svelte`): sum of members' stored quarterly revenue and profit; YoY uses only members that have both quarters; thin coverage is flagged.
- Strength and Volume (`strength.ts`, `server/strengthEngine.ts`, `StrengthPanel.svelte`, `/api/valuation/strength*`): signals on complete sessions aligned to the Nifty calendar. Sudden strength (adaptive robust z-score of RS over the period against a baseline, or an explicit RS level), gradual strength (sessions beating Nifty and total gain, no single-day dominance), spreading (share of members improving), volume confirmation (recent average over baseline). Combine with any/all. The same config powers saved alert rules (`strength_rules`). Last-used filter per user and place in `strength_filter_prefs`.

### 7.10 Markets: Breakout scanner, presets and saved scans

- UI `/valuation/stage-scanner` (stage chips, preset dropdown, sector and market cap filters, chart grid), `/valuation/scans` (saved scans), `/valuation/scans/shared/[id]` (anyone signed in can open; owner edits).
- Universe (`server/stageScanUniverse.ts`): every symbol in the sector baskets plus active `mcap_universe` companies from Rs 500 Cr up to Rs 20,000 Cr (`SCANNER_MAX_MCAP_CR`) that Angel One can price.
- Stage analysis (`stageScan.ts`, Weinstein adapted to daily data with 50 and 200 DMA): base detection from pivot highs (7-bar fractal, touches at least 10 days apart, clustered within 3%, at least 2 touches, within 130 days, base at least 30 days and range at most 30%); breakout search over 150 days (close clears resistance by 1.5% on at least 2x 20-day volume); Mansfield RS against Nifty 500 over 200 days. Classification order: fewer than 200 sessions is unclassified; Stage 4 (200 DMA falling and price below it); Stage 3 (had a breakout, 200 DMA not rising, near the 200 DMA but 5% off the 20-day high); Confirmed Stage 2 Breakout (breakout within 3 sessions, above a non-falling 200 DMA); Stage 2 Advancing (price > 200 DMA, 50 > 200, 200 rising); Near Stage 2 Breakout (valid base, between 2% above and 7% below resistance); Stage 1 Base (valid base, flat 200 DMA). Thresholds are team settings (`analysisSettings.ts`).
- Cache (`stage_scan_cache`): a structural result recomputed only when the latest closed candle changes or settings change, plus a live overlay (price and pace-adjusted volume) refreshed about every 10 minutes (`server/stageScanEngine.ts`, `server/stageScanBatch.ts`, `/api/valuation/stage-scan-batch`, `/stage-scan/[symbol]`).
- Presets (`presetScans.ts`, `indicators.ts`, `fundamentals.ts`): Near 52-week high, Volume surge, Relative strength, Fresh breakout, Growth + Stage 2, RSI oversold, RSI strong, ADX trend, SuperTrend buy, Golden cross 10W/30W, 5-year high, High ROCE, Low debt/equity, OPM expansion, 3Y sales and profit CAGR, Heavy capex, Deleverage, Super growth. Technical presets read stored candles; fundamental ones read stored Screener records (`server/fundamentalStore.ts`, "Load missing financials" fetches them in batches of 15). 5-year highs come from `long_term_highs` ("Load 5-year highs", batches of 20, `longRange.ts`).
- Saved scans (`savedScans.ts`, `server/savedScanStore.ts`, `/api/valuation/scans*`): up to 20 per person; the daily cron snapshots every scan's matches (`scan_snapshots`) and, when `notify` is on, pushes newly added tickers (`server/scanSnapshotJob.ts`).

### 7.11 Markets: Breadth, Returns, Results

- Breadth page (`/valuation/breadth`) has two parts:
  - Scanner-universe table (`breadth.ts`, `server/breadthStore.ts`, `market_breadth`): last 30 sessions of advances, declines, above 50/200 DMA, 52-week highs and lows. Recomputed after the daily refresh or with "Refresh breadth" (`POST /api/valuation/breadth/refresh`).
  - Whole-market chart (`breadthDma.ts`, `server/breadthDmaStore.ts`, `DmaBreadthChart.svelte`, `breadth_closes`, `market_breadth_dma`): share of the market cap list (above Rs 500 Cr, NSE EQ else BE else BSE priced, funds excluded) closing below its own 50 and 200 DMA, history from 2024-03-01, shown from 2025-04-01, 6M/1Y/All. A stock counts only with 50 (or 200) of its own closes. Built once by the resumable backfill (`node web/scripts/breadth-backfill.mjs`, admin `POST /api/valuation/breadth/backfill`, or `/api/cron/breadth-backfill`; 240 s slices at the candle rate limit), then the daily cron appends one close per symbol. A missed day needs `--rebuild`. Current listings only (survivorship bias).
- Returns (`/valuation/returns?s=A,B&i=IDX:NIFTY50&p=6M`, `returns.ts`, `server/returnsStore.ts`): stocks and indices rebased to 100; 1M to 1Y from daily closes, 3Y from the weekly series in `long_term_highs`. At most 12 stocks.
- Results (`/valuation/results`, `quarterlyResults.ts`): each company's latest stored quarter versus a year earlier and the quarter before; filters by quarter, industry, list, basket.

### 7.12 Filings: announcements, insider trades, corporate actions

- Feeds (`server/marketIntelJob.ts`, `server/nseMarketFeeds.ts`, `server/marketIntelStore.ts`): market-wide NSE announcements, insider trades (SEBI PIT), SAST Reg 29 disclosures and corporate actions, fetched one IST day per request, progress tracked in `symbol_refresh`, so each run tops up the last two days and backfills older days once (announcements 14 days, insider and SAST 30 days). Announcements older than 120 days are pruned. NSE is called with browser-like headers (`server/nseAnnouncements.ts`).
- Classification (`announcementTags.ts`): deterministic keyword rules, first match wins, routine paperwork first; tags drive tones and the "only important" push setting.
- UI: `/valuation/announcements` (preset scans, keyword search, saved keywords up to 20, trending words), `/valuation/insider-trades` (PIT and SAST tabs, filters), `/valuation/corporate-actions` ("Ex-dates", upcoming actions grouped by date, dividend yield on stored price), `/valuation/filings/[symbol]` (one company, 5 years, fetched by `refreshCompanyFilings` on request through `/api/valuation/company-filings/[symbol]`).
- Parsers are pure and tested: `announcements.ts`, `insiderTrades.ts`, `corporateActions.ts`, `deals.ts`, `boardMeetings.ts`, `nseTime.ts`.

### 7.13 Alerts

Two systems share the delivery channels.

Team inbox (`/valuation/alerts`):

- Types (`alerts.ts`): `price_fair_value` (price crosses the fair value), `sector_rotation` (Rotating In/Out flip, or weekly/monthly RS crossing the team thresholds, default 2% and 5%, `rsThresholds.ts`), `near_breakout` (a stock enters Near Stage 2 Breakout), `strength_volume` (a saved strength rule matches).
- Alerts fire on a change, never on "still true"; the first reading of anything seeds state silently (`alert_state`).
- Checks: `server/alertChecks.ts` (`runPriceChecks` in market hours, `runSectorChecks`, `runBreakoutChecks`, `runStrengthChecks`). Alerts are raised once for the team (`alerts`); read state, enabled types and muted subjects are per user (`alert_reads`, `alert_user_prefs`). Optional email copies via SMTP (`server/alertEmail.ts`, `alertNotify.ts`).
- APIs: `/api/valuation/alerts`, `/check`, `/read`, `/settings`, `/settings/test-email`, `/unread-count` (header bell `AlertBell.svelte`), `/api/valuation/strength/rules*`.

Personal alerts (Web Push and Telegram):

- Tracked companies (`/valuation/tracking`, `/api/valuation/tracking*`): each person picks NSE companies; the one-minute poller fetches their announcements, summarises up to 5 per run with OpenAI (`server/announcementSummary.ts`, retried up to 3 times), and pushes filings published after the person started tracking, once (`announcement_deliveries` claim). "Only important" skips routine filings. Bulk and block deals on tracked companies are pushed too.
- Price alerts (`/valuation/price-alerts`, `alertRules.ts`, `server/alertsJob.ts`): above, below, percent up, percent down on any stock, at most 50 active, each fires once (the rule is claimed when it fires); checked every minute against stored closes, with live quotes for up to 50 symbols during market hours. Shareholding alerts: promoter, FII or DII change beyond a person's thresholds between quarters (Screener shareholding table, `server/shareholding.ts`).
- Delivery (`server/notify.ts`): `createNotifier().notify(userId, payload, link)` sends Web Push to every device (`server/webPush.ts`, VAPID; dead subscriptions are removed) and Telegram if linked (`server/telegram.ts`; one-time `/start <token>` link via `/api/valuation/push/telegram`, webhook `/api/telegram/webhook` checks `TELEGRAM_WEBHOOK_SECRET`). Browser side: `web/src/lib/push.ts`, service worker `web/static/sw.js`, `PushPrompt.svelte` (shown on Alerts pages only).

### 7.14 App shell and per-user state

- Shell components (`web/src/lib/components/shell/`): `AppHeader.svelte` (module switch, tabs, account menu, guest banner), `GlobalSearch.svelte` (`/api/valuation/search/all`: companies, sectors and baskets, theses, team notes; ranking in `server/globalSearch.ts`), `KeyboardShortcuts.svelte`, `PageHeader.svelte`, `BackgroundRuns.svelte`, `AlertBell.svelte`, `PushPrompt.svelte`, guest components.
- Server-side preferences: `user_prefs` (watchlist columns, sort, view, sector card metrics, last watchlist visit for "changed since"), sanitised on every read (`prefs.ts`). `/api/valuation/me/reset` resets them.
- Browser-side state: `viewMemory.ts` / `viewMemory.svelte.ts` (sort, filters, open panels, scroll per view, keyed by user id and schema version, cleared on sign-out), `tabCache.ts` (session cache of shared stored figures, about 2.5 MB budget), `watchlistCache.ts`, `cardCache.ts`. Never put personal data, market data that must be fresh, or credentials in browser storage.
- Team analysis settings (`/valuation/settings`, `analysisSettings.ts`, `server/analysisSettingsStore.ts`, `/api/valuation/settings`, admin writes): fair value percentage, rotation windows and threshold, scanner thresholds.

### 7.15 Admin

- `/admin/users` (`/api/admin/users*`): create users with a temporary password, change role, reset password, remove (never yourself, never the last admin).
- `/valuation/sectors`: Sector manager (7.9).
- Showcase toggle on company pages (5.3).

---

## 8. Background jobs and schedules

| Trigger | Endpoint or function | What it does |
| --- | --- | --- |
| cron-job.org, every minute, `Authorization: Bearer $CRON_SECRET` | `GET/POST /api/cron/announcements` (60 s) | `runAnnouncementCheck`: tag backlog, fetch tracked companies' announcements (last 3 days, 4 at a time), summarise up to 5, deliver pushes, price alerts, then within a 30 s extras budget: board-meeting calendar, bulk/block deals, shareholding, deal and holding alerts, market-wide feeds (`runMarketIntel`). With time left (at least 5 s of a 50 s budget) one slice of the intraday price pass (`runIntradaySlice`). |
| Vercel cron `0 11 * * 1-5` (16:30 IST), catch-ups `0 13 * * 1-5` (18:30), `0 15 * * 1-5` (20:30), `0 2 * * 2-6` (07:30 next morning) | `GET /api/cron/sector-rotation` (300 s; the catch-ups add `?run=` so each is its own cron entry) | Under the price lease: `warmAllSectors` (stalest first, every basket, watchlist and market cap universe symbol; history fetches stop after the 150 s `PRICE_BUDGET_MS`, the rest wait for the next run), then `refreshBreadth`, `appendDailyBreadth`, `runScanSnapshots`. A run with nothing stale costs one quote request per 50 symbols. Returns the price tally (`prices`) and `pricesMs`. |
| Vercel cron `30 9 * * 1-5` (15:00 IST) | `GET /api/cron/alerts` (120 s) | `runPriceChecks` (fair value crossings; skips outside market hours). |
| Manual | `/api/cron/market-intel` | Extra top-up of the NSE feeds. |
| Manual or script | `/api/cron/breadth-backfill?budget=&retry=1&rebuild=1` | One slice of the whole-market breadth backfill. |
| Long-running server only (local dev, container) | `startSectorRotationScheduler`, `startAlertScheduler`, `startIntradayPriceScheduler` in `hooks.server.ts` | Price refresh at 09:30, 12:30, 15:30, 16:30 IST (`refreshSlots.ts`); price checks every 10 minutes in market hours; intraday passes. Disabled with `DISABLE_BACKGROUND_JOBS=true`. |

Intraday price passes (`server/intradayPrices.ts`): a new pass every 30 minutes from 09:15 to 15:30 IST on weekdays plus one settle pass after 16:00, worked in 15 s slices with a cursor in `app_meta`; a lease keeps it from overlapping the nightly job or a manual refresh.

Vercel Hobby crons can run only once a day each (and fire anywhere within the scheduled hour), which is why the per-minute work goes through cron-job.org and the price catch-ups are separate entries.
All cron endpoints return 503 when `CRON_SECRET` is not configured.

---

## 9. API reference

Every JSON endpoint, grouped. "Admin" and "personal" refer to section 5.2. Request and response shapes are in each `+server.ts` (most validate with zod at the top).

Auth and accounts: `POST /api/auth/login`, `POST /api/auth/guest`, `GET /api/auth/me`, `POST /api/account/password`, `POST /logout`, admin `GET|POST /api/admin/users`, `PATCH|DELETE /api/admin/users/[id]`, `POST /api/admin/users/[id]/reset-password`, `GET|PUT /api/admin/showcase`, `GET /api/health`.

Thesis (session, X-API-Key or Bearer JWT):
`GET|POST /api/companies`,
`GET|PATCH|DELETE /api/companies/[id]`,
`PUT /api/companies/[id]/thesis`,
`GET /api/companies/[id]/versions`,
`POST /api/companies/[id]/observations`,
`POST|PUT /api/companies/[id]/health-check`,
`POST /api/companies/[id]/ai-review`,
`GET|POST /api/companies/[id]/decisions`,
`GET|POST /api/companies/[id]/prices`,
`GET /api/companies/[id]/performance`,
`POST /api/companies/[id]/outcome`,
`POST /api/companies/[id]/guidance`,
`GET|POST /api/companies/[id]/notes`, `PATCH|DELETE /api/notes/[noteId]`,
`GET|POST /api/companies/[id]/tables`, `GET|PATCH|DELETE /api/tables/[tableId]`, `POST /api/tables/[tableId]/rows`, `POST /api/tables/[tableId]/rows/bulk`, `PUT|DELETE /api/tables/[tableId]/rows/[rowId]`,
`GET /api/guidance`, `DELETE /api/guidance/[id]`, `POST /api/guidance/[id]/resolve`,
`GET /api/proposals`, `POST /api/proposals/[id]/resolve`,
`GET /api/trackables`, `GET /api/scorecard`, `GET /api/entry-price`,
`GET|POST /api/sectors`, `GET|PATCH|DELETE /api/sectors/[id]`, `POST /api/sectors/[id]/companies`, `DELETE /api/sectors/[id]/companies/[companyId]`,
`GET|POST /api/taxonomy`, `POST /api/taxonomy/niches`, `POST /api/taxonomy/operating-models`, `GET|POST /api/metrics`.

Valuation, company level (`/api/valuation/company/[symbol]/...`): `GET` (Screener record), `GET growth-series`, `GET price-chart`, `GET sparkline`, `GET stage-analysis`, `GET depth`, `GET|POST segments`, `GET team`, `POST notes`, `PUT status`, `PUT coverage`, `POST refresh-price`, `POST refresh-series`. Also `PATCH|DELETE /api/valuation/notes/[id]`, `POST /api/valuation/company-add`, `GET /api/valuation/company-filings/[symbol]`, `GET /api/valuation/compare/[symbol]`.

Saved valuations and templates: `GET /api/valuation/valuations`, `GET|PUT|DELETE /api/valuation/valuations/[symbol]`, `GET .../history`, `GET .../history/[id]`, `POST .../restore`, `GET /api/valuation/valuations/removed`, `GET|POST /api/valuation/templates`, `PUT|DELETE /api/valuation/templates/[id]`, `PUT /api/valuation/templates/defaults`, `GET /api/valuation/activity`.

Lists and preferences: `GET|POST /api/valuation/watchlist-sections`, `PATCH|DELETE /api/valuation/watchlist-sections/[id]`, `POST .../[id]/items`, `PATCH|DELETE .../[id]/items/[symbol]`, personal `GET|PUT /api/valuation/me/prefs`, `POST /api/valuation/me/reset`, `POST /api/valuation/me/visit`, `GET|PUT /api/valuation/settings` (write admin).

Master Tracker and concalls: `GET|POST|DELETE /api/valuation/master-tracker`, `POST /api/valuation/master-tracker/[symbol]`, `GET /api/valuation/master-tracker/identity`, `POST /api/valuation/master-tracker/sample` (mock only), `POST /api/valuation/concalls/run`, `GET /api/valuation/concalls/company/[symbol]`.

Markets: `GET /api/valuation/sectors`, admin `POST /api/valuation/sectors/majors`, `PATCH|DELETE /api/valuation/sectors/majors/[key]`, `POST /api/valuation/sectors/baskets`, `PATCH|DELETE /api/valuation/sectors/baskets/[key]`, `PUT .../[key]/majors`, `POST .../[key]/symbols`, `DELETE .../[key]/symbols/[symbol]`, `POST /api/valuation/sectors/verify`, `GET /api/valuation/sector-rotation/[key]`, `GET /api/valuation/sector-rotation-major/[key]`, `GET /api/valuation/sector-symbols/[key]`, `GET /api/valuation/sector-refresh-plan`, admin `POST /api/valuation/sector-rotation-import`, `POST /api/valuation/refresh-batch`, `POST /api/valuation/refresh-benchmark`, `GET /api/valuation/sparklines`, `GET /api/valuation/stage-scan-batch`, `GET /api/valuation/stage-scan/[symbol]`, `GET /api/valuation/presets`, `GET|POST /api/valuation/scans`, `PATCH|DELETE /api/valuation/scans/[id]`, `POST /api/valuation/scans/[id]/snapshot`, `GET /api/valuation/strength`, personal `GET|PUT /api/valuation/strength/prefs`, `GET|POST /api/valuation/strength/rules`, `PATCH|DELETE /api/valuation/strength/rules/[id]`, `POST /api/valuation/breadth/refresh`, admin `POST /api/valuation/breadth/backfill`, `GET /api/valuation/financials/missing`, `POST /api/valuation/financials/batch`, `GET /api/valuation/long-range/missing`, `POST /api/valuation/long-range/batch`, `GET /api/valuation/mcap-universe/missing-history`.

Search: `GET /api/valuation/search`, `GET /api/valuation/search/all`, `GET /api/valuation/symbol-search`.

Alerts and delivery: `GET /api/valuation/alerts`, `POST /api/valuation/alerts/check`, `POST /api/valuation/alerts/read`, `GET|PUT /api/valuation/alerts/settings`, `POST /api/valuation/alerts/settings/test-email`, `GET /api/valuation/alerts/unread-count`, personal `POST /api/valuation/tracking`, `GET|DELETE /api/valuation/tracking/[symbol]`, `POST /api/valuation/price-alerts`, `PATCH|DELETE /api/valuation/price-alerts/[id]`, `PUT /api/valuation/holding-alerts`, `POST /api/valuation/announcement-keywords`, `DELETE /api/valuation/announcement-keywords/[id]`, personal `GET /api/valuation/push/config`, `GET|PUT /api/valuation/push/settings`, `POST|DELETE /api/valuation/push/subscribe`, `GET|POST|DELETE /api/valuation/push/telegram`, `POST /api/valuation/push/test`, public `POST /api/telegram/webhook`.

Cron (Bearer `CRON_SECRET`): `/api/cron/announcements`, `/api/cron/sector-rotation`, `/api/cron/alerts`, `/api/cron/market-intel`, `/api/cron/breadth-backfill`.

Internal: `POST /_internal/concall-research` (Python, Bearer `CONCALL_SERVICE_TOKEN`).

---

## 10. Configuration, build and operations

### 10.1 Environment variables (names only; never commit or print values)

| Variable | Used for |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon pooler in production). |
| `JWT_SECRET`, `API_KEY`, `ANALYST_NAME` | Script access to thesis APIs. |
| `CRON_SECRET` | Cron endpoints. |
| `ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`, `ANGEL_PIN`, `ANGEL_TOTP_SECRET` | Angel One prices. |
| `OPEN_AI_KEY` (or `OPENAI_API_KEY`), `OPENAI_MODEL` | Master Tracker, concall analysis, announcement summaries. Live testing uses `gpt-5.6-luna` only. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Thesis AI reviewer. |
| `AI_FEATURES` | `off` disables every AI call (`server/aiSwitch.ts`). |
| `CONCALL_SERVICE_TOKEN`, `CONCALL_SERVICE_URL` | Document service auth; URL only for an external service. |
| `SCREENER_MCP_URL`, `SCREENER_MCP_TOKEN`, `SCREENER_MCP_COMMAND`, `SCREENER_MCP_ARGS` | Optional Screener MCP instead of the built-in scraper. |
| `SCREENER_SESSION_ID` | Screener premium cookie for segment numbers. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Optional Telegram (setWebhook must be registered). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_EMAIL_TO` | Optional alert emails. |
| `APP_BASE_URL` | Absolute links in alert emails. |
| `MASTER_TRACKER_TEST_MODE`, `MASTER_TRACKER_LIVE_TEST_MODE` | Local test harness flags; keep off in deployment. |
| `DISABLE_BACKGROUND_JOBS` | Turns off in-process schedulers (tests). |
| `VERCEL`, `VERCEL_URL`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_AUTOMATION_BYPASS_SECRET` | Set by Vercel or used by deployed tests. |

Template: `web/.env.example`. Local secrets live in `web/.env` and the root `.env` (git-ignored).

### 10.2 Local development

1. `docker compose up -d postgres` from the repo root (Postgres 16 on port 45432, user/db `thesis`).
2. Apply migrations `0000` to `0037` in order with `docker exec -i thesistrack-postgres-1 psql -U thesis -d thesis < web/drizzle/<file>`.
3. Seed taxonomy as needed (tests use `web/tests/taxonomyFixture.ts`); `web/_prod_to_local.mjs <prodEnvFile>` copies production into the local database (destructive locally).
4. `cd web && npm ci && npm run dev`.
5. Python (Master Tracker documents locally): create `services/concall/.venv` and install `requirements.txt`; the Node side runs it as a subprocess.

### 10.3 Build and deploy

- `npm run build` = `vite build` + `scripts/package-concall.mjs` (adds the Python function and its route to `.vercel/output`).
- On Windows the Vercel adapter fails with EPERM on symlinks; verify production builds with `npm run build:linux` (Docker, `node:24-trixie-slim`, repo mounted read-only).
- Deploy: pushing `master` to GitHub deploys production on Vercel project `thesis-track`. Never run `vercel --prod` from `web/`. Pushing, production migrations and production data writes need explicit user approval.

### 10.4 Scripts (`web/scripts/`)

| Script | Purpose |
| --- | --- |
| `build-mcap-universe.mjs` | Build `research/companies_mcap_above_500cr.csv` from AMFI, NSE, BSE and Angel One files (`research/README_companies_mcap.md`). |
| `import-mcap-universe.mjs <csv> [--apply]` | Upsert `valuation.mcap_universe` by ISIN; missing companies become inactive. Dry run by default. |
| `import-sector-taxonomy.mjs <json> [--apply] [--replace]` | Merge a sector taxonomy into the database. |
| `fetch-industry-classification.mjs` | NSE 4-level industry classification via Screener, resumable. |
| `breadth-backfill.mjs [--base] [--budget] [--retry] [--rebuild]` | Loop the breadth backfill endpoint. |
| `backfill-entry-price.mjs [--apply]` | Fill missing thesis entry prices. |
| `sync-observations.mjs` | Thesis metric snapshot to observations. |
| `merge-valuation-data.mjs` | One-time copy of the old Valuation Dashboard database (historical). |
| `configure-tracker-production.mjs` | Master Tracker production configuration. |
| `dev-master-tracker.mjs` | Isolated mock preview on port 5180. |
| `package-concall.mjs`, `build-linux.mjs` | Build steps (10.3). |

---

## 11. Testing and recipes

### 11.1 Tests

- Type check: `cd web && npm run check` (must be 0 errors).
- Unit and integration: `npx vitest run <files>` (files run one at a time because DB-backed job tests share one database). DB tests need the local Docker Postgres and skip without it (`web/tests/dbReachable.ts`). For small changes run only the relevant test files.
- E2E: Playwright, run one spec at a time (port 5179 and `web/test-results` collide): `npm run test:tracker`, `npx playwright test tests/e2e/mobile-overflow.spec.ts`, `compare.spec.ts`, `ingest-json.spec.ts`. Projects `desktop` (1440x1000) and `mobile` (Pixel 7).
- Live (opt-in, real providers): `tests/live/*` with `playwright.live.config.ts`, `playwright.piccadily.config.ts`, `playwright.production.config.ts`. Distinguish mock coverage from real provider coverage when reporting.
- Python: from `services/concall`, `.venv/Scripts/python.exe -m unittest test_server test_hints -v`.

### 11.2 Recipe: add an API endpoint

1. Create `web/src/routes/api/<area>/<name>/+server.ts` exporting `GET`/`POST`/....
2. Validate the body with zod; return `json(...)`; map expected failures to 4xx (`error(400, ...)`, or the `{detail}` helpers for thesis routes).
3. Put database code in a `server/*Store.ts` and decisions in a pure module with tests.
4. Check `web/src/lib/access.ts`: is the path admin-only, personal (read_only may write), or public? Add a prefix there and a test in `access.test.ts` if needed.
5. Guest mode: if guests should read it, add it to the allowlist in `web/src/lib/guest.ts` (`guestMayCallApi`) and, if it is about one company, make sure `guestShowcaseTarget` covers it. Writes are always refused for guests.
6. Long work: set `export const config = { maxDuration: N }` and keep each call under the limit by batching from the client.

### 11.3 Recipe: add a table or column

1. New file `web/drizzle/NNNN_name.sql` (next number), additive and idempotent.
2. Describe it in `schema.ts` (public) or `valuationSchema.ts`/`marketIntelSchema.ts` (valuation).
3. Apply locally, run the related tests.
4. Ask before applying to production; apply it before deploying code that needs it.

### 11.4 Recipe: add a page or tool

1. Route under `web/src/routes/valuation/<tool>/` with `+page.server.ts` reading stored data only.
2. Register the prefix in `web/src/lib/modules.ts` and a tab in `AppHeader.svelte`; optionally a shortcut in `KeyboardShortcuts.svelte`.
3. Follow the calm layout conventions (section 4) and scope styles under `.vd`.
4. Decide guest behaviour (`guestMayOpenPage` or a `LOCKED_FEATURES` entry).
5. Check 390px width with `mobile-overflow.spec.ts` (add the route to its list).

### 11.5 Recipe: add a preset scan or alert type

- Preset: add the id to `PresetId`, a `PresetDef` in `PRESETS` and the rule in `passesPreset` (`presetScans.ts`), any new number in `computePresetMetrics` (recomputed on the next structural scan), tests in `presetScans.test.ts`.
- Team alert type: add it to `ALERT_TYPES` and labels in `alerts.ts`, a detector that compares previous and current state, a `run...Checks` function in `server/alertChecks.ts` writing through `insertAlert`, and schedule it. Personal alerts reuse `createNotifier` from `server/notify.ts`.

---

## 12. Invariants (do not break)

1. Page views and guest requests never call Angel One, Screener, NSE or an AI provider; they read stored data. Fetching happens only in cron jobs, schedulers or explicit buttons.
2. `thesis_versions` and `position_decisions` are append-only. Never weaken the triggers; delete only through the admin delete-company path.
3. Automation proposes, humans decide: the rule engine and AI reviewer write `status_proposals`, never `thesis_scenarios.status`.
4. Never guess a stock symbol or company name: verify against Screener (`verifySymbol`), store the verified name.
5. AI outputs are validated: Master Tracker citations must match supplied page text; concall guidance quotes must appear in the transcript; model output that fails the schema writes nothing.
6. Live AI testing uses `gpt-5.6-luna` only unless the user says otherwise; `AI_FEATURES=off` must disable every AI call.
7. Alerts fire on transitions, not on states, and seed silently the first time.
8. Saved valuations use optimistic concurrency; never save without the loaded `version`.
9. Every guest response goes through redaction; guests never see team identities and never write.
10. Never edit an applied migration; production migrations before dependent deploys, with approval.
11. No secrets in git, logs, docs or test output; `.production.env` is stale and must not be used.
12. No em dashes in code, UI text, commits or docs.
13. Pages must fit 390px phones.

---

## 13. Status at the time of writing (2026-11-03)

Check `.claude/project-memory.md` and `git log` for anything newer.

- On `master` (deployed): everything in this document except the items below. `feat/breadth-50dma` (DMA breadth, intraday price passes, lists merged into sections, calmer UI) is merged into master (`af42525`).
- Only on `feat/guest-mode` (not pushed when last recorded): guest mode and showcase (migration `0037`, renamed from `0035`, already applied to production with a `'*'` row), background runs that survive navigation, and recent fixes.
- Open items recorded in project memory: production browser verification of the HFCL document fix; retry or upload for failed document downloads; Telegram is configured only if its three env vars and the webhook exist; 13 active `mcap_universe` rows have no price source (deactivation not approved); weekend candles in some `company_growth_series_cache` rows (cleanup not approved); a leaked Vercel bypass secret should be rotated; the branch `feat/guidance-tables-import-redesign` is unmerged.
