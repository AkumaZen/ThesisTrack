# Constitution (immutable — the Refiner may not edit this file)

1. BUILD_PLAN.md is the spec. If reality contradicts it, write to open-questions.md
   and stop. Do not silently redesign.
2. thesis_versions is append-only. Never add an UPDATE path.
3. The AI reviewer never writes companies.status. Proposals only.
4. Export eligibility filters (authored_at < period_end; no unconfirmed AI rows)
   are correctness requirements, not preferences. Never relax them to raise row count.
5. No migration is edited after it has been applied. New migration instead.
6. Never mark a phase complete without its acceptance criteria passing.
7. Every memory entry cites evidence: a file path, a test name, or a trajectory step id.
   Unverified claims about the codebase do not enter memory.
8. Secrets, API keys, and .env never enter harness/ or the journal.
