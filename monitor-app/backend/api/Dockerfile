FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (layer cache friendly)
COPY pyproject.toml .
RUN pip install --no-cache-dir \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.30" \
    "asyncpg>=0.30" \
    "pydantic>=2.7" \
    "pydantic-settings>=2.3" \
    "supabase==2.10.0" \
    "upstash-redis>=1.1.0"

# Copy app code
COPY app/ ./app/

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
