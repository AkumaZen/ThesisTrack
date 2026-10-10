# Master Tracker — first-level test results

Date: 5 October 2026. Tests used fictional research and mocked external responses; no API key
was required, and no production database migration or external deployment was performed.

| Check | Result |
| --- | --- |
| npm Playwright, desktop Chrome + mobile viewport | **16 / 16 passed** |
| Focused Vitest regression checks | **102 / 102 passed** |
| Mocked Python document-service tests | **4 / 4 passed** |
| Svelte / TypeScript check | **0 errors, 0 warnings** |
| Production compilation + Vercel package | **Passed**, with the local Windows junction workaround |

The browser tests cover explicit company creation, no automatic valuation, dynamically available
quarters, multiple-quarter selection, primary metric selection, three separate scenario tables,
selective acceptance, draft persistence/regeneration/rejection, manual guidance and assumption
edits, original-history preservation, protected manual work, selected-quarter/filter memory and
reset, stale saves, duplicate companies, invalid periods, draft ownership, read-only permissions,
source-edit rejection and absence of page-level horizontal overflow on mobile. Company selection
and direct creation fill available exchange identifiers without manual code entry. The saved
Supreme Power sample displays six latest trigger states; repeated seeding does not duplicate them.
Its eight-quarter strip scrolls horizontally with the keyboard, keeps the summary on the left
(above on mobile), and does not cause page-level overflow.

The focused unit checks cover source excerpts/URLs/pages, missing valuation inputs, method choice,
quarter/history validation, partial acceptance and predecessor relinking, current thread counts,
owners' EPS, disclosed share changes, new capital in P/B, date-based CAGR, MCP statement types,
explicit BSE identity, overview-only lookup without AI credentials, BSE-only selection, sourced
sample history and preservation of existing user work, provider failure messages, mock isolation
in production, and existing
valuation/navigation/access/data-fallback regressions. The document-service checks exercise
authentication, invalid inputs, selected periods, cache reuse, refresh, path containment and pages.

Artifacts: [Playwright HTML report](../web/playwright-report/index.html),
[desktop screenshot](../web/test-results/master-tracker-explicit-co-57dfa--preview-and-selective-save-desktop/master-tracker.png),
[mobile screenshot](../web/test-results/master-tracker-explicit-co-57dfa--preview-and-selective-save-mobile/master-tracker.png).
The report and screenshots are generated local files and are not committed.

One opt-in HFCL Q1 FY27 live run is now documented in [live test results](master-tracker-live-test-results.md).
Broader live verification remains pending: other Screener MCP schemas and
statement units/basis, real company documents and extraction accuracy, AI factual quality,
provider timeouts, production database persistence/concurrent saves and hosted service operation.
The SQL migration, MCP endpoint, hosted document service and AI credentials must be configured
before this stage. See [setup instructions](master-tracker.md).

Build notes: Node 25 is installed on this Windows computer. The Vercel runtime is explicitly Node
24. Windows denied the adapter's normal directory symlinks, so packaging was verified using an
ignored preload that creates equivalent local directory junctions. No adapter dependency was
modified. Generated build/test folders were excluded from the polling watcher after reproducing
their effect on dev-server startup.
