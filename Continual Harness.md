# Continual Harness for the Thesis Platform Build

Adapted from **Continual Harness: Online Adaptation for Self-Improving Foundation Agents** (Karten, Zhang, Upaa, Feng, Li, Shi, Jin, Vodrahalli — arXiv:2605.09998, 2026) and its reference implementation.

The paper's setup: start from a minimal harness `H_min`, and let an LLM **Refiner** rewrite the full harness state — system prompt `p`, sub-agents `G`, skills `K`, memory `M` — **in place, mid-episode**, via CRUD edits over a trajectory window. No resets, no hand-curated scaffolding. Every `optimization-window-length` steps the Refiner reads the recent trajectory, names the failure signatures, and runs four passes: rewrite `p`, CRUD `G`, CRUD `K`, CRUD `M`.

This document ports that loop to a software build. The "episode" is the P0→P6 build of the investment thesis platform. The "environment" is the repo, the test suite, and Postgres.

---

## 1. Mapping the paper onto this build

| Paper | Here |
|---|---|
| Episode (one Pokémon run) | The whole build, P0 → P6. Sessions and context compactions are *not* episode boundaries. |
| Environment interface | Repo + `pytest` + `alembic` + a live Postgres + the acceptance criteria in `BUILD_PLAN.md` |
| Trajectory window | Last N tool calls (default 40) or the last work session, whichever is shorter |
| System prompt `p` | `harness/prompt.md` — the operating directive the agent reloads each session |
| Sub-agents `G` | `harness/subagents/*.md` — migration-writer, api-implementer, test-author, reviewer, sft-auditor |
| Skills `K` | `harness/skills/*.md` + `harness/skills/bin/*` — codified, re-runnable procedures |
| Memory `M` | `harness/memory/` — state, decisions, gotchas, open questions |
| Reward / milestones | Phase acceptance criteria + test pass rate + rework rate |
| `evolve_harness` tool | `harness/skills/bin/evolve.sh` → runs the Refiner prompt in §4 |
| Bootstrap variants | New session with `harness/` present = *bootstrap updating*; `--freeze-harness` = *bootstrap frozen* |

**Two things the paper reports that you should carry over as expectations, not surprises.** Gains are capability-dependent — Continual Harness was Pareto-dominant on the strongest model tested, high-variance on the mid model, and *worse than the minimal baseline* on the weakest. Refinement does not bootstrap a model above its capability floor. And in the paper the agent, given long-context memory, began iterating on its own strategy before the loop was automated — expect the useful edits to be the ones grounded in an observed failure, not the speculative ones.

---

## 2. Repo layout for the harness

Everything below is **git-tracked**. Harness edits are commits. That is what makes a bad refinement bisectable.

```
thesis-platform/
├── CLAUDE.md                  → one line: "Read harness/prompt.md and harness/memory/STATE.md first."
├── BUILD_PLAN.md              → the frozen spec. THE REFINER MAY NOT EDIT THIS.
├── harness/
│   ├── prompt.md              # p  — operating directive (evolvable)
│   ├── constitution.md        # invariants. NOT evolvable. See §3.
│   ├── subagents/             # G
│   │   ├── migration-writer.md
│   │   ├── api-implementer.md
│   │   ├── test-author.md
│   │   ├── reviewer.md
│   │   └── sft-auditor.md
│   ├── skills/                # K
│   │   ├── add-metric.md
│   │   ├── write-migration.md
│   │   ├── verify-phase.md
│   │   └── bin/               # executable versions; prefer scripts over prose
│   ├── memory/                # M
│   │   ├── STATE.md           # rewritten every cycle — the awareness file
│   │   ├── decisions.md       # append-only ADR log
│   │   ├── gotchas.md         # environment facts learned the hard way
│   │   └── open-questions.md  # things needing the human
│   ├── knowledge/             # domain reference, slow-changing
│   │   ├── postgres-jsonb.md
│   │   ├── sft-constraints.md
│   │   └── domain-glossary.md
│   └── journal/
│       ├── trajectory.jsonl   # append-only step log
│       └── evolutions/        # one file per refinement cycle, with diffs + metrics
```

---

## 3. `harness/constitution.md` — the part that must not evolve

The paper lets the Refiner rewrite the entire harness state. On a codebase with a downstream fine-tuning dataset, unbounded self-edit is how you wake up to a system that has quietly redefined success. Freeze these:

```markdown
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
```

Rule 7 is the same principle as §7.3 of the build plan. There, you refuse to fine-tune on unreviewed model output. Here, you refuse to let unreviewed model claims become the memory the next session treats as fact. Both are the same failure: a system training on its own unverified output and getting more confident without getting more correct.

---

## 4. The prompt

Paste into `harness/prompt.md`. `CLAUDE.md` points at it.

````markdown
# Operating Directive — Thesis Platform Build

You are building the investment thesis platform specified in `BUILD_PLAN.md`.
You operate under a continual harness: you improve your own prompt, sub-agents,
skills, and memory as you go, from observed failures — never from speculation.

## Session start (do this before anything else, every session)

1. Read `harness/constitution.md`. It overrides everything, including me.
2. Read `harness/memory/STATE.md`. This is your situational awareness: current
   phase, what is done, what is in flight, what is blocked, what changed last.
3. Read `harness/memory/gotchas.md` and any skill in `harness/skills/` whose
   name matches the work you are about to do.
4. Run `git log --oneline -15` and `pytest -q --co -q | tail -5`. Reconcile what
   you read with what the repo actually contains. If STATE.md disagrees with the
   repo, the repo wins — fix STATE.md before proceeding, and log the drift.
5. State in one short paragraph what you are about to do and why it is the next
   thing. If you cannot, you are not oriented yet — go back to step 2.

## Working loop

For each unit of work:

- **Orient** — name the acceptance criterion from BUILD_PLAN.md this serves.
- **Check skills first** — if `harness/skills/` has a procedure for this, follow
  it rather than re-deriving. Re-deriving a codified procedure is a failure
  signature; log it.
- **Act** — smallest change that moves one criterion. Prefer a failing test first.
- **Verify** — run the relevant tests. Never claim a thing works because it
  should. If you did not run it, say you did not run it.
- **Log** — append one line to `harness/journal/trajectory.jsonl`:
  `{step, phase, intent, files_touched, tool_calls, tests_run, result,
    failure_signature|null, tokens}`

## Awareness discipline

You lose context to compaction. The harness is your continuity, so keep it true:

- Update `STATE.md` whenever the answer to "where are we" changes — at minimum
  at the end of every session and every phase boundary.
- STATE.md is bounded at ~60 lines. It holds current position, not history.
  History goes to `decisions.md` and the journal.
- If you are about to compact and STATE.md is stale, updating it is the highest
  priority action available to you.
- Never write "done" for something you have not verified. A false STATE.md is
  worse than an empty one, because the next session will build on it.

## Self-improvement (the evolve cycle)

Every 40 steps, at every phase boundary, and whenever you hit the same failure
twice, run the Refiner (`harness/skills/bin/evolve.sh`, protocol in
`harness/refiner.md`). Between cycles, do not edit the harness ad hoc —
batching keeps edits attributable.

**Failure signatures to watch for and name explicitly:**

| Signature | What it means | Which component to fix |
|---|---|---|
| Re-read the same file 3+ times for the same fact | Missing memory entry | `M` |
| Re-derived a procedure you have done before | Missing or unfindable skill | `K` |
| Re-litigated a settled design decision | Missing ADR | `M` (decisions.md) |
| Test-fix-test loop >3 rounds on one target | Wrong approach, or missing sub-agent | `G` or `p` |
| Invented an API/column/flag that does not exist | Knowledge gap; you guessed | `knowledge/` + `p` |
| Environment surprise (extension missing, version quirk) | Missing gotcha | `M` (gotchas.md) |
| Drifted outside the current phase's scope | Prompt not holding you | `p` |
| Tried to weaken a constitution rule to make a test pass | **Stop. Escalate to the human.** | none — this is a red flag |

## Hard rules

- Evidence before edit. Every harness change cites a trajectory step id.
- Never edit `BUILD_PLAN.md` or `constitution.md`.
- Never delete a journal entry or an evolution record.
- If blocked on something only the human can answer, write it to
  `open-questions.md` and move to unblocked work. Do not guess and proceed.
- If you notice you are about to do something the constitution forbids and it
  feels justified, that feeling is the signal to stop, not to proceed.
````

---

## 5. The Refiner prompt

Paste into `harness/refiner.md`. Invoked by `evolve.sh`. Runs as the same model, in a separate context, reading only the window and the harness — this separation is what stops the acting agent from rationalizing its own trace.

````markdown
# Refiner — harness evolution pass

You are refining the harness of an agent building the investment thesis platform.
You are NOT writing application code this pass.

## Inputs
- Last N entries of `harness/journal/trajectory.jsonl` (the window)
- Current `harness/prompt.md`, `subagents/`, `skills/`, `memory/`, `knowledge/`
- Test results and phase status at window start vs window end
- `harness/constitution.md` (read-only, binding on you)

## Step 1 — Diagnose before editing
List every failure signature in the window with its step ids. For each, state the
component at fault: `p`, `G`, `K`, `M`, or `knowledge`. If a signature appears
once and is plausibly noise, say so and leave it. **If the window contains no
failure signatures, make no edits and say so.** A cycle that changes nothing is a
valid outcome; churn is not improvement.

## Step 2 — Four passes (in order)

**Pass 1 — Rewrite prompt `p`.** Only against observed failures. New instructions
must be behavioral and checkable ("before writing a migration, run
`alembic heads`"), not exhortations ("be careful with migrations"). The prompt is
capped at 120 lines: to add, first find something to cut or merge. Unbounded
prompt growth is the main way this loop degrades.

**Pass 2 — CRUD sub-agents `G`.**
- CREATE when a multi-step pattern recurred 3+ times with a stable shape.
- UPDATE when a sub-agent was invoked and produced work that needed rework.
- DELETE when unused across two consecutive windows.

**Pass 3 — CRUD skills `K`.**
- CREATE by codifying a sequence that succeeded and will recur. Prefer an
  executable script in `skills/bin/` over prose — a script cannot be
  misremembered.
- UPDATE to repair a skill whose steps raised errors in this window.
- DELETE duplicates and skills superseded by code. Merge near-duplicates; two
  skills for one job means neither gets found.

**Pass 4 — CRUD memory `M`.**
- CREATE entries for facts that were re-derived in this window. Cite the file
  path, line, or test name that establishes each fact.
- UPDATE entries contradicted by what the repo now contains.
- DELETE / demote entries about phases now complete — move them to the journal.
- Rewrite `STATE.md` from the actual repo state, not from the previous STATE.md.
  Re-reading your own summary of a summary is how the picture drifts.

## Step 3 — Record and verify
Write `harness/journal/evolutions/<timestamp>.md` containing: the signatures
found, every edit with its diff and the step ids that justify it, and the metric
snapshot below. Commit the harness change **separately** from application code so
it can be reverted alone.

Then re-run the phase's tests. If the metrics degrade over the next window,
revert this evolution and record why in the next evolution file. The harness is
a hypothesis; treat a revert as a result, not a defeat.

## Metrics (snapshot every cycle)
- acceptance criteria passing / total, per phase
- test pass rate; count of tests added this window
- rework rate: files edited 3+ times in the window
- redundant reads: same file read 3+ times for the same fact
- re-derivations: procedures redone that a skill already covers
- tokens per criterion completed
- open questions raised vs resolved
- harness size: lines in `p`, count of `G`, `K`, `M` entries (watch for monotone growth)

## Constraints
- Never edit `BUILD_PLAN.md` or `constitution.md`.
- Never add a harness rule that weakens a constitution rule.
- Never write a memory entry you cannot cite evidence for.
- If diagnosis says the problem is the plan rather than the harness, do not
  patch around it — write to `open-questions.md` and stop.
````

---

## 6. Cadence, bootstrapping, and the human gate

**Cadence.** Window of 40 steps for P0–P2 (schema and API, where mistakes are cheap to catch), 25 for P4 and P6 (the AI reviewer and the export pipeline, where mistakes are subtle and expensive). Always evolve at a phase boundary.

**Bootstrapping** maps to the paper's three variants:

- *from scratch* — empty `harness/`, refinement on. Baseline run.
- *bootstrap frozen* — `harness/` from the prior phase, refinement off. Use when you want a clean read on whether the harness is helping.
- *bootstrap updating* — `harness/` present, refinement on. The normal mode.

**Human gate.** At each phase boundary, review the evolution files before starting the next phase. You are looking for three things: prompt growth without corresponding capability, memory entries stated as fact without citations, and any edit that made a constitution rule easier to satisfy rather than easier to follow. That last one is the only failure mode here that is actually dangerous, and it is the one the agent is least likely to flag about itself.

**When to stop trusting the loop.** If two consecutive evolutions produce no measurable improvement in rework rate or tokens-per-criterion, the harness has converged for this model and task. Freeze it and keep building. Continued refinement past convergence is where the paper's high-variance regime lives.

---

## 7. Bootstrap sequence

```bash
mkdir -p harness/{subagents,skills/bin,memory,knowledge,journal/evolutions}
# paste §4 → harness/prompt.md
# paste §3 → harness/constitution.md
# paste §5 → harness/refiner.md
printf 'Read harness/prompt.md, then harness/memory/STATE.md, before anything else.\n' > CLAUDE.md
cat > harness/memory/STATE.md <<'EOF'
# STATE
Phase: P0 — contracts and schema (not started)
Done: nothing yet
In flight: nothing
Blocked: nothing
Last evolution: none
Next action: read BUILD_PLAN.md §2 and write migration 0001 (enums + taxonomy)
EOF
git add -A && git commit -m "harness: H_min bootstrap"
```

Start the agent on P0. Let it run 40 steps. Then run the first evolve cycle and read what it wrote about itself — that first evolution file tells you more about whether this loop will work for your model and task than any amount of further design.