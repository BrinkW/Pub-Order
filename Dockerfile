# Production image: builds the frontend, then serves it and the API from one process
# (backend/serve.py). Supabase settings come from SUPABASE_URL / SUPABASE_KEY at runtime.

FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/serve.py ./
# serve.py looks for the built frontend in backend/static.
COPY --from=web /web/dist ./static
RUN useradd --no-create-home --shell /usr/sbin/nologin pub
USER pub
EXPOSE 8000
# Render sets PORT; locally it defaults to 8000. Proxy headers let the app see the
# original https scheme behind Render's load balancer.
CMD ["sh", "-c", "exec uvicorn serve:app --host 0.0.0.0 --port \"${PORT:-8000}\" --proxy-headers --forwarded-allow-ips='*'"]
