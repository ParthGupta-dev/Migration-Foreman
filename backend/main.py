from fastapi import FastAPI

app = FastAPI(title="Migration Foreman Backend")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
