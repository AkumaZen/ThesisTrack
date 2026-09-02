# SQLAlchemy 2.x / FastAPI stack notes

Slow-changing technical facts about this stack, promoted from
`memory/gotchas.md` at the P1 evolve cycle because they're reusable across
every remaining phase (P2-P6 all add more ORM columns and more routers), not
one-off facts about this machine.

## DB-generated columns need `Computed(...)` as an ORM marker
A column the migration defines as `GENERATED ALWAYS AS (...) STORED` must be
mapped with `mapped_column(TYPE, Computed("<placeholder>", persisted=True), nullable=True)`.
Without it, SQLAlchemy includes the column (as `NULL`) in every INSERT, and
Postgres rejects it: `psycopg.errors.GeneratedAlways: cannot insert a
non-DEFAULT value into column "..."`. The `Computed(...)` text argument is
only used if SQLAlchemy ever issues CREATE TABLE DDL for the model — which we
never do here (all tables are migration-owned, raw SQL) — so a placeholder
string is safe. It exists purely to tell the ORM "omit this column from
INSERT/UPDATE."
Evidence: `app/models.py::ThesisVersion.search_tsv`;
`harness/memory/gotchas.md`.

## FastAPI `Header(...)` (required) pre-empts a dependency's own error handling
A required header param (`Header(...)` with no default) is validated by
FastAPI's own request-parsing layer *before* the dependency function body
runs. A missing header produces a generic 422 `RequestValidationError`, not
whatever your dependency would have raised. To return a specific status code
(e.g. 401 for a missing/invalid API key), declare the header optional
(`Header(default=None)`) and do the presence/value check yourself inside the
function.
Evidence: `app/auth.py::require_api_key`;
`tests/test_api_companies.py::test_create_company_requires_api_key`.

## Enum columns backed by an existing Postgres type
Every `ENUM` column here is declared `PGEnum(..., name="...", create_type=False)`
because the P0 migration already ran `CREATE TYPE` — letting SQLAlchemy think
it owns the type's lifecycle would make it try (and fail, or silently
diverge) to manage `CREATE`/`DROP TYPE` on `create_all`/`drop_all`, which we
never call anyway (migration-owned schema), but the flag also suppresses
spurious autogenerate diffs if Alembic autogenerate is ever turned on later.
Evidence: `app/models.py` (module-level `PGEnum(...)` declarations).
