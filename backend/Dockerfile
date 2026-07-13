# Backend runtime: python:3.12 (asyncpg wheels available; local Windows
# Python 3.14 has none, so Docker is the supported way to run this service).
FROM python:3.12-slim

# git is required for repo ingestion, worktrees, and PR branch pushes.
# nodejs/npm let the verification gate install JS dependencies and run
# npm-based test commands inside unit worktrees.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
