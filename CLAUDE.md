Read harness/prompt.md, then harness/memory/STATE.md, before anything else.

## Workflow (multi-agent)
- The main session runs as the `master` agent (`.claude/settings.json`): read-only architect and
  reviewer that delegates all implementation to `executor-medium` (default) or `executor-low`
  (trivial, tightly scoped). Agent definitions live in `.claude/agents/`.
- One executor by default; two only for independent modules in separate worktrees. Fixes go back
  to the same executor rather than a fresh one.
- Persistent project memory: `.claude/project-memory.md`. Read it at the start of meaningful work
  and after compaction. Executors update it after significant work; keep it near 1,500 tokens.

## Shared standards
- Simplest maintainable solution; follow existing patterns; no speculative abstraction.
- Verify with real checks and report actual output; never claim untested results.
- No em dashes. Never commit secrets or .env files. Preserve unrelated user changes.
- Pushing to master deploys production. Pushes, production database changes and destructive
  actions need fresh explicit user approval.
