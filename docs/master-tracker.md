# Master Tracker

Route: `/valuation/master-tracker`. Uses the existing application shell and valuation engine.
Only explicitly created companies appear. Tracker membership is independent of the valuation
watchlist. Accepted analysis is shared with the team; review drafts belong to the requesting user.

## Review the mock build

From `web`, run `npm run dev:tracker` and open
`http://127.0.0.1:5180/valuation/master-tracker`. Search for **Supreme Power** or **Quality Power**.
Selecting a company fills its available exchange identifiers automatically. The mock BSE codes
are `999001` and `999002`; the figures are fictional. Add a company, load its
reported quarters, select one or multiple, then analyse guidance or create a valuation. Review
the sources, deselect unwanted items and save. A fresh server starts without saved companies.

The requested Supreme Power demo is saved in the current local preview. To recreate it after a
restart, POST `/api/valuation/master-tracker/sample` in this mock harness. It adds six fictional
growth triggers across eight quarters (Q2 FY25–Q1 FY27), with commitments and latest updates: revenue, EBITDA, capex,
capacity, utilisation and orders. Existing matching guidance and valuations are preserved. This
endpoint is unavailable in production or normal development.

The valuation summary sits to the left of the horizontal quarter strip on desktop, and above it
on mobile. The strip supports touch, trackpad, scrollbar and arrow-key scrolling when focused.

This isolated command uses a dummy database URL and in-memory state; restarting it clears data.
The banner identifies mock mode. The auth fixture and mock provider require a development
build, the explicit flag and a loopback host. The flag cannot enable mocks in production.

`npm run test:tracker` runs the actual SvelteKit routes in this harness with desktop Chrome
and a mobile viewport. HTML results: `web/playwright-report/index.html`; screenshots and failure
traces: `web/test-results`. Installed Chrome is used on Windows; otherwise install Chromium
with `npx playwright install chromium`. Mock tests validate the application journeys, not external
provider availability or factual accuracy of live AI extraction.

## Live setup after mock review

1. Apply `0015_master_tracker.sql` and `0016_master_tracker_documents.sql` in `web/drizzle` to the existing database. Both are idempotent.
2. Set server-side `OPEN_AI_KEY`, `OPENAI_MODEL=gpt-5.6-luna`, and a random `CONCALL_SERVICE_TOKEN` in the existing Vercel project. Keep mock mode off.
3. Run `npm run build` from `web`. The build packages the downloader as a Python function at `/_internal/concall-research` in the **same deployment**. Its bearer token is used only between backend functions. Complete P&L, quarterly results, balance sheets and cash flows are fetched directly in the Node backend; no separate Screener MCP host is required.
4. PDFs and their verified metadata are stored privately in `valuation.master_tracker_documents`. Temporary files are reconstructed per request and removed afterwards. Transaction-scoped company locks prevent concurrent index changes with the Neon pooler. Research bundles retain their existing one-day database cache.
5. Run the opt-in deployed Playwright test: `RUN_TRACKER_PRODUCTION_TEST=true npx playwright test --config=playwright.production.config.ts`. It creates and removes a temporary account, exercises real Luna analysis, manual editing, saving and watchlist display. It leaves accepted company analysis available for review.

Local development uses the same downloader through a Python subprocess, not a separately hosted service. Install `services/concall/requirements.txt` in its virtual environment first. Optional `SCREENER_MCP_*` and `CONCALL_SERVICE_URL` overrides remain supported for older setups; leave them empty for the built-in deployment.

Both the analysis route and internal Python function allow 300 seconds. The Node route emits real NDJSON progress while financials, documents, analysis, validation and draft creation run. Oversized research is reported rather than silently truncated. The downloader retains the existing BSE ? validated NSE ? official IR source flow. Scanned PDFs needing OCR are explicitly flagged.

## Behaviour and limits

- Company selection uses the built-in Screener overview (or optional MCP override) to detect an explicit BSE code;
  it does not need an AI key. The selected NSE symbol is retained when no BSE code is returned,
  with a visible explanation. BSE-only search results use their selected six-digit code directly.
- Research is cached by company/selected periods for a day and can be explicitly refreshed.
  Guidance and valuation reuse the same research bundle. Sources that exceed the analysis
  budget are reported, never silently truncated. Scanned PDFs require OCR and are flagged.
- Analysis creates a persisted review draft, not accepted company history. Each proposal can be
  accepted, excluded or edited; the draft can be discarded or regenerated. Commitments, execution
  status, numeric assumptions and reasoning use labelled edit fields. Accepted valuations can be
  edited without a fresh AI call. Edits retain verified source references.
- Guidance threads append original → revision → execution records. Execution counts use the
  latest quarter state per thread, avoiding duplicate counts. Annual targets remain pending when
  only quarterly progress is available. Manual revisions are labelled and retained, and proposed
  changes require explicit acknowledgement. Saving stale drafts returns a conflict.
- The primary method respects the user's selection, with a separate better-fit recommendation.
  All three scenario tables reuse the existing engine and show two historical years, derived PAT,
  owners' EPS, target prices, returns/CAGR, multiples, sources and caveats. Missing essential inputs
  must return no valuation rather than generic defaults. The tracker model stores projected share
  counts and minority PAT separately; it does not silently overwrite existing watchlist models.
  P/B includes new equity capital, and diluted models display pre/post-dilution comparisons.
- Filters, selected quarters, expanded model and scroll position use the existing per-user view
  memory. Browser storage contains interface state only; research, drafts and models are server-side.
- The current workflow finishes analysis within one server request (300-second route budget).
  Slow downloads or oversized research produce a retryable error; background durable job execution
  is not claimed. The hosted service runs independently of the user's computer.

## Verification commands

From `web`: `npm run check`, `npm run build`, `npm run test:tracker`, and
`npx vitest run src/lib/valuation/masterTracker.test.ts src/lib/valuation/valuationEngine.test.ts src/lib/viewMemory.test.ts`.
From `services/concall`: `.venv/Scripts/python.exe -m unittest test_server -v` on Windows after
installing `requirements.txt`. Document-service tests mock the downloader and cover auth, input
validation, cache reuse, source page numbers, path containment and refresh.

On Windows without Developer Mode, the Vercel adapter's directory symlinks can fail with EPERM.
Local packaging was verified with an ignored `logs/windows-vercel-build-links.mjs` preload using
directory junctions, without modifying the adapter or weakening production configuration. Linux
deployment uses ordinary relative symlinks. Node 24 is the supported deployment runtime.
