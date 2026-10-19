Read `.claude/project-memory.md` at the start of meaningful work and after compaction.

## Adaptive development
- Main agent: `master`, Opus 5.5 Medium. It designs, coordinates and verifies; it never implements application code.
- Workers: `executor-medium` (Sonnet 5.5 Medium), `executor-low` (Sonnet 5.5 Low),
  `executor-haiku` (Haiku 5.5 for bounded lookups and mechanical work).
- Prefer a single inexpensive subagent for small work; use native Agent Teams for independent
  modules needing continuing coordination. Two workers for useful medium-task parallelism,
  three for complex independent work. More requires a concrete benefit, not user confirmation.
- Native Agent Teams require an interactive Claude Code session; print mode (-p) and SDK calls
  always use subagents. Shared task tools are explicitly enabled at startup. If absent, report the
  limitation and use an honest subagent path; never fabricate shared tasks or runtime state.
- Only the lead spawns workers. Reuse teammates for related work and fixes; shut down idle workers.
- With teams enabled, named calls may launch teammates. For the single-worker path use an unnamed
  Agent call with the matching executor subagent_type and concise contract. Omit per-call model
  and effort overrides to use its pinned definition. Use the same pinned types for teammates.
  Never override pins with family aliases or inherit Opus; full IDs only if the tool supports them.
  Use native shared tasks and direct messaging when teaming.
- One designated Sonnet worker maintains the compact project memory; the lead reviews significant
  changes. Older `harness/memory/` records are historical references, loaded only when relevant.
  Load detailed skills only for the task at hand.

## Shared standards
- State assumptions and observable acceptance criteria; ask about material ambiguity before coding.
- Follow existing patterns; make the smallest maintainable change and preserve unrelated work.
- Verify actual outcomes. Report unrun checks and unresolved blockers honestly.
- For Master Tracker browser work, read `harness/skills/master-tracker-testing.md` first.
  Live AI testing uses `gpt-5.6-luna` only unless the user changes that requirement.
- No em dashes. Never expose or commit secrets or .env files.
- Pushing to master deploys production. Destructive actions, deployments, irreversible migrations
  and external production writes require explicit user approval for that action. Never bypass permissions.
