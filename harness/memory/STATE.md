# STATE
Phase: BUILD_PLAN.md v1 (P0-P6) COMPLETE. Now building user-requested work
explicitly outside the original harness mandate (see below) - this has
grown into an ongoing sequence of features, not a fixed TODO list anymore.

Done:
  - Harness bootstrapped (68ffdec); evolve cycles for P0-P6 (evolutions/
    2026-09-02T-p0..p4.md, 2026-09-03T-p5.md, 2026-09-03T-p6.md)
  - P0-P6 all verified via automated tests AND live against the
    docker-compose container
  - Pushed to GitHub: https://github.com/AkumaZen/ThesisTrack (private)
  - Multi-user login + RBAC (ADR-016)
  - Guidance tracker, generic custom-data tables, LLM-conversion import
    prompt, dashboard-palette theme redesign (ADR-017/018, built by a
    parallel session, merged in cleanly)
  - Vercel deployment support (ADR-019): scheme normalization for
    postgres:// URLs, /tmp-based logging, connection pool sizing. Deployed
    and verified live at a Vercel URL against Aiven Postgres.
  - Company create/amend rebuilt as a full-page editor with a left-nav of
    the 7 pillars, replacing the old small-modal form (ADR-020)
  - Three tiers of deeper customization (ADR-021, 023): Data Table columns
    editable anytime ("Excel-like"), tables attachable to a specific
    pillar OR promoted to their own first-class nav section, small
    free-text pillar_notes per pillar
  - Playwright installed for real browser verification (ADR-022) - caught
    and fixed two real z-index stacking bugs (drawer-over-modal,
    ingest-page-over-modal) that 90+ passing tests never could have found
  - Buy/sell decision tracking (ADR-024) - part 1 of a 3-part "track real
    investing behavior" request, sequenced one part at a time per the
    user's explicit ask (review between each, don't build all three at once)
  - Price tracking + customizable thesis-performance baseline (ADR-025) -
    part 2. Toggle between "since thesis review" and "since first buy",
    manual price entry only (screener auto-pull explicitly deferred, not
    built - price_observations.source reserves the value for later)
  - 114 tests total, all green
  - 25 ADRs + 5 gotchas in harness/memory/, all evidence-cited

In flight: the "track real investing behavior" 3-part sequence
  1. Buy/sell decision tracking - DONE (ADR-024).
  2. Thesis performance vs. real stock price - DONE (ADR-025). Manual
     price entry only; pulling from the `screener` MCP tools (Indian
     equities, screener.in-backed) is explicitly deferred, not scoped yet
     - price_observations.source already reserves 'screener' as a value
     for whenever that gets built.
  3. Per-user parallel thesis "scenarios" - NOT STARTED, and the biggest
     of the three: needs a new layer between company and thesis-version
     history, with kill_triggers/health_checks/status_events re-scoped to
     the scenario rather than the company. Do NOT start this without
     re-confirming scope with the user first - it's a real schema
     redesign, not an additive feature like everything built so far this
     session.

Blocked: nothing

A `.production.env` with a live database credential sits in the repo
(gitignored, untouched). The user said to leave it alone; it was used
once, deliberately, to run the Vercel-deployment migration+seed against
the real Aiven database (see ADR-019) - not touched since.

Standing user preference (see feedback memory in the operator's own
memory system, not this file): don't default to pushing/deploying
immediately after finishing a change on this project - land it locally,
verify it, then let the user actually try it before it goes anywhere.
Every commit this session has stayed local; nothing has been pushed to
GitHub or redeployed since the Vercel setup itself.

Next action: part 3 of the investing-behavior sequence (per-user parallel
thesis "scenarios") - the biggest of the three, needs scope re-confirmed
with the user before starting, per the standing "don't rush" preference.
