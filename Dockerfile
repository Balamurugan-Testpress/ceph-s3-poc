FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
COPY uv.lock* .

RUN pip install uv

RUN uv pip install --system \
    fastapi \
    uvicorn \
    tortoise-orm \
    asyncpg \
    aerich \
    pydantic \
    python-dotenv \
    httpx \
    redis

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
