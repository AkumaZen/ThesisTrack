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
- merge-valuation, scorecard, scanner-universe and the HFCL document fix are all in master and deployed.
- HFCL fix (not deployed): `services/concall` accepts `nseSymbol`/`isin`/`documentLinks`; order Screener links, NSE,
  then BSE; short error reasons (`failed_sources`); web wording "could not be retrieved (BSE returned HTTP 403)".
  Checked live for HFCL with the BSE API forced to 403: Screener gave Q1 FY27, Q4 and Q3 FY26 transcripts and decks.

## Decisions
- 2026-10-18: announcement alerts LIVE (personal tracked companies `/valuation/tracking`, NSE per-symbol polling, OpenAI summary, Web Push). Poller `/api/cron/announcements` (CRON_SECRET bearer, maxDuration 60) is called every minute by cron-job.org; it also tops up the market feeds within a time budget (local run 0.2 to 21 s). Code: `lib/valuation/announcements.ts`, `server/announcementJob.ts`, `lib/server/webPush.ts`.
- 2026-10-19: StockScans round LIVE on production (master `f77b37f` plus a TO DO commit). Migrations 0022-0032 applied to Neon (no 0029 exists). Features: results, announcements+tags, insider/SAST, corporate actions, deals, shareholding, Telegram (optional env `TELEGRAM_BOT_TOKEN`, `_BOT_USERNAME`, `_WEBHOOK_SECRET` + setWebhook), scanner presets, lists, price/holding alert rules, saved scans, returns, breadth, concalls (`lib/valuation/concall/`, migration 0032), red flags. Nav: Concalls and Red flags sit in the Valuation group; the Analysis row is at the 1280px limit. Scan alerts use the shared `server/notify.ts`.
- Concall guidance bases: growth_pct, level, margin_pct, margin_change_pp (a change in margin points vs the year-ago period; contraction is negative); PROMPT_VERSION 2. `ConcallPanel` hides itself for companies outside the Master Tracker.
- Production still needs, by the user: "Load missing financials" and "Load 5-year highs" in the UI; segments need Screener premium; concall analysis about $0.04 per transcript (assumed). Weekend candles: 518 of 521 production `company_growth_series_cache` rows hold one; cleanup NOT approved.
- Local: DB-backed vitest seeds its own taxonomy row (`web/tests/taxonomyFixture.ts`); fresh DB 0000-0032 gave 1066 passed / 5 skipped. mobile-overflow signed in 70/70 (+8 for concall routes). Stage scanner: applying a preset (URL or chip) switches to the All stage tab.
- 2026-10-19 (branch `feat/breadth-50dma`, NOT merged/deployed): whole-market "% below 50 DMA" chart on `/valuation/breadth` (`DmaBreadthChart.svelte`, 50/200 DMA toggle, 6M/1Y/All). Data: migration 0033 (`valuation.breadth_closes` per-symbol int/float arrays + status, `market_breadth_dma` daily aggregate). Universe = Angel One scrip master NSE `-EQ` (BE only if no EQ), funds/ETFs removed by name (`breadthDma.ts` `isFundName`), about 2,680 symbols; history from 2024-03-01 (200 DMA warmup), chart from 2025-04-01. A day counts only stocks with 50 (200) closes to date. Backfill `runBreadthBackfill` (`server/breadthDmaStore.ts`): resumable by per-symbol status, 240 s slices (about 480 symbols each at the 2/s candle limit), admin button (`POST /api/valuation/breadth/backfill`, admin only), cron route `/api/cron/breadth-backfill`, CLI `node scripts/breadth-backfill.mjs`. Daily: `appendDailyBreadth` runs in `/api/cron/sector-rotation` (quotes, weekend skipped, missed-session symbols marked stale). Local run: 2,678 symbols, 0 failures, 22.6 min, 12 MB, latest 76.3 (19 Oct). PRODUCTION NEEDS: apply 0033 to Neon BEFORE the merge, then run the backfill once (admin button, about 6 slices, or CLI with `--base` and the prod CRON_SECRET). Limits: survivorship (today's listings only); a missed cron day needs `--rebuild`.
- 2026-10-17: stay on Vercel only; EC2 abandoned (BSE 403 from AWS too).

## Current Focus
- Production is on the StockScans round. Next: user runs the "Load" buttons, tests, sets the Telegram env if wanted, decides on the weekend-candle cleanup.

## Known Issues / Unresolved Decisions
- Master Tracker: BSE's API returns 403 to all cloud servers (probe 2026-10-10). Worked around, see Completed Work.
- A Vercel deployment-protection bypass secret leaked into a session log; rotate it.
- DB-backed tests pass with the local docker DB up (683/683, 0 skipped); they skip when Docker is down. Apply new
  migrations locally with `docker exec -i thesistrack-postgres-1 psql -U thesis -d thesis` (`_prod_migrate.mjs` refuses non-prod hosts).
- Production has 35 companies but only 2 thesis_scenarios (both siddhesh.dige); confirm expected.

## Next Steps
1. User: scanner "Load missing history" (admin), "Load missing financials", "Load 5-year highs". Browser-check the new pages.
2. Verify the HFCL fix on Vercel (Master Tracker, Jun 2026): documents from Screener/NSE, BSE 403 shown as a short warning.
3. Not merged: `feat/guidance-tables-import-redesign`.
4. Open: Retry/Upload for failed document fetches; rotate the leaked Vercel bypass secret; stale `.production.env`.

## Verification
- From `web/`: `npm run check`; `npx vitest run <files>` (full suite: `npx vitest run`);
  `npm run test:tracker` (mock Master Tracker, desktop + mobile); `tests/e2e/mobile-overflow.spec.ts`.
- Python downloader: `services/concall/.venv/Scripts/python.exe -m unittest test_server test_hints -v` (from `services/concall`).
- Local Windows build fails at the adapter-vercel step (EPERM); the Vercel build log is the real check.
