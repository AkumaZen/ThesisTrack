# Project Memory

Updated 2026-10-19. Single continuity record; one designated Sonnet owner updates it, Opus reviews
significant changes. Historical references, loaded only as relevant: `harness/memory/STATE.md`,
`harness/memory/decisions.md`, `harness/memory/gotchas.md`. Do not treat old records as current task queues.

## Architecture and constraints
- Thesis Tracker: team Indian-equity research app. Thesis `/`: 7-pillar theses, append-only
  versions, kill triggers, reviews and decisions. Valuation tools under `/valuation/*`.
- Single SvelteKit/Svelte 5 runes/TypeScript app in `web/`; Drizzle migrations `web/drizzle/`;
  APIs `web/src/routes/api/`; valuation logic `web/src/lib/valuation/`.
- Neon Postgres: thesis tables `public`, valuation tables `valuation`; pooled connections disable
  prepared statements. Vercel `thesis-track`, Singapore; push to GitHub master deploys production.
  Vercel only; EC2 abandoned. Auth uses `tt_session`, admin/read_write/read_only roles.
- Page views read stored prices; Angel One refresh jobs batch 50. Master Tracker research uses
  `services/concall/` Python function, Screener financials and OpenAI `gpt-5.6-luna`.
- Neo-brutalist CSS: `web/src/routes/layout.css`, `web/src/lib/styles/shell.css`; valuation styles
  scoped `.vd`; fit 390px phones. No em dashes; no unnecessary abstractions or dependencies.
- `thesis_versions`/`position_decisions` append-only. Never edit applied migrations. Apply required
  production migrations before deploying dependent code. Explicit approval for destructive work,
  deployment, irreversible migrations and production writes. Preserve unrelated changes and secrets.
  `.production.env` is stale Aiven configuration. Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Completed and established behavior
- Thesis/valuation unified; Master Tracker shipped; mobile fit and batched prices implemented.
  merge-valuation, scorecard, scanner-universe and HFCL document fix merged/deployed.
- HFCL downloader accepts nseSymbol/isin/documentLinks; sources Screener, NSE, then BSE; reports
  short failed-source reasons. Forced-BSE-403 live test retrieved HFCL transcripts/decks via Screener.
  Production browser verification remains pending.
- Announcement alerts live: personal `/valuation/tracking`, NSE polling, AI summaries, Web Push.
  `/api/cron/announcements` bearer CRON_SECRET called every minute by cron-job.org; also tops up
  market feeds within budget. Core: announcements.ts, server/announcementJob.ts, server/webPush.ts.
- StockScans round live (master f77b37f plus TO DO commit): results/tags, insider/SAST, corporate
  actions/deals/shareholding, presets/lists/alert rules/saved scans, returns/breadth, concalls/red flags.
  Neon migrations 0022-0032 applied; 0029 absent. Scan alerts share server/notify.ts.
- Concall guidance bases: growth_pct, level, margin_pct, margin_change_pp; contraction negative;
  PROMPT_VERSION 2. ConcallPanel hidden outside Master Tracker. Analysis nav near 1280px limit.
- DB-backed Vitest seeds taxonomyFixture.ts; fresh local migrations 0000-0032 previously yielded
  1066 passed/5 skipped. Signed-in mobile overflow previously 70/70 plus 8 concall routes.
  Stage scanner preset selection switches to All stage tab. These are historical, not current checks.
- market-story-post deck spec locked (~/.claude skill): palette #FFFFFF/#0A0A0A/#F4F4F5 + only accent #2563EB,
  3 fonts, hard 4-6px shadows, no gradients/tints/radius; enforced by `story.py check` (run by png/build).

## Nav and declutter round (2026-10-20, uncommitted on feat/breadth-50dma)
- Nav is 5 modules in `web/src/lib/modules.ts` (Thesis, Valuation, Markets, Filings, Alerts); URLs
  unchanged. Lists/scans/settings are not tabs; Settings and admin Sector baskets live in the account menu.
  "New" badges removed; PushPrompt shows only on Alerts pages. `/export` and its API/exporter removed.
- Lists merged into watchlist sections by migration 0034 (`0034_merge_team_lists_into_sections.sql`):
  production must apply 0034 BEFORE deploying the dependent code.
- Declutter conventions: one-sentence subtitle, long help in a `calm-disclosure` "How this works";
  one-row filters, extras under "More filters"; maintenance actions under a "Data" disclosure or quiet
  `calm-btn` at toolbar end; row actions text-style; fewer borders. Shared classes (calm.css removed) all in
  `web/src/routes/layout.css`: `calm-btn`, `calm-disclosure` (+`-body`), `calm-toolbar`/`calm-end`,
  `calm-field`, `calm-more`, `calm-data`, `calm-meta`, `calm-flat`. Thesis `+page.ts` loads pass their
  own `fetch` to `$lib/api` (optional last arg), avoiding SvelteKit window.fetch warnings.
- Master Tracker: quarters without guidance are a checkbox strip, quarters with guidance stack,
  superseded versions under "Earlier versions"; e2e spec updated accordingly. Run Playwright e2e
  exclusively (port 5179 and web/test-results collide across workers).

## Active product work and unresolved decisions
- `feat/breadth-50dma` NOT merged/deployed: `/valuation/breadth` 50/200 DMA percentage-below chart,
  6M/1Y/All, DmaBreadthChart.svelte. Migration 0033 adds breadth_closes arrays/status and
  market_breadth_dma aggregates. Angel NSE EQ universe (BE fallback), funds excluded;
  history 2024-03-01, display 2025-04-01; denominator uses sufficient closes per stock/day.
- Breadth backfill: server/breadthDmaStore.ts runBreadthBackfill, resumable 240s slices at 2/s;
  admin POST /api/valuation/breadth/backfill, /api/cron/breadth-backfill,
  `node scripts/breadth-backfill.mjs`. Daily append in /api/cron/sector-rotation skips weekends,
  marks missed symbols stale. Historical local run: 2678 symbols, 0 failures, 22.6min, 12MB,
  latest 76.3 on Oct19. Production needs approved migration0033 BEFORE merge, then one backfill
  (~6 slices or CLI --base using secret safely). Current-listing survivorship; missed day needs --rebuild.
- User still needs scanner Load missing history, Load missing financials, Load 5-year highs and
  browser checks. Segments require Screener premium. Optional Telegram needs TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET and setWebhook. Never record secret values.
- Weekend candles in 518/521 production company_growth_series_cache rows; cleanup NOT approved.
- Verify HFCL on Vercel Master Tracker June2026: Screener/NSE documents, concise BSE403 warning.
  Retry/Upload for failed downloads remains open. BSE API403 is a known cloud limitation.
- `feat/guidance-tables-import-redesign` remains unmerged. Rotate leaked Vercel bypass secret.
  Confirm whether 35 production companies with only 2 thesis_scenarios (siddhesh.dige) is expected.

## Verification workflow
- Read `harness/skills/master-tracker-testing.md` before Master Tracker browser work. Live AI tests
  use gpt-5.6-luna only unless user changes instruction. Distinguish mocks from provider coverage.
- From web/: npm run check; npx vitest run <relevant files>; npm run test:tracker (mock desktop/mobile);
  tests/e2e/mobile-overflow.spec.ts. DB tests need local Docker and skip without it. Apply local
  migrations with docker exec -i thesistrack-postgres-1 psql -U thesis -d thesis;
  _prod_migrate.mjs refuses non-production hosts.
- Python: services/concall/.venv/Scripts/python.exe -m unittest test_server test_hints -v from
  services/concall. Windows adapter-vercel EPERM is known; do not call a failing build verified.

## Active adaptive harness contract
- Opus5.5 Medium only: architecture, requirements, coordination, actual code/evidence review;
  NEVER application implementation. Sonnet5.5 Medium default, Low simple work; Haiku5.5 Low bounded
  exploration/mechanical tasks. Models explicit. Only lead spawns; workers reuse context.
- One cheap subagent for small tasks; native shared tasks/messaging teams for independent ongoing
  collaboration, 2 when useful, 3 default maximum; more requires concrete throughput benefit.
  Separate ownership/interfaces before parallel work; integrate and validate. Shut down idle workers.
- Requirements/acceptance supplied once, redirect affected tasks on changes. One Sonnet memory
  owner; recover here after compaction. After two failed repairs Opus re-diagnoses. No false passes.
- In-process teams; compaction tokens Opus300000, Sonnet600000, Haiku100000 (debug effectiveWindow
  280k/580k/80k, native reserve; no threshold-filling compaction test run).
- Task tools root cause: VS Code extension 2.1.301 panel runs the CLI over stream-json SDK protocol
  and hard-codes CLAUDE_CODE_ENABLE_TASKS=0 (extension.js c5). Fix: project settings env
  CLAUDE_CODE_ENABLE_TASKS=1 (settings env overrides inherited env). Verified 2026-10-19: live panel
  session gained TaskCreate/TaskGet/TaskList/TaskUpdate without restart; terminal CLI 2.1.303 with
  inherited 0 also got them.
- Panel is an SDK-protocol session: docs say teammates are not spawned there; use the terminal CLI
  (`claude` in a terminal, or claudeCode.useTerminal) for native teams. Panel subagents work.
- CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5-5 is a fallback only (definition model wins; _FORCE
  unset). Transcripts: unnamed executor-haiku subagent ran haiku-5-5 low; executor-medium ran
  sonnet-5-5 medium; lead opus-5-5 medium.
- Terminal team smoke (session 51ede6af, CLI 2.1.303): in-process teammates executor-haiku ->
  haiku-5-5 low, executor-low -> sonnet-5-5 low; shared tasks created/owned/completed,
  teammate-to-teammate SendMessage, worker reuse, both shutdown approvals. Limitation: the lead
  idled after shutdown approvals (they did not wake it); nudge the lead or do not block on shutdown
  confirmation. Harness: scratchpad pywinpty driver (not in repo).
- Original permissions auto-allows for push/prod scripts changed to ask. No app code changed, no
  deploy/push/prod writes. Initial multiworker -p smoke reported $0.602752135 list-equivalent
  usage (not an invoice or performance benchmark).
- Existing MCP settings preserved; smoke disabled MCP for isolation, so live MCP connectivity is
  not verified. No unrelated app features requested.
