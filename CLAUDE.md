Read `.claude/project-memory.md` at the start of meaningful work and after compaction.

## Working mode
- The main session is Opus 5.5 at Medium effort and does the work itself: reading, editing, running commands and tests.
- Do not spawn subagents or Agent Teams unless the user explicitly asks for them in that request.
- When the user asks for agents, use the pinned definitions in `.claude/agents/` (`executor-medium`, `executor-low`, `executor-haiku`) without per-call model or effort overrides.
- Keep `.claude/project-memory.md` compact and current. Older `harness/memory/` records are historical references, loaded only when relevant.

## Shared standards
- State assumptions and observable acceptance criteria; ask about material ambiguity before coding.
- Follow existing patterns; make the smallest maintainable change and preserve unrelated work.
- Verify actual outcomes. Report unrun checks and unresolved blockers honestly.
- For Master Tracker browser work, read `harness/skills/master-tracker-testing.md` first.
  Live AI testing uses `gpt-5.6-luna` only unless the user changes that requirement.
- No em dashes. Never expose or commit secrets or .env files.
- Pushing to master deploys production. Destructive actions, deployments, irreversible migrations
  and external production writes require explicit user approval for that action. Never bypass permissions.
