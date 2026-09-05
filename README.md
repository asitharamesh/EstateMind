# EstateMind

EstateMind is a full-stack real-estate valuation application that combines a React + TypeScript frontend, a FastAPI backend, and a trained Random Forest Regressor to deliver explainable property price predictions. Every prediction is computed by a real model trained on real King County, WA home-sale records — there are no hard-coded prices or canned formulas anywhere in the app.

## Features

- **Live price predictions** — enter square footage, bedrooms, bathrooms, city, age, and property type to get an instant estimate from a trained Random Forest model.
- **Explainable results** — a donut chart shows each top feature's share of the model's total price adjustment (with direction and real dollar contributions called out separately), plus a confidence score and a 10th–90th percentile price range, all derived from the actual tree ensemble.
- **Market positioning** — a Budget / Mid-Range / Luxury tier gauge (genuine percentile rank against real training-sale prices — see "Market tier" below) and a price-per-square-foot comparison against the local market average.
- **Cross-metro pricing** — the model trains on Seattle-area data only; other supported cities are adjusted using a real, cited Zillow Home Value Index (ZHVI) ratio, not a guessed multiplier.
- **Comparison view** — save up to three predictions side by side, each with an optional custom name (defaults to "{property type} in {city}" if left blank).
- **Model insights dashboard** — feature importance, a training learning curve (train vs. out-of-bag R²), a feature correlation matrix, and the full cross-metro price index, all served live from the backend.
- **Input validation on both ends** — the form only accepts realistic values (e.g. 500–8,000 sq ft) and shows an inline error before you can submit; the API independently rejects out-of-range requests with a clear message.
- **Graceful offline fallback** — if the backend is unreachable, the UI falls back to a clearly-labeled local heuristic instead of failing silently.

## Technology stack

**Frontend**
- React 18 + TypeScript, built with Vite
- Tailwind CSS + shadcn/ui (Radix primitives) for the component system
- Recharts for the model-insights charts
- Vitest + Testing Library for tests

**Backend**
- Python, FastAPI, Pydantic, Uvicorn
- scikit-learn (`RandomForestRegressor`), pandas, numpy

**Tooling**
- npm workspaces (root orchestrates the `frontend/` package; `concurrently` runs both dev servers together)
- dotenv-based configuration shared by both sides

## Project structure

```text
frontend/                  All frontend code
  src/
    components/
      dashboard/            PredictionForm, PredictionResultCard, CompareView, ModelInsights
      ui/                    shadcn/ui primitives (button, card, input, select, ...)
    hooks/                   Small reusable React hooks
    lib/
      predictionEngine.ts    API client + offline fallback heuristic + shared types
      modelMetrics.ts        Model metrics fetch + normalization
    pages/                   Route-level pages (Index, NotFound)
    test/                    Vitest unit tests
    App.tsx, main.tsx, index.css
  public/                    Static assets + generated data/ snapshots (gitignored)
  index.html, vite.config.ts, tailwind.config.ts, tsconfig*.json, package.json

backend/                   All backend/API/model code
  app.py                    FastAPI app, CORS, and route definitions only
  artifacts.py               Resolves artifact paths and loads the trained model + reference tables
  valuation.py                Feature building, prediction, confidence, and explanation logic
  schemas.py                  Request/response models (with realistic value bounds)
  scripts/
    train_model.py            Downloads real data, trains the model, writes all artifacts
  requirements.txt            Pinned Python dependencies
  assets/                     Downloaded dataset + trained model artifacts (gitignored, regenerated)

package.json                Root orchestrator (workspaces: ["frontend"]) - dev/build/test/lint scripts
.env / .env.example          Shared configuration for both frontend and backend
.venv/                       Local Python virtual environment (gitignored)
```

## How the frontend works

The UI is a single-page app (`frontend/src/pages/Index.tsx`) with three tabs:

1. **Prediction** — `PredictionForm` collects property details with realistic input constraints (min/max on every numeric field, inline validation errors, and a disabled submit button while any field is out of range) and calls `predictPrice()`.
2. **Compare** — up to three saved predictions rendered side by side.
3. **Model Insights** — fetches `/api/model-insights` and `/api/model-metrics` and renders them as charts and tables.

All API access goes through `frontend/src/lib/predictionEngine.ts` and `modelMetrics.ts`, which normalize/clamp input, call the backend, and fall back to a local, clearly-labeled heuristic (`source: "offline-estimate"`) if the backend can't be reached — so the UI degrades gracefully instead of breaking.

## How the backend works

FastAPI (`backend/app.py`) loads the trained model and its reference tables once at startup (`backend/artifacts.py`) and exposes three endpoints:

- `GET /health` — liveness check
- `GET /api/model-metrics` / `GET /api/model-insights` — real, training-time-computed metrics, feature importances, correlation matrix, learning curve, and the cross-metro price index
- `POST /api/predict` — validates the request against realistic bounds (`backend/schemas.py`), builds the feature row, runs inference through the Random Forest, and returns the price, range, confidence, tier, and per-feature contribution factors (`backend/valuation.py`)

`backend/scripts/train_model.py` is the only place that touches raw data: it downloads the real King County home-sale dataset and Zillow's public metro price index, trains the model, and writes every artifact the API and frontend rely on. Nothing about pricing is hand-typed anywhere else in the codebase.

## How the frontend and backend communicate

In development, the frontend calls relative `/api/*` paths, which Vite's dev server proxies to the FastAPI backend (`frontend/vite.config.ts`) — no CORS setup or `VITE_API_BASE_URL` needed locally. In production, set `VITE_API_BASE_URL` to point the built frontend at a deployed backend, and set `CORS_ORIGINS` on the backend to allow that origin.

## Installation

### Prerequisites
- Node.js 18+
- Python 3.11+

### Setup
```bash
# Backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt

# Frontend (installs the root + frontend workspace together)
npm install

# Shared configuration
cp .env.example .env
```

### Train the model
```bash
npm run train:model
```
This downloads the real training data and Zillow metro index, trains the Random Forest, and writes all artifacts to `backend/assets/` and `frontend/public/data/`.

### Run the app
```bash
npm run dev:full   # starts the FastAPI backend and the Vite frontend together
```
or, in two terminals:
```bash
npm run dev:api
npm run dev
```

Then open:
- Frontend: http://localhost:8080
- Backend API: http://localhost:8000/health

If the backend isn't running, prediction requests fall back to a clearly-labeled offline estimate and log a console warning explaining why — if you see that in the UI, start `npm run dev:api` (or `npm run dev:full`).

### Other scripts
```bash
npm run build       # production frontend build (frontend/dist)
npm run lint         # eslint
npm test              # vitest
```

## Environment variables

The project uses a single dotenv file at the repo root, shared by both the frontend build and the backend. See `.env.example` for the full list with defaults — none are required for local dev:

- `VITE_API_BASE_URL` — only set to point the built frontend at a specific/deployed backend; leave unset locally to use the Vite dev proxy
- `API_PROXY_TARGET` — only needed if the backend runs on a non-default host/port
- `DATASET_URL`, `DATASET_PATH` — real King County home-sale CSV source (relative paths resolve under `backend/`)
- `METRO_INDEX_URL` — Zillow Research ZHVI-by-metro CSV source
- `OUTPUT_DIR`, `MODEL_FILE`, `METRICS_FILE`, `FEATURES_FILE` — model artifact locations (relative paths resolve under `backend/`)
- `PUBLIC_DIR` — where generated frontend-served JSON snapshots are written (relative paths resolve at the repo root; defaults to `frontend/public`)
- `CORS_ORIGINS` — allowed origins for the FastAPI backend

## Model details

- **Algorithm**: Random Forest Regressor (250 trees, max depth 18)
- **Training source**: real King County, WA home-sale records (~21.6k transactions, May 2014–May 2015) — every row is an actual sale, not a synthetic formula
- **Training approach**: 80/20 train/test split, real held-out evaluation

Current held-out test-set performance (regenerate with `npm run train:model` — numbers vary slightly run to run as the upstream dataset and Zillow index update):
- R²: ~0.84
- MAE: ~$80,600
- RMSE: ~$153,200
- MAPE: ~14.7%

### Dataset audit
Every input feature was checked against its realistic domain range (see `backend/scripts/train_model.py::drop_impossible_rows`). The one genuine data-quality issue found: a single sale (id `2402100895`) recorded with **33 bedrooms in 1,620 sqft** — about 49 sqft/bedroom, far below what's physically habitable, and almost certainly a typo for 3 bedrooms. That row is dropped before training. Everything else — including the next-highest outlier (11 bedrooms in 3,000 sqft, ~272 sqft/bedroom) and the small number of 0-bedroom/0-bathroom sales (studio-style or open-plan listings) — is unusual but physically plausible, so it's left untouched.

### Cross-metro adjustment
The training data only covers the Seattle metro area, so the model itself only ever predicts a King County-equivalent price. To support the other 11 cities in the UI, `train_model.py` downloads Zillow Research's public [Metro ZHVI dataset](https://www.zillow.com/research/data/) and computes, for each city, the ratio of that metro's current typical home value to Seattle's typical home value at the training data's own reference period. The backend multiplies the model's raw prediction by this real, dated, cited ratio (`metro_price_index.json`).

### Feature engineering
Built entirely from columns that exist in the real sale records, plus features derived from them without inventing any price relationship: `sqft_living`, `bedrooms`, `bathrooms`, `floors`, `waterfront`, `view`, `condition`, `grade`, `age` (sale year − year built), `was_renovated`, `zip_price_index` (each zip's mean sale price relative to the training set, fit on the training split only), and `property_type` (a rule-assigned label whose price effect the model learns from data).

At inference time, the app only collects sqft, bedrooms, bathrooms, age, city, and property type. The remaining features are filled from real, training-data-derived medians per property type (`property_type_defaults.json`).

### Explainability and confidence
- **Factor contributions**: the backend walks the actual decision path through all 250 trees and attributes the change in predicted value at each split to the feature that caused it (the same technique the `treeinterpreter` package uses).
- **Confidence and price range**: the backend predicts with each of the 250 individual trees and uses the empirical spread of those predictions (10th–90th percentile for the range, coefficient of variation for the confidence score).

### Market tier (Budget / Mid-Range / Luxury)
The tier score is this property's percentile rank against the real distribution of training-set sale prices, scaled by the same cross-metro ratio applied to the price itself (`price_percentiles.json`, built from `np.percentile(y_train, 0..100)`). Budget/Mid-Range/Luxury are the 33rd/67th percentile cutoffs of that real distribution — genuine tertiles of actual sales, not a fixed multiplier against a single reference figure. (An earlier version compared price to the metro's overall ZHVI average with fixed 0.7×/1.4× cutoffs; because that average blends in far smaller/older homes than a typical prediction, almost every realistic input landed in "Mid-Range" regardless of how the inputs changed. The percentile-based version fixes that — see git history for the pre-fix formula.)

## Input validation

Realistic bounds are enforced in two layers that are kept in sync:

| Field | Range |
| --- | --- |
| Square footage | 500 – 8,000 sq ft |
| Bedrooms | 0 – 10 |
| Bathrooms | 1 – 8 (whole numbers only) |
| Property age | 0 – 115 years |

- **Frontend** (`PredictionForm.tsx`): every numeric field shows its allowed range, blocks non-digit keystrokes (so a decimal point or minus sign can't be typed into a whole-number field at all), flags an out-of-range or non-integer value with an inline error message, and disables the submit button until every value is valid — so an unrealistic value can't be submitted from the UI.
- **Backend** (`schemas.py`): the same bounds are enforced with Pydantic `Field` constraints, so a direct API request outside those bounds is rejected with a `422` response and a clear message, independent of the frontend.

## Git readiness

Local environment files, Python artifacts, and `node_modules` are gitignored so secrets and generated files are never committed accidentally.
