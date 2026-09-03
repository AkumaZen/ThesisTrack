from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.routers import (
    ai_review,
    auth,
    companies,
    custom_tables,
    decisions,
    export,
    guidance,
    health as health_router,
    observations,
    price,
    taxonomy,
)

REPO_ROOT = Path(__file__).resolve().parent.parent

app = FastAPI(title="Investment Thesis Platform")

app.include_router(auth.router)
app.include_router(companies.router)
app.include_router(observations.router)
app.include_router(taxonomy.router)
app.include_router(health_router.router)
app.include_router(ai_review.router)
app.include_router(export.router)
app.include_router(guidance.router)
app.include_router(custom_tables.router)
app.include_router(decisions.router)
app.include_router(price.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"field": ".".join(str(p) for p in err["loc"] if p != "body"), "message": err["msg"]}
        for err in exc.errors()
    ]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"errors": errors})


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


# Registered last: /api/*, /health, and /contracts/* above all keep precedence
# over this catch-all. The frontend (P5) validates client-side against the
# same contracts/thesis.schema.json the backend generates (P0).
app.mount("/contracts", StaticFiles(directory=REPO_ROOT / "contracts"), name="contracts")
app.mount("/", StaticFiles(directory=REPO_ROOT / "frontend", html=True), name="frontend")
