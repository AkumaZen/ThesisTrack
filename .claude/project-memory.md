# Project Memory

Compact continuity file. Detailed todo and history: `harness/memory/STATE.md`; ADRs in
`harness/memory/decisions.md`; gotchas in `harness/memory/gotchas.md`. Initialised 2026-10-17
from the repo at master `175abd5`.

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

## Current Focus
- Unknown until the user picks the next task (see Next Steps).

## Known Issues / Unresolved Decisions
- Master Tracker: BSE's API returns 403 to all cloud servers (probe 2026-10-10: Vercel sin1 and
  bom1 both 403). BSE file server PDFs, NSE API/archives, Screener and company sites work. The
  downloader stops at the BSE lookup, so HFCL shows "no calls found". Unfixed.
- EC2 plan (branch `ec2-hosting`) assumes EC2 may fix BSE; the AWS bom1 result says it likely will not.
- A Vercel deployment-protection bypass secret leaked into a session log; rotate it.
- Failing tests: `metrics.test.ts`; `services.integration.test.ts` cleanup (append-only); one
  Screener network test.
- Production has 35 companies but only 2 thesis_scenarios (both siddhesh.dige); confirm expected.

## Next Steps
1. Fix Master Tracker sources: NSE + Screener concall links first, BSE fallback, "could not retrieve" wording.
2. Branch `scorecard`: apply 0018 + 0019 to production, entry-price backfill, merge, browser check.
3. Branch `scanner-universe`: apply 0020, import the market-cap universe, merge, load history.
4. Correct stale STATE.md header and BUGS-TO-FIX.md (most items there are already fixed).

## Verification
- From `web/`: `npm run check`; `npx vitest run <files>` (full suite: `npx vitest run`);
  `npm run test:tracker` (mock Master Tracker, desktop + mobile); `tests/e2e/mobile-overflow.spec.ts`.
- Python downloader: `services/concall/.venv/Scripts/python.exe -m unittest test_server -v`.
- Local Windows build fails at the adapter-vercel step (EPERM); the Vercel build log is the real check.
