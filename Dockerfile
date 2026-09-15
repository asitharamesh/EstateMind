# syntax=docker/dockerfile:1
#
# One build, two images that can never disagree about the model:
#   docker compose build            (or: docker build --target api|web .)
#
# `trainer` downloads the pinned dataset (SHA-256 verified), trains every region
# with a validated dataset, and evaluates through the production pipeline. The
# api image gets its model artifacts from that stage and the web image gets the
# offline region snapshot from the same stage.

FROM python:3.13-slim AS python-deps
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

FROM python-deps AS trainer
COPY backend backend
RUN python -m backend.scripts.train_model

FROM python-deps AS api
RUN useradd --create-home --uid 10001 estatemind
COPY backend backend
COPY --from=trainer /app/backend/assets/regions backend/assets/regions
USER estatemind
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]

FROM node:20-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci --ignore-scripts
COPY frontend frontend
COPY --from=trainer /app/frontend/public/data frontend/public/data
RUN npm run build

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
