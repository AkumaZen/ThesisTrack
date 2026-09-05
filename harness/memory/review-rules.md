# Learned Review Rules

Persistent, reusable project rules for the Continuous Application Review
agent (`/app-review`, harness/skills/continuous-review.md). Every rule here
came from the user confirming or correcting something, not from the
reviewer's own taste. The reviewer must read this file before every run and
never re-flag something a rule below already settles.

Format per rule: statement, then **Why** (what feedback produced it) and
**Applies to** (what kind of finding it constrains).

---

## Visual design

- **Palette is exactly three neutrals, zero accent color**: `#faf9f5`
  (paper/bg), `#141412` (ink/fg), `#f1eee7` (cream/surface), plus
  `color-mix()` derivatives of those two base pairs. No lime, no hue of any
  kind — status colors (`good`/`ok`/`warn`/`danger`) and `accent`/`accent-2/3/4`
  all alias `var(--fg)`. A finding that recommends "add a color to
  distinguish X" is wrong for this app unless the user asks for color back.
  **Why**: explicit instruction — "I want only these colors in the entire
  theme" (paper/ink/cream), later "remove lime entirely" including from
  primary buttons. **Applies to**: any UI/UX finding about color, status
  badges, button fills, focus rings.
- **Primary actions are ink-fill (`bg-fg text-bg`), not a tinted/colored
  fill.** **Why**: "replace this color with black" when lime was still the
  primary-button fill. **Applies to**: buttons, primary CTAs.
- **Headings (h1/h2/h3) render in Poppins; body/controls/labels stay in
  Inter.** Global rule in `web/src/routes/layout.css`, not a per-component
  choice. **Why**: "Remove existing fonts and use inter and poppins" →
  "I want to change this completely not only specific" (i.e. don't scope the
  swap to just stat numbers). **Applies to**: typography findings.
- **Light and dark themes must be genuine inversions** (`--fg`/`--bg` swap,
  every derived token tracks the swap) — never let both themes collapse to
  the same values. **Why**: a `/impeccable polish` pass broke this
  (light/dark had become no-ops) and the user flagged it explicitly.
  **Applies to**: any dark-mode / theme-toggle finding.
- **Page sections are cards**: `rounded-xl border border-border bg-surface
  p-5` is the standard container for a pillar/section on the company page,
  the ingest form, etc. Don't propose a different card treatment per page.
  **Why**: "card wise for all the segments... proper card design with round
  edges and proper design according to the theme" — applied consistently
  across company detail and the New Company page afterward. **Applies to**:
  layout/spacing findings on any page with distinct content sections.

## Interaction / workflow

- **Amend Thesis and company-creation share the same Custom Sections
  builder** — a feature added to one form must also work in the other
  unless there's a stated reason it shouldn't. **Why**: "Amend thesis should
  have an option of adding new sections... instead of custom sections" — the
  builder had been create-mode-only and the user wanted it everywhere it's
  conceptually the same action. **Applies to**: feature-parity findings
  across ingest/amend, and generally "does X work the same way everywhere
  it conceptually should."
- **Named user content gets a named nav entry, not a generic bucket
  label.** Each custom data table a user adds should appear in the company
  page's left nav under its own name, not lumped under one generic "Custom
  Sections" entry. **Why**: direct request, screenshot-driven. **Applies
  to**: any list of user-created items that also needs a nav/index
  representation elsewhere on the page.
- **Zod validation errors must go through the shared `zodErrorMessage()`
  formatter** (`web/src/lib/server/http.ts`) — never let `ZodError.message`
  (a JSON-stringified issues array) reach the UI raw. **Why**: "Add rows is
  not working" bug report turned out to be an unreadable raw-JSON error.
  **Applies to**: any form/API validation-error finding.
- **Custom table/column keys are auto-slugified from the user-typed label**
  (lowercase snake_case, via the shared `slugifyKey()` helper) rather than
  rejecting a normal label like "Shishir" with a 422. **Why**: same bug
  report as above — the lowercase-key requirement was invisible to the user.
  **Applies to**: any "form silently rejects normal input" finding.
- **Write actions are gated by `session.isReadOnly`** (e.g. "Edit Details"
  button only shows for the user who can write). Don't propose exposing a
  write action to a read-only session. **Applies to**: permission/RBAC
  findings.

## Process / how this agent should operate

- **Test only against the local dev server** (`http://localhost:5173`),
  never rebuild the Docker image or restart the container as part of a
  review — hot reload (Vite `usePolling`) keeps it live already. Rebuilding
  is the user's call, done explicitly and separately. **Why**: "I want you
  to use local server only for this playwright visual testing then and
  after all the changes i will tell you to rebuild the image and the
  container." **Applies to**: every review/verification cycle this agent
  runs.
- **Verify what you build with chrome-devtools MCP / Playwright by
  default** — but if the user says to stop verifying for a specific task
  ("don't perform this verification for now, I will do it myself"), stop
  immediately for that task and don't resume it unasked. **Why**: both
  instructions were given explicitly in the same project, in that order.
  **Applies to**: deciding whether to browser-verify a given fix.
- **Don't push to GitHub or deploy to production as a side effect of a
  review.** Land fixes locally, let the user try them, wait to be told to
  ship. **Why**: standing preference recorded in harness/memory/STATE.md
  from earlier sessions. **Applies to**: every fix this agent makes.
- **Clean up test data created during verification** (temp rows, temp
  companies) once a check is done, unless the user asks to keep it as a
  demo fixture. **Why**: established practice this session — verification
  custom-table rows were deleted from the dev DB after confirming the
  feature worked. **Applies to**: any review that writes data to the dev DB
  to exercise a flow.

---

_Update this file whenever the user reviews a finding and confirms or
corrects it — see harness/skills/continuous-review.md step 7. Keep entries
in this rule+why+applies-to shape so a future review can judge edge cases,
not just pattern-match the literal wording._
