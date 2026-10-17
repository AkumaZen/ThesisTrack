# Project Memory

Compact continuity file. Detailed todo and history: `harness/memory/STATE.md`; ADRs in
`harness/memory/decisions.md`; gotchas in `harness/memory/gotchas.md`. Initialised 2026-10-17
from master `175abd5`; updated 2026-10-17.

## Project Overview
- Thesis Tracker: a team web app for Indian equity research. Thesis module at `/` (7-pillar
  theses, append-only versions, kill triggers, review queue, buy/sell decisions) and valuation
  tools at `/valuation/*` (watchlist, company valuation, Compare, Sector rotation, Sector baskets,
  Breakout/stage scanner, alerts, Master Tracker). Users: rohit.negi, siddhesh.dige, shishir.bhat.

## Architecture Decisions
- One SvelteKit app in `web/` (Svelte 5 runes, TypeScript, Drizzle ORM). APIs under
  `web/src/routes/api/`; valuation code in `web/src/lib/valuation/`.
- Postgres: thesis tables in `public`, valuation tables in schema `valuation`. Production is Neon
  (project holy-leaf-50072157, Singapore); Vercel uses the pooled URL, so prepared statements are off.
- Hosting: Vercel project `thesis-track` (function region sin1). A push to GitHub `master`
  deploys production. Crons in `web/vercel.json` (Hobby plan: once a day each).
- Auth: email + password, cookie `tt_session`, roles admin / read_write / read_only.
- Prices: page views read stored prices only (Angel One fetched by refresh jobs, batched 50 per call).
- Master Tracker: concall/annual-report research via a Python function (`services/concall/`)
  packaged into the same deployment, OpenAI `gpt-5.6-luna` for drafts, financials from Screener.
- Design: neo-brutalist system (`web/src/routes/layout.css`, `web/src/lib/styles/shell.css`);
  valuation CSS scoped under `.vd`. Pages must fit 390px phones.

## Important Constraints
- `thesis_versions` and `position_decisions` are append-only (DB triggers; deletes need
  `set_config('app.allow_thesis_delete','on',true)`).
- Never edit an applied migration; add a new numbered file in `web/drizzle/`.
- Production migrations must be applied BEFORE merging code that uses them.
- No em dashes in any writing. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push/deploy, production DB writes and destructive actions need fresh explicit user approval.
  Default: land locally, let the user test, then push.
- Never commit secrets or .env files; `.production.env` is stale (old Aiven DB).

## Completed Work
- Valuation dashboard merged into one app; production on Neon + Vercel.
- Master Tracker shipped (2026-10-10, `d9a41bb`); its tables (0015/0016) exist in production.
- Mobile fit, header split into Thesis/Valuation/Sector/Analysis, batched price refresh (2026-10-17).
- Multi-agent setup: `.claude/agents/` master + executor-medium + executor-low (2026-10-17).
- Branch `merge-valuation` (LOCAL, unpushed; master `175abd5` + setup + merges) now also holds `scorecard` and
  `scanner-universe` (clean merges), the HFCL document fix, and the compareStatements test flake fix. svelte-check
  0 errors; full vitest 655 passed / 28 skipped (twice); Python `test_server` + `test_hints` 14 pass.
- HFCL fix (not deployed): `services/concall` accepts `nseSymbol`/`isin`/`documentLinks`; order Screener links, NSE,
  then BSE; short error reasons (`failed_sources`); web wording "could not be retrieved (BSE returned HTTP 403)".
  Checked live for HFCL with the BSE API forced to 403: Screener gave Q1 FY27, Q4 and Q3 FY26 transcripts and decks.

## Current Focus
- Finishing rollout. Production (c342a6b) is deployed and healthy; 0018, 0019, 0020 are applied and the mcap universe
  (1,496 rows) is imported. The entry-price backfill is applied (STLTECH 897.4, BALUFORGE 480.7; 0 left). Pending for the USER: the scanner "Load missing history".

## Known Issues / Unresolved Decisions
- Master Tracker: BSE's API returns 403 to all cloud servers (probe 2026-10-10). Worked around, see Completed Work.
- EC2 plan (branch `ec2-hosting`) assumes EC2 may fix BSE; the AWS bom1 result says it likely will not.
- A Vercel deployment-protection bypass secret leaked into a session log; rotate it.
- DB-backed tests pass with the local docker DB up (683/683, 0 skipped); they skip when Docker is down. Apply new
  migrations locally with `docker exec -i thesistrack-postgres-1 psql -U thesis -d thesis` (`_prod_migrate.mjs` refuses non-prod hosts).
- Production has 35 companies but only 2 thesis_scenarios (both siddhesh.dige); confirm expected.

## Next Steps
1. User: scanner "Load missing history" (admin). Browser-check the thesis page and the scanner.
2. Verify the HFCL fix on Vercel (Master Tracker, Jun 2026): documents from Screener/NSE, BSE 403 shown as a short warning.
3. Not merged: `ec2-hosting`, `feat/guidance-tables-import-redesign`.
4. Open: Retry/Upload for failed document fetches; rotate the leaked Vercel bypass secret; stale `.production.env`.

## Verification
- From `web/`: `npm run check`; `npx vitest run <files>` (full suite: `npx vitest run`);
  `npm run test:tracker` (mock Master Tracker, desktop + mobile); `tests/e2e/mobile-overflow.spec.ts`.
- Python downloader: `services/concall/.venv/Scripts/python.exe -m unittest test_server test_hints -v` (from `services/concall`).
- Local Windows build fails at the adapter-vercel step (EPERM); the Vercel build log is the real check.
