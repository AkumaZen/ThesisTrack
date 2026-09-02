# Gotchas (environment facts learned the hard way)

## Host port 5432 is already owned by an unrelated project
This machine has other docker-compose projects (`restaurantapp-db-1`) that bind
host port 5432. `docker compose up -d postgres` with a `5432:5432` mapping
starts without error but silently fails to publish the port if it's taken —
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
`mapped_column(TSVECTOR, Computed("''", persisted=True), nullable=True)` —
the `Computed(...)` text is never used for DDL here (we never run
`Base.metadata.create_all()` against migration-owned tables), it only tells
the ORM to omit the column from INSERT/UPDATE.
Evidence: `app/models.py::ThesisVersion.search_tsv`.

## FastAPI Header(...) (required) short-circuits to 422 before your dependency body runs
`require_api_key(x_api_key: str = Header(...))` never reaches the
`HTTPException(401)` on a missing header — FastAPI's own parameter validation
rejects it first with a generic 422 RequestValidationError. Use
`Header(default=None)` (Optional) and check for `None` yourself inside the
function body to get the 401 BUILD_PLAN.md §6 calls for.
Evidence: `app/auth.py::require_api_key`;
`tests/test_api_companies.py::test_create_company_requires_api_key`.
