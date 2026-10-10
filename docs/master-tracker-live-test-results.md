# HFCL Q1 FY27 live test

Date: 5 October 2026. Scope: **HFCL only, quarter ended 30 June 2026 only**.
All OpenAI inference requests used **gpt-5.6-luna**; no alternative model/provider was called.
The private `OPEN_AI_KEY` was loaded from the root `.env` into server memory and was not printed.

The test used the installed Screener MCP over stdio, the actual Concall Downloader service,
and the live OpenAI Responses API. BSE identity resolved automatically to **500183**. The
downloader returned a 29-page Q1 transcript and 22-page presentation. NSE validation failed;
BSE document retrieval succeeded and the warning was preserved in the research cache.

The live workflow fetched available periods, selected only Q1 FY27, generated a review draft,
checked sources and material commitments, saved it and verified restoration after a page refresh.
**13 sourced guidance items were saved**, including revised revenue growth, margin targets,
defence/data-centre revenue, capex, fibre/cable expansion, fivefold data-centre capacity,
the 300 MT preform project and export mix. Current order-book totals and quarterly actuals were
kept as context rather than standalone management promises.

The proposed valuation was **withheld** because the AI used FY24/FY25 instead of FY25/FY26.
Earlier attempts also exposed tax percentages being used as historical tax amounts. Both cases
now have deterministic checks. No invalid valuation was accepted. This run therefore verifies
successful guidance and safe valuation withholding; it does not certify a usable HFCL valuation.

Early live attempts uncovered incompatible URI/schema references and incorrect PDF quotations.
OpenAI output now selects server-owned evidence IDs, which resolve to supplied excerpts, URLs
and PDF pages; invented IDs are rejected and normal source validation still runs. A test matcher
was also corrected to recognise both numeric and written capacity multipliers. The final test
resumed the existing live draft to finish saving without another billable inference request.

Validation: **1 live Playwright test passed**, **16 existing mock browser tests passed**,
**102 focused unit/regression checks passed**, and Svelte/TypeScript diagnostics reported
**0 errors, 0 warnings**. Production packaging was checked with the documented Windows
junction workaround.

Important scope: authentication and storage used isolated development fixtures, not the live
database. Production login, database persistence/concurrent saves, hosted HTTP MCP and deployed
document-service operation remain unverified. The local HFCL result is at
`http://127.0.0.1:5190/valuation/master-tracker` and resets when that server restarts.

Local artifacts, excluded from Git:

- `logs/hfcl-playwright-report/index.html`
- `logs/hfcl-playwright/hfcl-live-Luna-HFCL-Q1-FY27-research-review-save-and-refresh/live-analysis.json`
- `logs/hfcl-openai-audit.jsonl` (model/response/usage, no request credentials)
- `logs/hfcl-documents/500183/` (downloaded public documents and metadata)

The opt-in browser test uses `web/playwright.live.config.ts` against the dedicated server on
port 5190. It requires `RUN_HFCL_LIVE_TEST=true`; `REUSE_HFCL_LIVE_PREVIEW=true` resumes an
already generated draft. The ordinary `npm run test:tracker` never makes live AI calls.
