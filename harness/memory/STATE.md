# STATE
Phase: P5 — Dashboard (not started). P0-P4 complete and verified.
Done:
  - Harness bootstrapped (68ffdec); 5 evolve cycles (evolutions/2026-09-02T-p0..p4.md)
  - P0 (2293665/a462e34) 11, P1 (61b67b3/844a09d) +6, P2 (829d473) +18,
    P3 (6fe172b/7c48065) +11, P4 (6b3594e) +7 -> 53 tests total, all green,
    all also verified against the live docker-compose container
  - Full backend is done: schema, contracts, company CRUD + versioning,
    rule engine, human verdicts + override audit, AI reviewer. Every write
    path a P5 dashboard needs already exists and is tested.
  - harness/skills/add-api-endpoint.md — P3's point 7 fix held clean through
    P4; still the reference for backend work, though P5 is frontend-only
In flight: nothing
Blocked: nothing
Last evolution: harness/journal/evolutions/2026-09-02T-p4.md — clean window,
  no edits
Next action: BUILD_PLAN.md §8 (six screens) + §9 (frontend/index.html
  app.js components/) + §10 P5 acceptance criterion. Build:
  - frontend/index.html + frontend/app.js, Tailwind CDN, vanilla JS ES
    modules, no build step (§8 intro). Serve it from FastAPI itself
    (StaticFiles mounted at "/", registered AFTER all API routers so
    /api/* and /health keep precedence) — same-origin as the API, no CORS
    config needed.
  - Header stats, facet bar (state in the URL query string), cards with
    is_core metrics + sparkline/delta, expandable drawer (7 pillars,
    reasoning chain, redlines with observed-vs-threshold), ingestion modal
    (Form tab renders fields from GET /metrics?operating_model= — THIS is
    what makes the acceptance criterion possible; JSON tab validates
    against contracts/thesis.schema.json client-side), review queue
    (accept/reject/override via existing POST /proposals/{id}/resolve),
    export button (calls stats endpoint first — P6 not built yet, stub or
    sequence P6 first if that's cleaner).
  Concrete test target (§10): adding a row to metric_definitions makes a
  new field appear in the ingestion form with zero frontend edits — prove
  this by actually inserting a test metric row and reloading the form in a
  real browser (chrome-devtools-axi skill), not just by reading the JS.
  No pytest suite covers a static frontend; verification here is
  browser-based per CLAUDE.md's UI-change rule.
