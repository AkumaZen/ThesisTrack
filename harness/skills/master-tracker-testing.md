# Master Tracker testing workflow

Saved 6 October 2026 at the user's request to avoid repeating setup and diagnosis.
Success means exercising the changed behavior and reporting what actually passed.
Reuse this procedure, installed dependencies, and document caches; never treat an old
passing result as proof that changed code still works.

## Choose the smallest useful check

Run these PowerShell commands from `web/`. Use an existing test title matching the
change; the following example covers creation, quarter selection and saving:

```powershell
npx.cmd --no-install playwright test tests/e2e/master-tracker.spec.ts --project=desktop -g "explicit company creation"
```

This uses mock providers on an isolated server at port 5179 and makes no live AI
request. Playwright starts that server itself. The current config deliberately
does not reuse an arbitrary existing server: doing so could test the wrong mode.
Do not change that isolation just to reduce startup time.

For broader tracker UI changes, include both desktop and mobile:

```powershell
npm.cmd run test:tracker
```

For provider changes, start with the focused unit tests:

```powershell
npx.cmd --no-install vitest run src/lib/valuation/server/masterTrackerProvider.test.ts
```

For document-service changes, from `services/concall/`:

```powershell
./.venv/Scripts/python.exe -m unittest test_server -v
```

Use `npm.cmd run check` for TypeScript/Svelte changes. Run a production build when
the change needs it, rather than after each browser interaction. Broaden or repeat
checks when further changes, failures or remaining uncertainty justify it.

## Live integration is a separate test

Normal app: port **5173**. Local document service: **5191**. Local PostgreSQL:
**45432**. Check `/api/health` on the app and `/health` on the document service
before restarting anything. Health checks alone do not verify the user journey.
Read existing `web/.env` privately; do not print credentials or substitute a remote
database URL. Mock flags must be off for real company research.

From `web/`, with those services running:

```powershell
$env:RUN_PICCADILY_LIVE_TEST='true'
try {
    npx.cmd --no-install playwright test --config=playwright.piccadily.config.ts
} finally {
    Remove-Item Env:RUN_PICCADILY_LIVE_TEST -ErrorAction SilentlyContinue
}
```

This makes a billable **gpt-5.6-luna** request and saves Piccadily Agro Q1 FY27
(30 June 2026) guidance to the local database. It uses normal login with its own
temporary account, then removes that account. Accepted guidance remains. Use this
for real research/provider issues or an explicitly requested live test, rather
than routine presentation changes. Mock tests cannot establish that live research
works. Do not reset real users' passwords or reuse stale credentials for testing.

## Reuse what is safe; avoid repeated expensive work

- Keep installed npm packages, Python virtualenv and Chrome. Install only missing dependencies.
- On this Windows sandbox, Vite/Vitest subprocesses can fail with `spawn EPERM`;
  use the approved escalated execution path for these commands rather than retrying
  unchanged commands or leaving a blocked `svelte-kit sync` running.
- Reuse healthy normal-app services. Ports 5180/5190 were restricted test previews;
  do not use them to claim arbitrary-company search works.
- Preserve existing PDF storage under `logs/hfcl-documents/` (the historical folder
  name also contains Piccadily files). Leave **Refresh research** unchecked unless
  refreshing itself is being tested. PDFs and research can be cached; clicking
  **Analyse** still makes a new AI request.
- Investigate failed MCP, document-service, AI or validation stages using existing
  evidence before repeating paid analysis. Cache coverage accepts a transcript or
  presentation, but filing dates alone cannot prove the reporting quarter.
- Store commands and gotchas in memory, never API keys, passwords, session cookies
  or private financial inputs. Do not record private `.env` contents here.

Observed successful runs on 6 October: live browser journey about **40 seconds**;
full mock desktop/mobile suite about **58 seconds**; cached document lookup about
**8 seconds**, explicit refresh about **86 seconds**. These are observations, not
speed guarantees. A focused mock case avoids unrelated tests and live network/AI work.

Live HTML report: `logs/piccadily-playwright-report/index.html`. Mock HTML report:
`web/playwright-report/index.html`. Detailed prior evidence:
[Piccadily test results](../../docs/master-tracker-piccadily-test-results.md).

Valuation-specific live coverage: set `PICCADILY_TEST_VALUATION=true` along with
`RUN_PICCADILY_LIVE_TEST=true`; clear both afterward. This enables Create valuation,
scenario review, atomic tracker/watchlist saving and the rendered watchlist check.
The normal UI now consumes a progress stream. Chrome may discard that body after
consumption: live tests read the rendered draft and their own persisted preview,
rather than depending on Playwright `response.text()` for that stream.

Current user preference: numerical reconciliation issues must retain an editable
valuation with warnings, not discard it. Historical corrections are manual work;
retain original models and protect source references. Focused coverage is the
`historical number corrections` browser case and provider/watchlist unit tests.
See [the current valuation verification notes](../../docs/master-tracker-valuation-test-results.md).
