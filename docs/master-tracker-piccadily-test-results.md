# Piccadily Q1 FY27 normal-app test

Date: 6 October 2026. Company: **Piccadily Agro Industries Ltd (PICCADIL, BSE 530305)**.
Selected reporting period: **30 June 2026 only**. All three live inference requests used
**gpt-5.6-luna**, confirmed by the private model audit. No alternative model/provider was used.

## Failure and fix

The document adapter treated only cached transcripts as coverage, so a cached presentation did
not prevent another full filing scan. The downloader could reuse a quarterly file based on a
filing-date fallback, and a subsequent scan could overwrite that file's verified quarter/source
metadata. This hid Piccadily's already downloaded Q1 transcript and repeatedly incurred slow
network work. The original direct service reproduction took 56 seconds despite existing files.

Cached presentations now provide usable coverage too. A filing date alone cannot identify a
cached reporting-quarter document. Index merging preserves existing verified source/period
metadata and allows a verified reporting period to repair an older filing-date fallback.
Quarter labels such as `Q1, FY27` are recognised. PDF font support is explicitly installed.

The service now returns the **23-page Q1 transcript and 55-page presentation**. The cited URLs
were fetched independently and their bytes matched the cached PDFs exactly. Cached research
took approximately **8 seconds**; explicit metadata refresh took **86 seconds**. The web
document-request timeout is now 120 seconds, with distinct authentication, HTTP failure and
timeout/retry messages.

A repeat browser run also exposed copied guidance IDs during AI regeneration. The server now
assigns fresh record IDs and preserves links to existing history and between new quarter
records. Validation remains active. Prompt instructions distinguish the August call date from
the June reporting period, require revised headlines to show the latest target, and require
existing AI history to be checked against the sources rather than copied as truth.

## What the browser test actually did

`npx playwright test --config=playwright.piccadily.config.ts` ran against the **normal app on
port 5173**, with mock flags off. It created a temporary analyst account in the existing local
database, signed in through the regular login page, searched Piccadily in the actual company
picker and verified automatic BSE detection. It loaded reported quarters, selected June only,
requested real document/financial research and Luna guidance, reviewed the draft, saved it,
reloaded the page and compared the restored commitments and source references.

The final run passed in **40 seconds**. It checked that the August call's relative product-launch
timeline was not incorrectly labelled Q1 FY27 and that the revised barrel target appeared in
the commitment headline. There are **10 latest guidance threads**, with their original records
preserved as history. The temporary accounts and their sessions/drafts were removed; saved
analysis remains visible to the user. Login credentials and sessions were not recorded in traces.

Validation: **1 final normal-app live Playwright test**, **16 desktop/mobile mock Playwright
tests**, **83 focused TypeScript unit/regression checks**, and **9 Python service tests** passed.
Svelte/TypeScript diagnostics reported **0 errors and 0 warnings**.
Production packaging passed with the existing Windows junction workaround. A scan of generated
client files and Piccadily test artifacts found **no OpenAI key exposure**.

This verifies the local normal-authentication, real-database guidance workflow. Valuation was
unchecked, so this run does not certify a Piccadily valuation. Hosted/deployed services and
production database access were not part of this local test. AI drafts still require source review.

## Re-run and evidence

From `web`, with the normal app and document service running:

```powershell
$env:RUN_PICCADILY_LIVE_TEST='true'
npx.cmd playwright test --config=playwright.piccadily.config.ts
```

The explicit opt-in is required because the test makes a live Luna request and accepts reviewed
guidance in the local database. The test refuses a remote database and leaves existing user
accounts unchanged. Its generated account is cleaned up even if the test fails.

Ignored local evidence:

- `logs/piccadily-playwright-report/index.html`
- `logs/piccadily-playwright/` — final analysis JSON and saved-page screenshot
- `logs/piccadily-openai-audit.jsonl` — requested/returned model and usage, no credentials
- `logs/piccadily-document-research.json` — actual selected-quarter PDF evidence
- `logs/piccadily-check.log`, `logs/piccadily-build.log`
