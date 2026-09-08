# Gotchas (environment facts learned the hard way)

## drizzle-kit migrations are never auto-applied - to local OR production
Nothing in this repo runs `drizzle-kit migrate` (or raw-applies `drizzle/*.sql`)
automatically, on either the local docker Postgres or the Vercel-deployed
Aiven Postgres. A migration file existing in `drizzle/` and being committed
does NOT mean the database has it - two real incidents this session:
`0001_add_sectors.sql` existed in the repo but had never been applied
locally (`GET /api/sectors` 500ing with `relation "sectors" does not
exist`, no `drizzle.__drizzle_migrations` tracking table even present),
and `custom_notes` (0002) was missing from production for the same reason.
Fix pattern each time: `docker exec -i <postgres-container> psql -U <user>
-d <db> < drizzle/000N_*.sql` for local, or a small standalone Node script
reading `DATABASE_URL` out of `.production.env` and running the same SQL
via the `postgres` package for prod (see `web/_prod_migrate.mjs`) - both
migrations are pure additive DDL (`CREATE TABLE`/`ALTER TABLE ADD
CONSTRAINT`), safe to run any time, but must be run by hand. After every
schema change, check both databases explicitly rather than assuming a
migration file in the repo means the migration happened.

## Vercel production deploys were silently broken for 4+ days: `vite: command not found`
Every deployment in `vercel ls` for majdoors/web from 2026-09-04 onward
failed in ~2 seconds with `sh: line 1: vite: command not found` /
`Error: Command "vite build" exited with 127` - `vite` is a devDependency
and the build logs show **no install step ran at all** before `vercel
build` tried to invoke it (jumps straight from "Running vercel build" to
the failing command, no npm/pnpm install output anywhere in between).
The production alias (`thesis-track-sigma.vercel.app`) kept returning 200
throughout because it was still serving the last deployment that succeeded
before this started - so the site *looked* fine while every subsequent
push, across two full feature sessions, silently never went live. This is
a Vercel project setting (Build & Development Settings -> Install Command),
not application code - `vercel inspect <url> --logs` is how it was
diagnosed, but fixing it needs dashboard access, which this session didn't
have. **Always check `vercel ls` / `vercel inspect --logs` after a push
before assuming a deploy actually landed** - a 200 on the live alias proves
nothing about whether the latest commit is what's serving it.

## The Claude Code Auto Mode classifier gates writes to production, not reads
Read-only queries against the production database (checking which tables
exist, which users exist) went through without a permission prompt.
Anything that *writes* to production - an `UPDATE users SET
password_hash`, a migration's `CREATE TABLE`, even generating a password
hash locally with an inline `node -e "..."` in a context that was clearly
about to touch a real production credential - got denied by the classifier
outright, and a verbal "I am allowing you, go ahead" in chat does **not**
lift that block; it requires either an actual Bash permission rule added
in the user's Claude Code settings, or the user running the command
themselves in their own terminal. Working pattern that held up twice this
session: write the mutation into a small, self-contained script (reads its
DB URL out of a gitignored `.env` file at runtime, never logs it, never
takes the secret as a literal in a command) and hand the exact `node
...` invocation to the user to run themselves - see `web/_prod_migrate.mjs`
and `web/_prod_reset_password.mjs`.

## Host port 5432 is already owned by an unrelated project
This machine has other docker-compose projects (`restaurantapp-db-1`) that bind
host port 5432. `docker compose up -d postgres` with a `5432:5432` mapping
starts without error but silently fails to publish the port if it's taken -
`docker ps` shows the container with no host port at all, and a client
connecting to `localhost:5432` instead reaches the *other* project's Postgres,
producing a misleading `password authentication failed` error rather than
`connection refused`.
Evidence: `docker-compose.yml` (P0 commit) maps Postgres to host port
**55432**, not 5432; `.env` / `.env.example` `DATABASE_URL*` use `:55432`.
If `docker ps` ever shows this project's postgres container with an empty
PORTS column, check for a port collision with another project first.

## SQLAlchemy ORM needs a Computed() marker on DB-generated columns, or INSERT fails
`thesis_versions.search_tsv` is `GENERATED ALWAYS AS (...) STORED` (created by
the migration, not by SQLAlchemy DDL). Mapping it as a plain
`mapped_column(TSVECTOR, nullable=True)` makes the ORM include it (as NULL)
in every INSERT, which Postgres rejects: `psycopg.errors.GeneratedAlways:
cannot insert a non-DEFAULT value into column "search_tsv"`. Fix: mark it
`mapped_column(TSVECTOR, Computed("''", persisted=True), nullable=True)` -
the `Computed(...)` text is never used for DDL here (we never run
`Base.metadata.create_all()` against migration-owned tables), it only tells
the ORM to omit the column from INSERT/UPDATE.
Evidence: `app/models.py::ThesisVersion.search_tsv`.

## FastAPI Header(...) (required) short-circuits to 422 before your dependency body runs
`require_api_key(x_api_key: str = Header(...))` never reaches the
`HTTPException(401)` on a missing header - FastAPI's own parameter validation
rejects it first with a generic 422 RequestValidationError. Use
`Header(default=None)` (Optional) and check for `None` yourself inside the
function body to get the 401 BUILD_PLAN.md §6 calls for.
Evidence: `app/auth.py::require_api_key`;
`tests/test_api_companies.py::test_create_company_requires_api_key`.

## Dockerfile COPY list doesn't auto-track new served directories
Adding `frontend/` (P5) and mounting `contracts/` as static dirs in
`app/main.py` isn't enough - the Docker image only contains what
`Dockerfile`'s `COPY` lines list. First rebuild after adding the static
mounts served 404s for every frontend asset because `frontend/` and
`contracts/` weren't copied in. Caught immediately by the routine
live-container curl checks (each path checked individually), not by
anything more systematic - worth remembering for P6 if `eval/` or `seeds/`
ever need to be present at runtime rather than just at build/migration time.
Evidence: `Dockerfile` (P5 commit e8b5235 added `COPY frontend`, `COPY contracts`).

## Windows/Hyper-V can dynamically exclude the exact host port docker-compose uses
After a Docker Desktop restart, `docker compose up` failed to bind host port
55432 with `bind: An attempt was made to access a socket in a way forbidden
by its access permissions` even though nothing was listening on it
(`netstat` showed it free). Cause: `netsh interface ipv4 show
excludedportrange protocol=tcp` showed Hyper-V/WSL2 had reserved
55400-55499 as an excluded range this time (these ranges shift across
Docker/WSL restarts) - 55432 fell inside it. Fix: moved the mapping to
45432 (`docker-compose.yml`, `.env`, `.env.example`), which isn't in any
current excluded range. If this happens again, run that `netsh` command
first and pick a host port outside all listed ranges, rather than assuming
a real port conflict (see the other gotcha above about port 5432 - this is
a different failure mode with the same symptom shape: bind fails, nothing
obviously listening).
Evidence: `docker-compose.yml`, `.env`, `.env.example` (host port 45432).

## Frontend edits don't reach the running container without a rebuild
`docker-compose.yml`'s `api` service is `build: .` with no volume mount for
`frontend/` - the Dockerfile `COPY`s it in once at image build time. Editing
`frontend/app.js`/`drawer.js`/`index.html` on disk changes nothing in the
already-running container; a plain `docker compose restart api` doesn't
help either since it reuses the existing image. Burned significant time
chasing a phantom "window.open does nothing on click" bug (ADR-027) before
realizing the container was serving a stale pre-refactor app.js the whole
time. Fix/verify: `docker compose build api && docker compose up -d api`
after any frontend change, before browser-testing it.
Evidence: `docker-compose.yml` `api:` service has no `volumes:` entry;
ADR-027 in decisions.md.
