# Decisions (append-only ADR log)

## ADR-027: Full-page thesis view in a real new browser tab, plus deeper Balu Forge content
User feedback on the live-tested Balu Forge thesis: "too weak, add more
points/tables/comparisons/detailing" and "open in a complete new window
with proper section-wise data". Two separate pieces of work.

**Content**: amended the thesis twice more (v2->v4) adding peer-valuation
evidence, governance/RPT/shareholding diligence, the SAFA Otomotiv FZ
subsidiary as a second growth leg, and an industry-wide capacity-glut risk
- plus 7 structured custom tables (machining capability vs peers, hammer/
press forging capability, machines procured, capacity ramp, key financials,
peer valuation comps, target-price sensitivity), all sourced directly from
Nuvama's exhibits and created via the real authenticated API (not the DB
directly), then verified rendering correctly in the browser.

**Full-page view, asked for as "a complete new window"**: clarified via
AskUserQuestion into two decisions - (a) a genuine new browser tab with its
own bookmarkable/shareable URL, not a same-tab full-screen takeover, and
(b) richer left-nav section structure only, not independently-editable
sections (amend stays a single full-document operation, unchanged).

Implementation: `#company=<id>` hash on the existing `index.html` (no
backend routing change - StaticFiles already serves it, and a fresh tab
re-runs the same app.js module, so `location.hash` is checked once at boot
in `startApp()`). `renderCompanyPage()` (drawer.js) is a new full-page
layout - left sidebar nav + wide content pane - that deliberately reuses
the *exact same* element ids as `renderDrawer()` (`drawer-amend`,
`drawer-performance`, `drawer-tables`, etc.), so the ~90 lines of existing
action-wiring code (amend/observations/health-check/decisions/AI-review/
tables/performance) was extracted once into `wireDetailView()` and used
unchanged by both `openDrawer()` and the new `openCompanyPage()` - safe
because only one of #drawer/#company-page is ever populated with real
content in a given tab, so there's no id collision risk despite both
existing (empty) in every page's DOM. Primary "view a thesis" entry point
(dashboard card click) now calls `openCompanyTab()` (`window.open`) instead
of `openDrawer()`; the drawer itself is kept for the few remaining quick-
peek call sites (guidance jump, post-create preview).

Two real bugs found and fixed during live verification (both via Playwright
against the actual running stack, not assumed):
1. Container caches a baked-in copy of `frontend/` at image build time (no
   bind mount) - edits to `frontend/*.js`/`index.html` do nothing until
   `docker compose build api && docker compose up -d api`. Cost significant
   debugging time chasing a phantom "window.open does nothing" before
   realizing the running container was serving stale JS.
2. `#company-page` was given z-20, below the dashboard's own sticky header
   (z-30) - the header intercepted every click on the full-page view's own
   top action bar. Fixed by matching the header/`#ingest-page` tier (z-30),
   relying on DOM order (company-page precedes ingest-page in index.html)
   for the two to stack correctly relative to each other.

Write actions (health-check, observations, AI-review, amend) used to
unconditionally `closeDrawer()` on success - fine for the slide-over (falls
back to the dashboard), wrong for a full-page tab with no dashboard to fall
back to visibly. Added `refreshDetailView()`/the `isCompanyPageOpen()`
check so those paths re-render the full-page tab in place instead.

Verified: 123 backend tests still green (no backend touched); live
Playwright coverage of new-tab open, left-nav jump links, a write action
refreshing in place, a bookmarked/shared URL loading the thesis directly
into a fresh tab, and an amend submitted from inside the tab landing back
in that same tab rather than the dashboard.

## ADR-026: Per-user parallel thesis "scenarios" - part 3 of 3, the big one
The largest single change of the session - bigger than the P0-P6 build's
individual phases. Splits `companies` (pure shared identity: name,
industry/niche, operating_model, currency - objective, same for every
viewer) from a new `thesis_scenarios` table (one row per (company, owner):
status, status_source, outcome, conviction, entry/exit dates,
last_reviewed, current_version_id - everything that used to be "the"
company's state, now one user's opinion). `thesis_versions`,
`health_checks`, `status_events`, `status_proposals`, `position_decisions`
all gained a `scenario_id` (kept alongside their existing `company_id` -
same denormalization health_checks already used for company_id+version_id,
avoids forcing a join on every read). `observations`, `price_observations`,
`custom_tables`, `guidance_notes` deliberately untouched - objective
company facts or team coordination, shared across every scenario on a
company, not one user's opinion.

**API design - confirmed with the user before writing code, since it
determines the whole shape of the change**: actions implicitly apply to
the caller's own scenario. No explicit scenario_id in any URL - "amend the
thesis" always means "amend my thesis," resolved via (company_id, actor)
through a new `app/services/scenarios.py`. A scenario is created exactly
once (via POST /companies, whether the company is brand-new or already
exists under someone else's thesis - same endpoint, same payload, company
identity fields ignored when the company already exists). Every other
write (amend, health-check, decision, AI review) requires an existing
scenario and 404s pointing at "start one first" rather than silently
creating one on the wrong verb. This kept nearly every existing endpoint
URL and most frontend call sites shape-compatible - the alternative
(explicit scenario_id everywhere) would have meant rewriting every
company-scoped URL and call site instead of just their internals.

**Real discovery mid-design, surfaced to the user before writing 15+ files
of code**: the rule engine used to run once per company; per-user
kill-triggers mean it now has to run once per *scenario* on a company
(`evaluate_observations` fans out over every scenario, each evaluated
against its own current thesis's triggers against the same shared
observations). Same fan-out logic needed for the review queue
(`GET /proposals` - now joins through `thesis_scenarios` and filters to
the caller's own scenario, otherwise one user would resolve/see another's
pending proposals) - this second one wasn't caught in the initial design
pass, only when writing `tests/test_scenarios.py`'s rule-engine test
actually exercised two scenarios disagreeing on a redline threshold.

**GET /companies/{id} shape**: rather than nesting everything under
`my_scenario`/`other_scenarios` (which would touch every frontend read
site), `CompanyDetail` keeps its existing flat fields (status,
current_thesis, health_checks, etc.) now sourced from the caller's own
scenario, `has_own_scenario: bool` distinguishes "no thesis of mine yet"
from real values being null, and a new `other_scenarios: list[ScenarioSummary]`
carries just enough (owner, label, status, last_reviewed) for the "N
theses on this company" indicator - full side-by-side comparison
(similarities/differences) is an explicit fast-follow, not built this pass,
per the user's own choice when asked.

**Migration** (`e5a91c4d7f22`): every existing company gets exactly one
auto-created scenario, owned by its latest thesis version's author (or
'analyst' if none), so nothing already in the database is orphaned.
Downgrade path written and tested round-trip (upgrade -> downgrade ->
re-upgrade) before any application code touched it, given how destructive
the column drops on `companies` are.

**Frontend**: cards show a "+ Start Your Own Thesis" dashed-border state
(instead of a status pill) when the viewer has no scenario yet, plus an
"N theses" badge when scenario_count > 1; the drawer shows "Also tracked
by: <owner> · <status>" pills for other users' scenarios and, when the
viewer has none, a prompt that opens the create flow with the company's
identity fields prefilled and locked (company_id/classification can't be
redefined by a second scenario). `openDrawer` now branches early on
`has_own_scenario` - none of the write-action buttons (Amend, Post
Observations, etc.) exist in the DOM when it's false, so wiring them
unconditionally would throw.

**Verification**: 123 tests pass (114 prior - all of them exercising the
new scenario-aware code paths unchanged, since a fresh company always
auto-creates exactly one scenario for its creator, so single-scenario
behavior is provably identical to before - plus 9 new in
`tests/test_scenarios.py` specifically exercising TWO different owners on
one company, which nothing before this file ever did). Verified live via
Playwright with two of the platform's real seeded users (rohit.negi@rdc.in,
siddhesh.dige@rdc.in): user 1 created a company with an On Track thesis;
user 2 opened the same company, saw "Start Your Own Thesis" with user 1's
status cross-referenced, started their own Watch Closely thesis with
different content, and both theses' independence was confirmed end to end
- different status, different dashboard counts, different drawer content,
each visible to the other only as a summary pill.

## ADR-025: Price tracking + customizable thesis-performance baseline - part 2 of 3
User asked for both baseline options, explicitly "make it customizable"
rather than picking one - a toggle, not a fixed choice. New `price_observations`
table (migration `d4e7b2c1f309`): company_id, observed_on, price, source
(defaults 'manual', reserves 'screener' for the auto-pull path the user
asked to keep open but explicitly deferred - not built this pass), actor.
Deliberately a separate table from `observations` rather than reusing it -
observations is quarter-cadence financial fundamentals keyed by
(company_id, period, metric_key); a price checkpoint is a plain
(company_id, date) fact at whatever cadence someone checks, and forcing it
through the period/metric-registry machinery would conflate two different
concepts. Not append-only (unlike thesis_versions/position_decisions) -
a price point is a correctable fact, not a decision or an audit record;
UNIQUE(company_id, observed_on) + upsert-on-conflict (same
`on_conflict_do_update` pattern already used by `app/routers/observations.py`)
means logging the same date again corrects that day rather than erroring.

Two baseline modes for "is the thesis performing," both real and
selectable via `GET .../performance?baseline=thesis|decision`:
  - **thesis**: nearest logged price on/after the thesis's `last_reviewed`
    date, falling back to the closest price available at all if nothing
    was logged on/after it - with an honest note disclosing the fallback
    happened, never silently comparing against a stale or misleading point.
  - **decision**: the price from the *first buy decision itself* (not a
    price_observations lookup) - ground truth of what was actually paid,
    simpler and more honest than trying to match a buy date against
    separately-logged price ticks. Deliberately scoped to the first buy
    only, not a weighted-average cost basis across multiple buys/sells -
    real position accounting (FIFO/LIFO/average cost) is a different,
    harder problem than what was asked for here; noted as a real
    simplification rather than silently building partial accounting logic.

Frontend: drawer gained a "Thesis Performance" panel (placed right after
the action buttons, ahead of the jump-nav - a headline metric, not buried
in a section) with a live toggle between the two modes and a "+ Log
Price" action. 11 new tests (both baselines, the fallback path, upsert
correction, 403 enforcement) - 114 total, all pass. Verified live via
Playwright: logged a buy decision then a price, toggled between "Since
Thesis" (correctly showed the fallback disclaimer, since no price existed
on/after the review date) and "Since Purchase" (correctly computed
+25.0% from the actual 220->275 price move).

## ADR-024: Buy/sell decision tracking - part 1 of 3, "track real investing behavior"
User asked for three things at once: (1) per-user parallel theses on the
same company with similarity/difference comparison, (2) buy/sell decision
tracking, (3) thesis-performance-vs-real-stock-price tracking. Explained
via chat why (1) is the big one - almost every existing table
(kill_triggers, health_checks, status_events) is scoped to `company_id` on
the assumption of one shared thesis; making theses genuinely per-user means
inserting a new "scenario" layer and re-pointing those tables at it, not an
incremental add. User agreed to sequence: decisions first (smallest,
self-contained), then price tracking (manual entry now, screener-pull
later - not built yet), then the scenario remodel last, reviewing between
each rather than building all three in one pass.

This ADR covers part 1 only. New `position_decisions` table (migration
`c3d8f1a92e56`): company_id, optional version_id (the thesis version
current at the moment of the decision - mirrors `health_checks.version_id`,
"what did we believe when we bought" should stay answerable), action
(buy/sell), price, optional quantity, decided_on, rationale, actor.
Append-only via the same BEFORE UPDATE OR DELETE trigger pattern as
`thesis_versions` (a real financial action isn't something you quietly
edit after the fact) - a new `forbid_decision_update()` function rather
than reusing `forbid_version_update()`, since its error message is
hardcoded to name "thesis_versions" and reusing it would misname the table
in the error a user actually sees.

Deliberately NOT scoped to a scenario_id (scenarios don't exist yet) - just
company_id + actor, so every decision from every user on a company shows
in one shared timeline for now. When the scenario remodel (part 3) lands,
this table gains a nullable scenario_id FK rather than being redesigned -
today's decisions backfill as "no scenario" or get attributed by actor,
a decision deferred to when scenarios' exact shape is actually settled.

New `app/services/decisions.py` (log_decision/list_decisions) +
`app/routers/decisions.py`, following this codebase's established
router/service split. Frontend: drawer gains a "Log Buy/Sell" action
button and a "Buy / Sell Decisions (all users)" timeline section (its
"(all users)" label is deliberate - flags to the user now that this is
company-wide, not filtered to them, ahead of scenarios eventually making
per-user filtering meaningful). 11 new tests (append-only enforcement,
validation, 403/401, ordering) - 103 total, all pass. Verified live via
Playwright: logged a buy decision through the actual modal, confirmed it
renders in the timeline with the correct actor, price × quantity, and
rationale.

## ADR-023: Unattached custom tables promoted to first-class nav entries, closing the "why can't I add an 8th section" gap
User asked why there's no option for an 8th/9th/10th section. The honest
answer: there already was one (an unattached Data Table via the Section
picker's "(unattached)" option, ADR-021's Tier 2), it just wasn't
*presented* as a section - it rendered as a compact list row bucketed
under one generic "Custom Sections" heading rather than its own entry in
the nav, so it didn't read as equivalent to "1. The Business" etc. even
though it functionally already was one.

Fixed by promoting each unattached table to its own `.ingest-section-btn`-
styled nav button, named after the table, sitting under a small "CUSTOM
SECTIONS" group heading right after the 7 pillars and References -
`renderTableNavButton()` in customTables.js, wired in
`loadCustomTablesIntoIngestPage()` (app.js). Clicking one opens the
existing table-grid modal (same code path "Open" already used) rather than
a new inline panel, since that's already fully-featured (rows, Edit
Columns, and now also Delete Table - added to the grid header since the
promoted nav button no longer carries an inline delete affordance the way
the old list row did). The Section picker at table-creation time is
unchanged: pick a pillar to nest inside it (Tier 2 as originally built),
leave it "(unattached)" to make it a first-class section of its own - the
same underlying mechanism, the user's choice of presentation.

Caught two more z-index regressions from this same visual-QA pass, both
self-inflicted by ADR-022's fix:
1. `#ingest-page` was bumped to `z-[55]` in ADR-022 specifically to beat
   the drawer - but modals (table builder, table grid) are opened *from
   within* the ingest page and are `z-50`, so beating the drawer that way
   also meant beating those modals, breaking every "+Add Section"/"+Add
   Table Here"/"Edit Columns" click with the exact same click-interception
   symptom ADR-022 had just fixed elsewhere - caught by a real Playwright
   click timing out again, this time naming `#ingest-content` (part of the
   ingest page itself) as the interceptor.
2. Root-caused: the `closeDrawer()` call ADR-022 added to `openIngestPage()`
   already makes the z-index bump unnecessary for the drawer case (the two
   are never simultaneously open), so the fix was to revert `#ingest-page`
   to a low z-index (`z-30`, below every modal) rather than push it higher.
   Documented directly in the HTML comment this time, so the reasoning
   survives the next edit: never bump #ingest-page above #modal-overlay.

Take-away for anywhere else z-index gets touched in this app: a bump meant
to beat one specific overlapping element can easily break stacking against
a different element that opens from inside the one just bumped. Re-verify
every UI path that opens a modal from wherever the z-index change landed,
not just the one path the bump was meant to fix - this is now two-for-two
on real bugs pytest could never catch, both found only by actually clicking
through the rendered page with Playwright.

## ADR-022: Playwright installed for real browser verification; caught a drawer/modal z-index stacking bug invisible to pytest
No browser-automation tool was available this session (the chrome-devtools
MCP used in earlier sessions per STATE.md wasn't present). User asked for
one to be installed. Chose Playwright (Python), `pip install playwright`
into the existing project `.venv` plus `playwright install chromium` -
fits the project's existing Python tooling rather than adding a Node
dependency, and a Chromium-only install keeps it fast.

Immediately caught a real bug that 92 passing pytest tests and the earlier
static/API-only verification both missed entirely, because it only exists
in rendered layout: `#drawer` (`z-50`) visually overlaps `#modal-overlay`
(previously `z-40`) and `#ingest-page` (previously `z-[35]`) wherever their
on-screen regions intersect, and CSS gives the higher z-index element
priority regardless of DOM order - so the drawer intercepted clicks on any
modal (table builder, row form, observations, health check, AI review) or
the full-page editor opened while the drawer was still showing behind it.
Confirmed via an actual failed Playwright click (`TimeoutError` naming the
drawer's own paragraph text as the element "intercepting pointer events"),
not by reading the CSS and guessing. This was latent since custom_tables
was first built (`drawer-new-table` already opened the same modal while the
drawer was open) - normal screen widths just made it easy to click outside
the ~100px overlap zone by luck.

Fixed two ways: (1) `#modal-overlay` bumped to `z-50`, same as `#drawer` -
since it's declared later in the DOM, equal z-index ties resolve in its
favor, so any modal now correctly renders above an open drawer; (2)
`#ingest-page` bumped to `z-[55]` (a full-page takeover has no reason to
ever sit under the drawer) and `openIngestPage()` now calls `closeDrawer()`
unconditionally at the top - the semantically correct fix, with the
z-index bump as defense in depth rather than the only fix.

Verified visually end-to-end with Playwright screenshots (not just pytest)
after the fix: created a company via the full-page editor's JSON tab,
confirmed pillar_notes render under the correct pillars in the drawer,
attached a Data Table to Proof Points via "+ Add Table Here" from inside
the (now-unblocked) modal, added a second column via "Edit Columns" and
confirmed both columns appear, and opened "Amend Thesis" from the drawer to
confirm the full-page editor now fully covers it with fields correctly
pre-populated (including the pillar note). All 92 automated tests still
pass; this was a pure rendering/layout bug, not a logic bug pytest could
ever have caught.

## ADR-021: Three tiers of "more customization" - Excel-like table columns, pillar-attached tables, and per-pillar free-text notes
User asked for deeper customization: dynamically add/remove columns and
rows in Data Tables "like Excel", the ability to add new sections, and more
detailed customization within each of the 7 pillars. Explained three tiers
of increasing schema risk via AskUserQuestion-style discussion in chat
(not persisted elsewhere, so recorded here); user chose all three.

**Tier 1 - Excel-like columns.** `PATCH /tables/{id}` already accepted a
new `columns` array (`app/routers/custom_tables.py`) - the gap was purely
frontend: no screen existed to edit an existing table's columns, only to
set them once at creation. Added `renderTableBuilderForm(table, defaultSection)`
supporting an edit mode (customTables.js) and an "Edit Columns" button in
`renderTableGrid`, wired through a generalized `openTableBuilder(companyId,
onSaved, existingTable, defaultSection)` in app.js that calls
`api.updateTable` instead of `api.createTable` when editing. Deleting a
column only stops displaying that key in the grid - existing row_data for
it is left alone rather than destroyed (standard spreadsheet behavior, no
explicit "restore" UI planned since JSONB still has it).

**Tier 2 - tables attached to a pillar.** New nullable `custom_tables.section`
column (migration `9f2a6c1e4d80`), validated against `app/pillars.py`'s
`PILLAR_KEYS` (a new shared constant - the 7 pillar field names + references,
factored out so `app/schemas/thesis.py`'s pillar_notes validator and
`app/schemas/custom_tables.py`'s section validator can't drift apart;
deliberately left `app/schemas/guidance.py`'s independent `BlockKey` Literal
untouched rather than risk refactoring a working, tested file for a `general`
member overlap of a normal size). NULL means unattached (pre-existing
behavior, still the default). Frontend: `drawer.js`'s `pillarExtra()` and
`ingest.js`'s `pillarExtraBlock()` each leave a placeholder
(`#drawer-tables-<key>` / `#ingest-panel-tables-<key>`) inside every pillar
section plus a "+ Add Table Here" button; `app.js` groups a company's tables
by `section` and distributes them, falling back to the pre-existing flat
list for unattached ones.

**Tier 3 - pillar_notes.** New `ThesisData.pillar_notes: dict[str,
list[str]]` field (default `{}`), keys validated against the same
`PILLAR_KEYS`. Chosen as a dict-of-field-name rather than nesting a notes
field inside each pillar's own sub-model, since 3 of the 8 "pillars"
(`the_growth_engine`, `why_we_believe_it`, and `references` are bare lists,
not objects - a single flat extension point avoids an inconsistent shape
across pillars. Additive and default-empty, so every existing stored thesis
and all 79 pre-existing tests needed zero changes. `contracts/thesis.schema.json`
regenerated via the existing `app/schemas/export_contract.py` script (not
hand-edited) to keep `test_exported_json_schema_is_current` honest.

**Bugs caught before commit, same root cause each time:** `#drawer` and
`#ingest-page` are persistent DOM nodes (only their innerHTML is swapped on
each open/refresh) - the first pass wired the new "+Add Table Here" buttons
by re-querying and re-attaching a listener inside `loadTablesIntoDrawer`/
`loadCustomTablesIntoIngestPage`, both of which can run multiple times
within one open (after every table create/edit/delete) without those
buttons themselves being replaced, so listeners would have stacked with
every refresh. Same root cause as the ingestPageClickHandler leak from the
full-page-editor ADR, and it also surfaced in `openTableBuilder`'s existing
(pre-existing, not introduced this session) delegated listener on
`#modal-panel` - Tier 1 makes edit/save/reopen of that same modal a normal
repeated action, where before it was normally opened once per drawer visit.
Fixed all three the same way: track the current handler in a variable,
remove it before attaching a new one (`ingestPageClickHandler`,
`modalPanelClickHandler`), and move any listener attached to elements that
truly are static across refreshes (the "+Add Table Here" buttons) into the
one-time open-time setup (`openDrawer`/`openIngestPage`'s isAmend branch)
via a new `wireAddTableSectionButtons()` helper, rather than the
per-refresh loader functions.

Verified end-to-end against the live docker-compose API (not just
pytest): created a company with `pillar_notes` set, confirmed it round-trips
through GET after create; created a Data Table with `section="proof_points"`,
confirmed it round-trips; PATCHed a second column onto that table after
creation and confirmed the grid reflects both columns. 92 automated tests
pass (79 prior + 13 new: `tests/test_custom_tables.py` - new file, this
feature had no tests at all before this session - plus 3 pillar_notes cases
in `tests/test_contract.py`).

## ADR-020: Company create/amend moved from a small centered modal to a full-page editor with a left-nav of the 7 pillars
User feedback: "just a form" - wanted the ingest UI restructured around the
7 standard thesis pillars (Business, Growth Engine, Big Change, Proof
Points, What Can Kill It, Why We Believe It, Health Check) plus Basics and
References, each browsable from a persistent left sidebar, every list-type
field (growth drivers, hard evidence, why-believe reasoning steps) upgraded
from bare "one per line" textareas to proper +Add/x-remove rows matching how
Revenue Split/Kill Triggers/References already worked, and finally moved out
of a small popup into a full-viewport page (confirmed via AskUserQuestion:
full-window view reusing the existing single-page-app, not a new URL router
- this app has no router today and didn't need one for this).

For "add new sections": the backend's `ThesisData` Pydantic model validates
`thesis_data` against exactly these 7 pillars - it has no slot for an
arbitrary new top-level field, and loosening that would undermine the export
pipeline and rule engine that depend on the pillar shape (both index into
`thesis_data` by these exact keys). The existing "Data Tables" feature
(`custom_tables`/`custom_table_rows`, ADR-018) already is the mechanism for
open-ended per-company data, so "+ Add Section" in the new editor's sidebar
creates one of these instead of bending the thesis contract. Since a table
is keyed by `company_id`, this is only available once a company exists -
for a brand-new company, submitting the 7 pillars now immediately opens
that company's drawer (which already surfaces Data Tables) rather than
just closing back to the dashboard, so the very next click is available.

Amend mode also newly populates the Form tab from `existing.current_thesis`
(previously it force-jumped straight to the raw JSON tab, prefilled but
unedited via form fields) via a new `populateFormFromThesis()` - the JSON
tab remains available as an escape hatch for bulk edits. `why_we_believe_it`
entries are edited as (kind dropdown: Premise/Inference/Conclusion, free
text) row pairs and reassembled as `"Kind: text"` strings on submit,
matching the existing case-insensitive-prefix validator in
`app/schemas/thesis.py`; a `splitBelieveEntry()` helper parses stored
strings back into that shape for editing, falling back to Premise/whole-
string for older freeform entries without a recognized prefix.

Bug caught and fixed before commit: `#ingest-page` is a persistent DOM node
(only its innerHTML is swapped between opens, mirroring the pre-existing
`#modal-panel` pattern this codebase already used elsewhere), so attaching
a fresh delegated click listener on every `openIngestPage()` call without
removing the previous one would stack listeners across repeated
open/cancel/open cycles - each "+Add" click would then insert one row per
stacked listener. Fixed by tracking the current handler in a module-level
variable and removing it before attaching a new one, in both
`showIngestPage()` and `closeIngestPage()`.

## ADR-019: Vercel deployment target - serverless ASGI entrypoint, DATABASE_URL scheme normalization, pool sizing
User asked to host on Vercel against the Aiven-hosted Postgres already sitting
in `.production.env`. Three real bugs would have surfaced only in production,
none caught by the existing test suite since it never runs against a
serverless filesystem or a `postgres://`-scheme URL:
  1. Aiven hands out `postgres://...` - SQLAlchemy + psycopg3 requires an
     explicit `postgresql+psycopg://` dialect+driver prefix, or `create_engine`
     fails outright. Fixed in `app/db.py` with a scheme rewrite.
  2. `app/llm/client.py` unconditionally wrote review logs to a repo-relative
     `logs/llm_calls/` path. Vercel's deployed function filesystem is
     read-only outside `/tmp`, so every `/ai-review` call would have thrown
     on the first `mkdir`. Fixed: log dir switches to `/tmp/logs/llm_calls`
     when `VERCEL` is set, and the write is now best-effort (wrapped in
     try/except) since instrumentation must never break a real review -
     consistent with constitution rule 7 being about not fabricating
     content, not about logging succeeding.
  3. Default SQLAlchemy pool (5 + 10 overflow) is sized for one long-lived
     process. Serverless fans out to many short-lived instances, each with
     its own pool, against Aiven's low connection cap on smaller tiers.
     Reduced to `pool_size=3, max_overflow=2`.
Added `api/index.py` (ASGI entrypoint Vercel's Python runtime auto-detects),
`vercel.json` (routes everything to it, `includeFiles` so `frontend/` and
`contracts/` - read via relative path in `app/main.py`'s StaticFiles mounts -
ship inside the function bundle), and `.vercelignore` (excludes `.venv`,
`tests`, `harness`, `migrations`, `logs`, and both `.env`/`creds.md` files
from the deployed bundle; migrations still run locally against the Aiven URL,
never inside the function). All 79 existing tests still pass unchanged -
these were latent bugs, not behavior changes for the docker-compose path.

## ADR-018: Guidance tracker, generic custom-data tables, and an LLM-conversion import prompt - built beyond BUILD_PLAN.md's frozen v1 scope
Three features requested directly by the user, none of which BUILD_PLAN.md
anticipates (confirmed by a full read of it - see the exploration notes this
session; nothing in §0-§11 mentions guidance/notes, user-defined tables, or
an external-conversion import flow). Same posture as ADR-016 (multi-user
RBAC): built at explicit request, documented here rather than silently
rewriting the frozen spec. Migration `7b1e4c47bb23_guidance_and_custom_tables`
follows the established raw-SQL `op.execute()` convention (ADR-004).

**1. Guidance tracker** (`guidance_notes` table, `app/routers/guidance.py`,
`app/schemas/guidance.py`, `frontend/components/guidance.js`). A simple
mutable (not append-only - unlike `thesis_versions`, this is closer to
`status_proposals` in lifecycle) per-company note attached to one of the
thesis's 8 fixed pillar keys or "general". Deliberately NOT a DB-owned
registry/enum (block_key is a Pydantic `Literal`, validated at the schema
layer) since the block set is defined by the thesis JSON contract, not
something users add to. Simple open/resolved lifecycle only (no priority/
due-date/assignee) per explicit user preference when asked. Surfaced as a
genuine new top-level nav view/page (`#guidance-view`, `setView("guidance")`)
rather than a modal, since it's a cross-company tracker (filterable by
company/block/status) - not just a per-company action. A `Guidance` button
on the drawer (`frontend/components/drawer.js`) deep-links into it
pre-filtered to that company. Resolve endpoint mirrors
`POST /proposals/{id}/resolve`'s shape exactly (`app/routers/health.py`).

**2. Custom data tables** (`custom_tables` + `custom_table_rows` tables,
`app/routers/custom_tables.py`, `app/schemas/custom_tables.py`,
`frontend/components/customTables.js`). Offered the user a choice between
2-3 concrete domain tables (e.g. shareholding pattern, peer comps - the
operating-model enum and INR default strongly suggest Indian equity
research) versus a fully generic user-defined table builder; the user chose
generic. `custom_tables.columns` is a JSONB array of user-authored
`{key, label, type: text|number|date|enum, options?}` column defs;
`custom_table_rows.row_data` is a JSONB object keyed by those column keys,
type-checked server-side against the column defs on write
(`_validate_row_data` in the router - unknown keys rejected, blank cells
skipped, mirrors the unknown-`metric_key` rejection already established in
`app/routers/observations.py`). Rendered per-company in a new "Data Tables"
drawer section; row add/edit is a small dynamically-generated form modal
(same pattern as `renderMetricsFields` in `ingest.js`) rather than live
inline cell-editing - deliberate scope cut, since this app has no existing
inline-editing precedent anywhere and modal-based row edit reuses the
established `showModal`/`closeModal` machinery directly.

**3. Thesis-conversion import prompt** (`frontend/app.js::buildConversionPrompt`,
wired into the existing JSON tab of `renderIngestModalShell` in
`frontend/components/ingest.js` behind a `<details>` disclosure, not a new
tab/flow). No backend surface at all - reuses `POST /companies` /
`PUT /companies/{id}/thesis` and the existing client-side contract validator
(`loadContractSchema`/`validateAgainstContract`, ADR-014) unchanged. The
prompt is built LIVE at modal-open time from `contracts/thesis.schema.json`,
`state.taxonomy`, and an unfiltered `GET /api/metrics` call (confirmed the
`operating_model` query param is optional server-side, `app/routers/
taxonomy.py`) - deliberately not a hardcoded static string, so it can never
drift out of sync with the real schema/taxonomy/metric registry as they
evolve. Instructs the external LLM to ask the user clarifying questions
rather than guess, since the prompt runs in an interactive chat, not a
one-shot API call.

Evidence: full manual verification this session - all new backend endpoints
exercised via curl (including 422 error paths: bad enum value, unknown
column key, unknown taxonomy value) against a locally migrated+seeded DB;
frontend exercised end-to-end in a live browser (chrome-devtools MCP) -
guidance add/list/filter/resolve, custom table creation and grid rendering
with real row data, and the conversion-prompt generation (10.6KB output
embedding the live schema) all confirmed working in both the dark and
light theme variants from ADR-017. One real bug found and fixed during
testing: `POST /guidance/{id}/resolve` set `resolved_by` but not
`resolved_at` (the column's `DEFAULT NOW()` only fires on INSERT, not
UPDATE) - fixed in `app/routers/guidance.py`.

## ADR-017: Frontend re-themed to the dashboard-palette dark design system
The user supplied `docs/dashboard-palette.html`, a reference doc extracted from
an existing "sales dashboard" (`index.css`), and asked to apply it "exactly"
across the whole system: a near-black dark theme (`--bg:#050505`,
`--surface:#121212/#0a0a0a/#1a1a1a`, `--border:#333333`, `--fg:#f0f0f0`,
`--muted-fg:#888888`) with four brand accents (`--accent:#ccff00` lime,
`--accent-2:#00f0ff` cyan, `--accent-3:#ff003c` red, `--accent-4:#ffaa00`
amber) that stay identical between the dark theme and the doc's proposed
white-ground light theme - only ground/text tokens swap. Typography:
Space Grotesk (display/headings) + JetBrains Mono (labels/data/code), both
via Google Fonts.
Implementation: `frontend/index.html` now defines all tokens as CSS custom
properties in `:root` (dark, the default) with an `@media
(prefers-color-scheme: light)` override block carrying the doc's light-theme
values (`:root:not([data-theme="dark"])` guard, so an explicit
`data-theme="dark"` attribute - not currently set anywhere - would opt back
into dark even under a light OS preference). `tailwind.config` (Play CDN,
inline `<script>`) extends `theme.colors` with named tokens pointing at
`var(--x)` so the whole app can use ordinary Tailwind utility classes
(`bg-bg`, `bg-surface`, `bg-surface-3`, `border-border`, `text-fg`,
`text-muted-fg`, `bg-accent`, `text-accent-ink`, `bg-good/ok/warn/danger`,
`text-good/ok/warn/danger`) instead of hardcoded hex. `color-scheme: dark`
(and `light` in the media override) is set on `:root` so native form
controls, scrollbars, and date pickers follow the theme without per-element
overrides; a global `input, select, textarea` rule sets their background/text
to `--surface-2`/`--fg` since Tailwind utility classes alone don't reach
native control chrome.
Semantic reuse: the app's existing three-state thesis status
(`on_track`/`watch_closely`/`broken`) mapped 1:1 onto the palette's
`good`/`warn`/`danger` semantic tokens (`frontend/components/format.js`
`STATUS_STYLES`, used by cards/drawer/health-check-timeline). The three
review-queue source badges (`rule_engine`/`ai_proposed`/`manual`,
`frontend/components/reviewQueue.js`) needed a judgment call since the doc
has no direct equivalent: `rule_engine` -> neutral (`bg-surface-3`),
`ai_proposed` -> `accent` (lime), `manual` -> `ok` (cyan) - reserves `good`
for actual status semantics.
Contrast rule applied throughout: buttons/badges on a bright accent fill
(`accent`, `good`, `warn`) pair with `text-accent-ink` (`#050505`, dark ink)
per the doc's own note about this; only `danger` (a saturated but darker
red) pairs with `text-white`. This mattered for the toast helper
(`frontend/app.js::toast`), which previously hardcoded `text-white` for both
its ok/error branches - now the two branches set their own text color
along with their background.
Evidence: mechanical Tailwind-class migration applied via a one-off script
(`scripts/repalette.py` equivalent, run from scratch and not committed) across
`frontend/index.html`, `frontend/app.js`, and all of `frontend/components/*.js`;
verified zero remaining `slate-`/`rose-`/`amber-`/`emerald-`/`blue-`/`violet-`
Tailwind classes via grep afterward.

Follow-up: the user asked for a real toggle (initially only OS-preference-driven
auto switching existed). Added `#theme-toggle` button in the header
(`frontend/index.html`), a blocking inline `<script>` in `<head>` that applies
a saved `localStorage["theme"]` value to `<html data-theme>` before first
paint (avoids a flash of the wrong theme), and `:root[data-theme="light"]`
/`:root[data-theme="dark"]` CSS blocks (outside the media query, so they win
regardless of OS preference) alongside the existing
`@media (prefers-color-scheme: light)` auto-detect. `frontend/app.js`'s new
`wireThemeToggle()` (called from `startApp()`) reads/writes that attribute
and localStorage on click. No default is forced - first visit follows the OS
preference via the media query; only clicking the toggle pins an explicit
choice.

Follow-up 2: the user asked for a token-usage audit against the doc's own
group labels ("Ground: Page background / Modal-header-panel fill / Card fill
/ Nested panel fill / Table row hover / Hairline dividers"). Two tokens were
defined but not actually applied where the doc assigns them: `--bg-ink`
("Modal / header-panel fill") was dead - header, login card, drawer, and
`#modal-panel` were all using `--surface` ("Card fill") instead. Fixed:
those four now use `bg-bg-ink`; actual card/panel surfaces (company cards,
stat tiles, facet bar, review-queue rows) correctly stay on `bg-surface`.
`--surface-2` ("Nested panel fill") was only reached via the global
input/select/textarea rule (not in the doc's assignment for that token,
added separately for native-control theming); the one real nested panel,
`#export-stats` inside the export modal (`frontend/components/exportPanel.js`),
was using `bg-bg` (page background) instead - fixed to `bg-surface-2`.
`--accent-2` (cyan) and `--white` are only reached through their aliases
(`ok`=accent-2, and Tailwind's default `white` key overridden to
`var(--white)`) rather than being referenced by their own class names
anywhere - not a bug, since the doc defines them as identical values, but
worth knowing if a future change wants a visually distinct "secondary
accent" callout that isn't reusing the `ok` semantic.

## ADR-001: Balu Forge golden fixture is an adapted payload, not the raw original-spec sample
BUILD_PLAN.md's P0 acceptance criterion requires "the Balu Forge sample payload
from the spec" to validate clean, but the platform's own deviations (§1) change
the shape that payload must have. The user supplied the original spec's raw
sample directly in chat (human-readable `operating_model: "Factory"`,
`status: "On Track"`, `model_specific_metrics` as display strings like
`"68%"`, `what_can_kill_it` as `{trigger, prescribed_action}` sentences, no
`classification.currency`).
`tests/fixtures/balu_forge.json` is that payload adapted per BUILD_PLAN.md §1
and §4: `classification.currency: "INR"` added; `model_specific_metrics`
re-keyed to the `metric_definitions` registry's canonical keys
(`capacity_utilization_pct`, `operating_margin_pct`, `working_capital_days`)
with numeric values; `what_can_kill_it` restructured into §1.1's normalized
shape - the margin trigger got full structured fields (this is almost
verbatim BUILD_PLAN.md §1.1's own worked example), the facility-delay trigger
became `manual_check: true` since "delayed > 6 months" isn't a registry
metric; `operating_model`/`status` lowercased to the DB enum values.
Everything else (the_business narrative, the_growth_engine, the_big_change,
proof_points.hard_evidence, why_we_believe_it, health_check, references) is
unchanged from what the user supplied.
Evidence: `tests/fixtures/balu_forge.json`; `app/schemas/thesis.py` (the
Classification/status normalizers implementing the enum-casing rule);
`tests/test_contract.py::test_golden_fixture_validates_clean` passing against
this adapted fixture.

## ADR-002: `why_we_believe_it` stays a plain string array; Premise/Conclusion is a prefix check
BUILD_PLAN.md §1 lists five specific structural deviations from the original
spec (kill triggers, metrics-as-time-series, versioning, metric registry,
taxonomy/units) - `why_we_believe_it` isn't among them, and the original
sample already ships it as prose strings prefixed "Premise 1:", "Inference:",
"Conclusion:". §4's validation rule ("contains at least one Premise and
exactly one Conclusion") is implemented as a case-insensitive prefix check on
those strings, not a structured `type` field.
Evidence: `app/schemas/thesis.py::ThesisData._why_we_believe_it_shape`.

## ADR-003: `health_check` pillar in thesis_data is narrative only; the health_checks table is the operational ledger
The original sample's `health_check` pillar (`latest_quarter_review` +
`historical_checks`) is analyst-authored narrative carried in the versioned
`thesis_data` JSONB, same as every other pillar. It is not the same thing as
the `health_checks` DB table from BUILD_PLAN.md §2/§5, which is the
rule-engine/AI/human verdict ledger populated over time via
`POST /companies/{id}/health-check` (P3). The two aren't reconciled or
deduplicated - this matches §1.2's general pattern of JSONB holding an
authored/denormalized view while a normalized table is the operational
source of truth.
Evidence: `app/schemas/thesis.py::HealthCheckPillar`; BUILD_PLAN.md §2
`health_checks` table, §5 status engine, §6 `POST /companies/{id}/health-check`.

## ADR-004: P0 migration is raw SQL via op.execute(), not SQLAlchemy ORM models
`app/models.py` (SQLAlchemy ORM) is deferred to P1. BUILD_PLAN.md §10 lists P0
as "migrations, seeds, Pydantic models, exported JSON Schema" - it does not
require an ORM layer, and the generated `search_tsv` column plus the
append-only trigger/function aren't well-served by Alembic's `op.*` DSL
anyway. The migration pastes BUILD_PLAN.md §2's DDL near-verbatim via
`op.execute()`, verified to actually apply (including the generated column)
against real Postgres 16 - no tsvector fallback was needed.
Evidence: `migrations/versions/6964238e12f2_p0_schema.py`;
`tests/test_schema_migration.py` passing against a real database.

## ADR-005: taxonomy resolution on company creation is lookup-only, never auto-create
BUILD_PLAN.md §1.5 controls taxonomy specifically to stop free text; silently
creating a `broad_industries`/`specific_niches` row on an unrecognized name at
company-creation time would defeat that. `POST /companies` looks up both by
name and returns 422 naming the missing one if either isn't found.
`broad_industries` is seed-managed (`seeds/taxonomy.sql` - no create endpoint
exists in §6); `specific_niches` has the explicit propose path,
`POST /taxonomy/niches`.
Evidence: `app/services/versioning.py::_resolve_taxonomy`;
`tests/test_api_companies.py::test_create_company_rejects_unknown_taxonomy`.

## ADR-006: rule-engine hook on POST /observations deferred to P2
BUILD_PLAN.md §6's endpoint table says this route "triggers rule engine
synchronously; returns any new proposals" - but §10 explicitly scopes the
rule engine itself to P2, and P1's acceptance criterion only requires posting
observations via HTTP, not proposal generation. P1's implementation persists
observations (upsert per `(company_id, period, metric_key)`) and validates
`metric_key` against the registry; P2 adds the synchronous rule-engine call
into this same endpoint without changing its request/response shape for the
fields already used by P1's tests.
Evidence: `app/routers/observations.py` (comment at the return statement).

## ADR-007: thesis amendment payload is {thesis_data, change_note} only - classification isn't re-submitted per version
`classification` (broad_industry, specific_niche, operating_model, currency)
lives on the `companies` row, set once at creation; only `thesis_data` (the
pillars) is versioned in `thesis_versions`. `PUT /companies/{id}/thesis`
therefore takes `ThesisAmend {thesis_data, change_note}`, not a full
`ThesisCreate` - there's no schema table column for classification-per-version,
and BUILD_PLAN.md never describes reclassifying a company mid-thesis.
Evidence: `app/schemas/company.py::ThesisAmend`;
`app/routers/companies.py::put_thesis`.

## ADR-008: grace-period continuity is scoped to kill_triggers.id, not the redline's meaning across amendments
BUILD_PLAN.md §5 rule 4 says to track consecutive breaches "by reading back
trigger_evaluations ordered by period_end" but doesn't say what happens when
a thesis amendment changes a trigger's threshold or removes/re-adds it.
Since `kill_triggers` rows belong to a specific `version_id` (a new row with
a new `id` is written on every amendment per §1.3's append-only versioning),
a breach streak naturally resets to zero when the thesis is amended - there
is no prior `trigger_evaluations` row for the new trigger `id` to read back.
This is the conservative reading: an amended redline (possibly a different
threshold) shouldn't inherit breach history accumulated under the old one.
Evidence: `app/services/rule_engine.py::_consecutive_breach_streak` (keyed
on `trigger.id`, which changes every amendment).

## ADR-009: status_proposals has no trigger_id column - dedup by evidence.trigger_id instead
BUILD_PLAN.md §2's `status_proposals` table has no FK back to
`kill_triggers`. To stop the rule engine from spamming a new pending
proposal every time the same already-fired trigger re-evaluates for the same
period (e.g., re-posting corrected data for a period that already breached),
`evaluate_observations` checks existing pending `rule_engine` proposals for
this company+period and reads `evidence->trigger_id` (a field the rule
engine itself writes into the JSONB) rather than adding a schema column not
in BUILD_PLAN.md §2.
Evidence: `app/services/rule_engine.py::_existing_pending_trigger_ids`;
`tests/test_rule_engine.py::test_repeated_post_same_period_does_not_duplicate_pending_proposal`.

## ADR-010: outcome-close retrospective note has no dedicated column - stored as a status_events row
`POST /companies/{id}/outcome` (§6) takes an outcome + "retrospective note,"
but `companies` (§2) has no free-text column for it and `outcome` isn't
itself a status transition. Recorded as a `status_events` row with
`from_status == to_status` (status is genuinely unchanged by closing the
outcome) and the note as `rationale` - keeps the note durable and queryable
without adding a column BUILD_PLAN.md's schema doesn't have.
Evidence: `app/services/audit.py::close_outcome`.

## ADR-011: "override" is defined as (fired-kill proposal) AND (final status != 'broken')
BUILD_PLAN.md §5 rule 2 says overriding a fired kill needs a note and an
`override=TRUE` status_events row, but doesn't give the exact predicate for
"this resolution is an override." Implemented as: the proposal being
resolved came from the rule engine with `proposed_status='broken'` (i.e., a
kill, not a warn - P2 never proposes 'broken' any other way), AND the
resolution's resulting status is anything other than 'broken' (a reject, or
an accept with a human-supplied `verdict` that isn't 'broken'). Accepting a
fired kill's own recommendation (verdict left unset, defaults to 'broken')
is compliance, not an override. The same predicate is reused for direct
`POST /health-check` entries by checking for any pending fired-kill
proposal on the company.
Evidence: `app/services/audit.py::resolve_proposal`, `_find_active_fired_kill`;
`tests/test_audit.py` (override vs. non-override cases).

## ADR-012: get_llm_client() raises when unconfigured, never silently degrades
BUILD_PLAN.md §5 doesn't say what to do when no LLM provider is configured.
The tempting default - fall back to a canned/neutral response - would mean
`/ai-review` could return what looks like a real AI opinion when none was
actually formed, which is precisely the "unreviewed model output becomes
ground truth" failure constitution rule 3 and BUILD_PLAN.md §7.3 exist to
prevent (the difference here is *fabricated* rather than *unreviewed*, but
the harm is the same shape). `get_llm_client()` raises `RuntimeError`
clearly instead; tests inject `FakeLLMClient` via FastAPI's
`dependency_overrides`, the same mechanism already used for `get_db`.
Verified live: an unconfigured `/ai-review` fails with a 500 naming the
missing env var, not a fabricated verdict.
Evidence: `app/llm/client.py::get_llm_client`;
`tests/test_ai_reviewer.py::test_get_llm_client_raises_clearly_when_unconfigured`.

## ADR-013: GET /companies/{id} expanded to match §6 fully, while building P5
P1's original `get_company` only returned `current_thesis` + `versions`.
BUILD_PLAN.md §6 always specified more: "current thesis, last 8 periods of
observations, health check history, pending proposals, active overrides" -
a gap that wasn't caught by P1's tests because nothing in P1-P4 needed that
data yet. P5's drawer (redlines with observed-vs-threshold, health-check
timeline, override badge - §8 point 3, §5 rule 2) is the first thing that
actually needs it, so it's fixed now rather than carried forward. Added:
`observations` (last 8 periods), `health_checks`, `pending_proposals`,
`kill_triggers` (with each trigger's latest observed/breached/fired from
`trigger_evaluations`), and `active_override` (the company's most recent
`status_events` row, if `override=TRUE`) - plus `has_active_override` on the
card-level `CompanyOut` too, since §5 rule 2 requires the badge on the card,
not just the drawer. "Active override" is defined as: the single most
recent `status_events` row for the company has `override=TRUE` (a later
non-override resolution clears it) - computed via `DISTINCT ON
(company_id) ... ORDER BY created_at DESC` for the list view, so it stays
one query per page rather than N+1.
Evidence: `app/routers/companies.py::get_company`, `_latest_override_flags`;
`app/schemas/company.py::CompanyDetail`;
`tests/test_api_companies.py::test_company_detail_includes_observations_triggers_and_override_flag`.

## ADR-014: P5 frontend scope trims - header stats page-capped, no sparkline charts, custom lightweight schema validator
Three deliberate v1 simplifications against §8's full description:
1. **Header stats** are computed client-side from one `GET /companies?page_size=200`
   call rather than a dedicated aggregate endpoint. Correct up to 200
   companies; a real aggregate endpoint is the right fix once portfolios
   exceed that, not before.
2. **Cards show `core_metrics` values (§1.2's denormalized snapshot from
   `thesis_data`), not sparklines.** A real trend line needs a
   per-company-per-metric time series fetch at list-render time, which is a
   genuine N+1 risk; the delta/trend affordance §8 asks for is deferred
   until there's a batched trend endpoint to drive it.
3. **The JSON tab's client-side validator (`frontend/app.js::validateNode`)
   is a small hand-written recursive checker** (required fields, types,
   enums, `$ref`/`$defs` resolution) against the real
   `contracts/thesis.schema.json` - not a full JSON Schema engine (no
   `anyOf`/`pattern`/`format`). Business-rule validation (revenue split
   sums, metric-registry membership, Premise/Conclusion counts) only exists
   server-side in Pydantic and is surfaced via the 422 error list on submit.
All three are scope trims to ship a genuinely working v1, not silent gaps -
verified end-to-end in a real browser (chrome-devtools-axi): create company
(JSON tab against the actual golden fixture), dynamic metrics field proven
by inserting a live `metric_definitions` row and watching it appear with
zero frontend changes, post a breaching observation, resolve the resulting
proposal through the override-requires-a-note path, and confirm the
override badge on both the header stat and the card.
Evidence: `frontend/app.js`, `frontend/components/*.js`; this session's
browser verification (no automated test suite covers static frontend
assets - verification here is the browser trace itself, per the project's
UI-change rule).

## ADR-015: P6 export scope and eligibility interpretation
Several judgment calls implementing §7 precisely:
1. **"Raw company data" for thesis_synthesis** is classification plus prior
   observations (period_end before the version's authored_at). This schema
   has no filings/concall text store, so it's a real but limited proxy, not
   a stand-in for one - documented in code, not silently treated as complete.
2. **Rule 1 (never train on unreviewed AI output) is structurally
   guaranteed, not just filtered.** `health_checks` rows only ever get
   written by human action (`resolve_proposal` on accept, or
   `submit_health_check`) - `human_confirmed=True` on every single row by
   construction (`app/services/audit.py`). The filter is kept anyway as a
   defensive, self-documenting check, per constitution rule 4's "correctness
   requirement, not preference."
3. **Reasoning chains only exist for verdict rows that came from an
   accepted ai_proposed proposal.** A rule-engine firing has no multi-step
   reasoning to export, so its resulting health check gets
   reasoning_chain=None rather than a synthesized one, and is naturally
   excluded by rule 3's >= 3 steps requirement (fixed in
   app/services/audit.py::resolve_proposal while building this phase - the
   P3 code never populated this field because nothing needed it until now).
4. **Split assignment is a deterministic hash on first sight, then a real
   stored row** (training_splits) - not stratified per operating_model in
   the strict sense (each company is assigned independently via
   sha256(company_id) % 10000 < 1500), which is a reasonable approximation
   of "~15% held out, stratified" at the dataset sizes this schema
   realistically produces from a single analyst's tracked companies, without
   needing to rebalance existing assignments as new companies are added
   (§7.4's "stable across runs" requirement takes priority over exact
   stratification precision).
5. **The stats endpoint's leakage check re-scans already-filtered rows and
   is expected to always read 0.** `_verdict_rows` hard-excludes leaking
   rows before yielding them, so leakage_violations is a live regression
   guard on the filter itself (would only go nonzero if a future change
   weakened it), not a discovery mechanism over already-exported data.
Verified live (docker-compose): created a company, confirmed
thesis_synthesis/redline_extraction export immediately, confirmed a
backdated observation plus accepted AI review is correctly excluded from
verdict export until outcome is closed, confirmed the JSONL endpoint
produces well-formed rows in all three formats, and exercised the frontend
export panel end-to-end in a real browser.
Evidence: `app/services/exporter.py`; `tests/test_exporter.py`;
`tests/test_eval.py`.

## ADR-016: multi-user login with RBAC, deliberately beyond BUILD_PLAN.md v1
BUILD_PLAN.md §0 scopes v1 auth to a single-analyst static API key,
"scoped up in P6 if needed, not before." The user explicitly asked for
named-user login with read/write permissions, outside that plan, during
this session (2026-09-03). Constitution rule 1 governs this agent silently
redesigning the spec when reality contradicts it - it does not block the
human deliberately extending the spec themselves, so this is built as a
real ADR-documented addition, not a silent rewrite of BUILD_PLAN.md
(which stays untouched, as required).

Design:
- `users` table (new migration, beyond BUILD_PLAN.md §2's schema): email,
  PBKDF2-SHA256 password hash (no new dependency - Python's stdlib
  `hashlib.pbkdf2_hmac`, salted per-user), role (`read_write`/`read_only`),
  active flag, login timestamp.
- JWT session tokens (pyjwt, the one new dependency) issued by
  `POST /api/auth/login`, 24h expiry. `app/auth.py::get_current_actor`
  accepts EITHER a valid `Authorization: Bearer` token OR the original
  `X-API-Key` (grandfathered, full read_write, identity=ANALYST_NAME) - the
  pre-existing machine-access path keeps working completely unchanged,
  verified by a dedicated test (`test_api_key_still_works_unchanged`).
- `require_write` (403 for `read_only` actors) added per-route on every
  mutating endpoint across all six routers; `authored_by`/`ingested_by`/
  `actor` fields that used to hardcode `ANALYST_NAME` now thread the real
  logged-in user's email through via a new optional `actor` parameter on
  the affected service functions (defaulting to `ANALYST_NAME`, so
  API-key/test callers are unaffected).
- Frontend: a login gate (email/password, with API-key entry kept as a
  fallback under a details/summary disclosure) storing the JWT in
  localStorage, a session badge, and read_only UI gating on the main write
  entry points (New Company nav button, the four drawer action buttons,
  review-queue resolve buttons) - a UX affordance only; the backend 403 is
  the real boundary, proven by `test_read_only_user_cannot_create_company`.
- Two named users (rohit.negi@rdc.in, siddhesh.dige@rdc.in) seeded via
  `seeds/create_users.py`, each with a randomly generated password printed
  once and never stored anywhere in this codebase or its git history -
  written to a local, gitignored `creds.md` instead of being committed,
  since credentials never belong in version control regardless of a
  repo's visibility setting.
Evidence: `app/services/user_auth.py`, `app/auth.py`, `app/routers/auth.py`,
`migrations/versions/3f656576d076_users_auth.py`, `frontend/app.js`
(login/session/gating), `tests/test_auth.py` (12 tests).
