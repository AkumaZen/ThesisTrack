# Master Tracker valuation fix and verification

6 October 2026. Tested against the normal local app on port 5173 and local PostgreSQL.

## Updated behavior: editable models with questionable numbers

At the user's request, numerical reconciliation issues now keep the sourced valuation
as a draft with review warnings, rather than removing it. Generated warnings also
remain in model caveats. Missing essential inputs and unverified sources are not fabricated.

Historical financial numbers, CMP, shares and book value can be corrected in the draft's
editor. Tables recalculate while editing. Corrections are saved as manual work and the
original generated model is retained in valuation history. Users may also save unresolved
numerical mismatches for review; the saved model carries a warning. Historical periods
and source references remain protected.

Watchlist scenarios retain the accepted sales/book-value baseline, so manually corrected
figures drive watchlist targets instead of being replaced by older feed values.

Verification of this update: **87 focused unit checks**, **6 desktop/mobile Playwright
cases**, and `npm run check` with **zero errors and warnings**. Coverage includes retaining
an inconsistent AI model, correction/recalculation, saving unresolved manual mismatches,
watchlist baselines, original-model history and source-reference protection. No live AI
requests were made for this update; the live test described below predates this change.

## Causes and changes

- Piccadily's draft was withheld when historical tax was read as a rupee amount
  instead of a percentage. Tax is now reconciled as reported PBT minus reported
  net profit only when both figures and the year match the supplied annual P&L.
  This computation is disclosed in the model caveats; unrelated mismatches still fail validation.
- Live testing also exposed stale historical years. The structured output now
  restricts historical dates to the latest two supplied annual statement periods,
  with an explicit chronological instruction. Validation remains active.
- Regeneration previously inferred whether valuation was wanted from whether the
  failed draft contained a model. Drafts now retain the requested valuation and method.
- Tracker acceptance previously did not save a watchlist valuation. Acceptance now
  writes tracker state, watchlist assumptions and valuation history in one transaction.
  The accepted method becomes active, other saved methods remain, and version checks
  prevent conflicting saves. The conversion uses the existing JSON-import structure.
- Watchlist calculations support disclosed year-wise shares, minority PAT and equity
  raised, so conversion does not silently drop those scenario inputs.
- Analysis now streams actual financials, documents, analysis, validation and draft
  stages to an accessible progress display. Animation respects reduced-motion settings.
  Provider errors are displayed, and a requested but unavailable valuation explains
  why nothing was saved to the watchlist.

## Verification

- **20 desktop/mobile Playwright cases passed across the main run and a focused rerun.**
  Coverage includes scenario review, watchlist persistence, running progress,
  streamed failure/retry, missing-model messaging, regeneration intent, selective
  saves, manual history protection, access permissions and view memory.
  The empty-draft browser fixture initially changed only the POST response; it was
  corrected to simulate the persisted draft returned by the page's data reload.
- **92 focused unit checks passed across the final relevant runs:** provider boundaries,
  historical year/tax handling, all four valuation methods, dilution/minority calculations,
  JSON import, fair value, history differences and progress stream parsing.
- **Live Piccadily Q1 FY27 valuation test passed** in about one minute. It used normal
  login and real research, created all three scenario tables, accepted the valuation,
  reloaded saved guidance, and opened the actual watchlist. The rendered target matched
  the accepted tracker model. The live requests used **gpt-5.6-luna only**.
  Earlier live attempts exposed Chrome's consumed-stream body limitation and the stale-year
  issue; those runs were not counted as passing. The test now reads its own persisted
  preview after verifying the rendered draft, rather than rereading a consumed stream.
- Persisted FY25 history: PBT 142, tax 40, net profit 102. FY26: PBT 190, tax 52,
  net profit 138. Piccadily's accepted P/E Base model is present in the watchlist.
- Temporary live test accounts were removed; accepted local analysis remains.
- Final `npm run check`: zero errors and warnings. Production build passed.
  The normal app and document service both returned HTTP 200 after verification.

## Reproduce

Use [the saved testing workflow](../harness/skills/master-tracker-testing.md).
Enable `PICCADILY_TEST_VALUATION=true` along with the existing live-test opt-in for
valuation-specific real-provider coverage. This makes a paid Luna request and saves
accepted local results. Mock browser tests do not make AI calls.

Live HTML report: `logs/piccadily-playwright-report/index.html`.
Screenshots and accepted analysis: `logs/piccadily-playwright/`.
Build log: `logs/tracker-valuation-build.log`.
