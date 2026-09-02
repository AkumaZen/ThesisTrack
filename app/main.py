from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.routers import companies, observations, taxonomy

app = FastAPI(title="Investment Thesis Platform")

app.include_router(companies.router)
app.include_router(observations.router)
app.include_router(taxonomy.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"field": ".".join(str(p) for p in err["loc"] if p != "body"), "message": err["msg"]}
        for err in exc.errors()
    ]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"errors": errors})


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
