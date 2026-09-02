from fastapi import FastAPI

app = FastAPI(title="Investment Thesis Platform")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
