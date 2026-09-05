# Skill: Continuous Application Review & Improvement

Invoked as `/app-review` (see `.claude/skills/app-review/SKILL.md`, which
follows this procedure). Not a one-off audit — a repeatable agent that
inspects the running app, finds real issues at feature and UI/UX level,
fixes what it safely can, and gets more accurate every run by learning
from what the user confirms or corrects.

## Inputs this skill reads before doing anything

1. `PRODUCT.md` — what this app is for, who uses it, what "done" means.
2. `DESIGN.md` — the actual design system (colors, type, components,
   Do's/Don'ts). This is the standard to check UI against, not the
   reviewer's own taste.
3. `harness/memory/review-rules.md` — every project-specific preference
   the user has already confirmed. Never re-flag something a rule there
   settles; never suggest a fix that a rule there forbids.
4. `harness/memory/review-log.md` — prior runs' findings and their status.
   Skip anything `wontfix`; check whether `open`/`deferred` items are now
   resolved before re-reporting them as new.
5. The codebase itself for the area under review (routes, components,
   services) — a finding must cite the actual file/line, not a guess.

## Review areas (walk all of these, not just the page you're pointed at)

- **Completeness** — features expected for an investment-thesis tracking
  tool that are missing or half-built (check `PRODUCT.md`'s stated
  capabilities against what's actually reachable in the UI).
- **Correctness of interaction** — every button, link, form, and workflow
  on the page(s) in scope actually does what it says: clicking submits,
  cancel actually cancels, disabled states are really disabled, validation
  fires before a bad request goes out, not after a 422 comes back raw.
- **UI/UX consistency** — spacing, card treatment, button hierarchy,
  hover/focus states, cursor (`pointer` on anything clickable, `not-allowed`
  on anything disabled), responsiveness at a couple of real breakpoints —
  measured against `DESIGN.md` and the closest existing page, not against
  a generic external standard.
- **Common patterns** — loading states, empty states, error states,
  confirmation on destructive actions, and toast/inline feedback after a
  write. Flag a page that's silent after a save/delete as a real bug, not
  a style nitpick — the user has no way to know it worked.
- **Cross-page consistency** — the same kind of action (e.g. "add a custom
  section," "edit an entity") should look and behave the same wherever it
  appears, unless `review-rules.md` says otherwise.
- **Edge cases** — empty lists, very long names, zero-row tables, a
  read-only session hitting a write-only control, network/API errors
  surfaced without a raw stack trace or JSON blob.
- **Overall polish** — would a real analyst using this daily notice
  something as rough or unfinished.

## Procedure

1. **Orient.** Read the five inputs above. State in 1-2 sentences what's
   in scope for this run (a specific page/flow, or "general sweep") and
   what's already known to be settled (from review-rules.md/review-log.md).
2. **Explore systematically**, using chrome-devtools MCP against
   `http://localhost:5173` only (never rebuild/restart the container as
   part of a review — see the process rules in `review-rules.md`). Take
   snapshots, exercise every interactive element in scope, try at least
   one edge case per flow (empty input, very long input, rapid
   double-click, read-only session if applicable).
3. **Log findings independently** — don't wait for the user to point
   things out. For each finding, capture: what's wrong, where (file/line
   if it's a code issue, URL/element if it's a live-UI issue), why it
   matters (impact on a real user of this app), and a proposed fix.
4. **Prioritize by impact**: broken/incorrect functionality > missing
   common pattern (no error/loading/empty state) > cross-page
   inconsistency > polish. Present findings in that order.
5. **Explain the "why"** for each — not just "this is inconsistent" but
   what a user experiences because of it.
6. **Fix what's safe to fix directly** (the kind of scoped, well-understood
   change this session already makes routinely) — implement, following
   `review-rules.md` and the existing code's own patterns, not new
   abstractions. For anything ambiguous (a product decision, not a defect),
   describe the options and ask rather than guessing.
7. **Re-check** every flow touched by a fix, same way it was found broken —
   don't claim a fix works without exercising it again live.
8. **Update the learned rules.** Whenever the user confirms a finding,
   corrects a proposed fix, or states a preference about how something
   should look/behave, add or amend an entry in `review-rules.md` in the
   existing rule/why/applies-to shape. Append this run's findings and
   their outcome to `review-log.md`.

## Hard constraints (inherited from this project's standing rules)

- Local dev server only (`http://localhost:5173`); no image rebuild, no
  container restart, unless the user explicitly asks for one afterward.
- No git push, no deploy, as a side effect of a review.
- Clean up any data written to the dev DB purely to exercise a flow.
- If the user says to stop verifying a specific task live, stop for that
  task and don't resume unasked — but the default for a new `/app-review`
  run is to verify live.
