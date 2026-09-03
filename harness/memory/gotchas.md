# Gotchas (environment facts learned the hard way)

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
