# Skill: add a new API endpoint group

Recurred 3x with a stable shape in P1 (companies, observations, taxonomy
routers) — codified at the P1 evolve cycle so P2 (rule-engine-triggered
routes), P3 (health-check), P4 (ai-review), and P6 (export) follow this
directly instead of re-deriving it.

## Shape

1. **Domain exceptions in the service, not the router.** `app/services/*.py`
   functions raise plain exception classes (`NotFoundError`, `TaxonomyError`,
   `AlreadyExistsError`, ...) — never `HTTPException`. Keeps the service
   layer testable without FastAPI/HTTP in the loop (see
   `tests/test_versioning.py`, which calls services directly).
2. **The router translates exceptions to status codes.** One `try/except` per
   domain exception type, mapped explicitly (`NotFoundError` → 404,
   `TaxonomyError`/validation → 422, `AlreadyExistsError` → 409). Never let a
   raw exception surface as a 500 for something the service already named.
3. **`dependencies=[Depends(require_api_key)]` on the `APIRouter(...)`**, not
   per-route — BUILD_PLAN.md §6 requires the key on every route under `/api`.
4. **Response shape lives in `app/schemas/`, not built ad hoc in the router.**
   The router constructs the Pydantic response model explicitly from ORM rows
   (no `from_attributes`/`model_validate(orm_obj)` shortcut used so far —
   ORM column names don't always match the response shape, e.g.
   `CompanyOut.broad_industry` is a name, not `Company.broad_industry_id`).
5. **Register in `app/main.py`** via `app.include_router(...)`.
6. **Test both layers**: a service-level test with a real DB session (no
   HTTP), and an HTTP-level test through `TestClient` with the DB dependency
   overridden to the test database (see `tests/test_api_companies.py`'s
   `_override_get_db` pattern) — not both for every endpoint, but the
   read-modify-verify-via-HTTP flows (BUILD_PLAN.md's phase "done when"
   criteria) need the HTTP layer, and anything with tricky concurrency/retry
   logic (versioning) needs the direct-service layer where threading is
   straightforward.

## Evidence
`app/routers/companies.py`, `app/routers/observations.py`,
`app/routers/taxonomy.py` — all three follow this shape;
`app/services/versioning.py`, `app/services/taxonomy.py` for the exception
convention.
