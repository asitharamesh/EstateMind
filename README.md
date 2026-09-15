# EstateMind

EstateMind is a full-stack house-price estimator: a React + TypeScript frontend, a FastAPI backend, and
**region-specific Random Forest models** trained on recorded home sales. Each prediction comes with a calibrated
prediction interval, a market tier relative to that region's own sales, and a per-feature explanation.

**Model performance is region-specific and measured separately per region.** Today two regions have a validated
model, each trained and scored only on its own sales - there is no shared model and no cross-region multiplier:

> **Seattle / King County model (v2.0.0): R² = 0.858, MAE = $79,120** on 4,315 held-out 2014–15 King County sales.
> **Chicago / Cook County model (v2.0.0): R² = 0.798, MAE = $71,400** on ~8,600 held-out 2018–19 Cook County
> single-family sales. Both splits are grouped by property, so no house appears in both train and test, and both
> score through the same validation and feature pipeline the API uses for live requests.

Prices are in each dataset's own price basis - **nominal sale prices at the time of that dataset's sales, not
today's market** - and the two regions cover different years, so their prices are not comparable to each other.

Chicago's dataset has a construction-quality rating (used as its "grade" field, a 3-level scale specific to Cook
County's assessor) but no rated view field and no waterfront flag - unlike King County, whose dataset has all
three. The model, API and form for a region only ever use the fields that region's own dataset actually has; see
`backend/features.py::OPTIONAL_FIELDS`.

| Region | Status | Dataset | Test R² | Test MAE |
|---|---|---|---|---|
| Seattle / King County, WA | Validated | King County sales 2014-05 → 2015-05 | 0.858 | $79,120 |
| Chicago / Cook County, IL | Validated | Cook County single-family sales 2018-10 → 2019-12 | 0.798 | $71,400 |
| San Francisco Bay Area, CA | **Not validated** — no dataset | — | — | — |
| Los Angeles, CA | **Not validated** — no dataset | — | — | — |
| Austin, TX | **Not validated** — no dataset | — | — | — |
| New York City, NY | **Not validated** — no dataset | — | — | — |

Unvalidated regions are listed in the UI and API, but a prediction request for one returns
*"Prediction unavailable for this region — insufficient validated training data."* There are no cross-city price
multipliers.

The full design, the v1 postmortem, and every benchmark are in [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md).

---

## What changed in v2 (short version)

v1 reported R² 0.84, but that score used six features the app never collected. The live API filled them with defaults
and a constant zip signal, and through those real inputs the model scored **R² 0.48, MAE $169k**. v2:

- trains only on what the form collects: sqft, bedrooms, bathrooms, age, zip code, grade, view, waterfront;
- uses **one** feature builder (`backend/features.py`) for training, evaluation and inference;
- evaluates by pushing held-out rows through the real request contract, with a CI test that fails if that number
  regresses or stops matching what the UI reports;
- rejects unknown regions, zip codes, grades, views and fields with HTTP 422 instead of silently substituting values;
- removes the Zillow city multiplier, the rule-derived "property type" and the uncalibrated "confidence %";
- ranks tiers against the region's own sales in the same price basis (v1 put 99.95% of Seattle homes in "Luxury");
- replaces the 67%-coverage "10th–90th percentile" range with an interval calibrated to 80% (measured: 80.2%);
- shows the offline estimate **only** when the API is unreachable, never for validation or server errors;
- splits train/test by property id (v1 had 60 houses in both), and shrinks the model from 229 MB to 38 MB.

## Architecture

```text
backend/
  app.py              FastAPI routes, error → status mapping, startup model loading
  schemas.py          Strict request contract (pydantic, extra fields forbidden)
  regions.py          Region registry (which markets exist, which have data)
  datasets.py         Dataset provenance + SHA-256 pin, raw → canonical records
  features.py         The shared feature builder (FeatureSpec: validate, transform, serialise)
  pipeline.py         Admission gate shared by API, training and evaluation
  training.py         Grouped split, model fit, insights
  evaluation.py       Production-style evaluation + metrics
  uncertainty.py      OOB-calibrated prediction interval
  tiers.py            Region-relative percentile / tier
  valuation.py        Prediction response + tree-path attribution
  artifacts.py        Per-region artifact write/load
  catalog.py          Region catalog (API + offline snapshot)
  observability.py    JSON logging, request ids
  scripts/train_model.py      npm run train:model
  scripts/benchmark_model.py  npm run benchmark:model
  tests/              pytest: features, contract, tiers, interval, API, performance guard
frontend/src/
  lib/api.ts              fetch wrapper with error classification
  lib/regions.ts          region catalog types + loading
  lib/predictionSchema.ts zod schema generated from a region's input domain
  lib/predictionEngine.ts predict + offline baseline
  components/dashboard/   PredictionForm (React Hook Form), PredictionResultCard, CompareView, ModelInsights
  test/                   vitest: API errors, fallback rules, schema, form, result card
Dockerfile, docker-compose.yml, deploy/nginx.conf, .github/workflows/ci.yml
docs/SYSTEM_DESIGN.md, docs/benchmarks/seattle.json
```

Request flow: `PredictionForm` (zod) → `POST /api/predict` → `PredictionRequest` → region routing →
`FeatureSpec.validate_record` → `FeatureSpec.transform` → model → interval, tier, attribution → UI.

## Dataset (Seattle / King County)

- **Source:** "House Sales in King County, USA" (Kaggle), fetched from a GitHub mirror and verified against a pinned
  SHA-256 before training. Listed as CC0 on Kaggle; verify before commercial use.
- **Size:** 21,613 sales, 21 columns, no missing values; one physically impossible row removed (33 bedrooms in
  1,620 sqft).
- **Split:** grouped by property id: 17,291 train / 4,321 test sales, 176 repeat-sold properties, 0 shared across
  the split. 31 train and 6 test sales fall outside the accepted input domain and are excluded (counts reported).
- **Leakage finding:** the 60 shared houses in v1's random split did not inflate its score. Over 5 seeds random and
  grouped splits give R² 0.855 ± 0.008 vs 0.858 ± 0.004, and repeat sales are harder to predict, not easier.

## Dataset (Chicago / Cook County)

- **Source:** Cook County, IL Assessor's Office open data - single-family residential sales
  (`modeling_group='SF'`), fetched from `datacatalog.cookcountyil.gov` (no auth required). Published by Cook
  County government; verify current terms before commercial use.
- **ZIP codes are derived, not provided:** the source has no ZIP field, only a parcel centroid. This project's
  extract (`backend/assets/chicago_house_data.csv`, pinned by SHA-256) assigns each sale a ZIP via a
  point-in-polygon join against the Census Bureau's 2020 cartographic ZCTA5 boundaries.
- **Size:** 44,981 single-family sales (sale price > $10,000, 1–10 bedrooms, 500–8,000 sqft), 159 of 165 resolved
  ZIP codes have ≥ 20 sales.
- **No view or waterfront field exists in this dataset.** The model, API and form for this region simply don't use
  those fields - see `backend/features.py::OPTIONAL_FIELDS` and the "Optional fields" note below. Its "age" is the
  assessor's current effective age, not necessarily age at the historical sale date (the source has no year-built
  field), unlike King County's exact age-at-sale.

## Model

- `RandomForestRegressor(n_estimators=100, max_depth=18, min_samples_leaf=3)`, 38 MB, about 10 ms per prediction
  including attribution.
- **Chosen by** grouped 5-fold CV on the training split, not on the test set. Compared against 50/150/250 trees and
  min leaf 1/3/5, it is within 0.003 CV R² of the best configuration at a sixth of the size (table in the design doc).
- **Removed features** (`property_type`, `floors`, `condition`, `was_renovated`) each change CV R² by < 0.001.
- **Metrics (Seattle, 4,315 test sales):** R² 0.8584 · MAE $79,120 · RMSE $137,724 · MAPE 14.9%.
  Baseline (zip median $/sqft × sqft): R² 0.768 · MAE $102,452.
- **Metrics (Chicago, ~8,600 test sales):** R² 0.798 · MAE $71,400. Trained on 6 features instead of Seattle's 8
  (no view or waterfront - see above), and the market includes far more distressed/low-price sales, which is why
  its MAPE is higher than Seattle's despite a comparable MAE. Exact figures are in each region's model card
  (`GET /api/regions`), not repeated here to avoid drifting out of sync with retraining.
- **Prediction interval:** nominal 80%, calibrated on out-of-bag residuals; **measured coverage 80.2%** on test
  sales (Budget 78.8%, Mid-Range 82.7%, Luxury 78.9%). It is a population-level coverage, not a per-home guarantee.
- **Tier:** percentile of the predicted price among the region's training sales in the same price basis. Tertiles:
  Budget < $360k, Luxury ≥ $565k (2014–15 dollars). Test predictions split 31% / 36% / 33%.

## API

```http
POST /api/predict
{ "region": "seattle", "zipcode": "98103", "sqft": 1800, "bedrooms": 3, "bathrooms": 2,
  "ageYears": 40, "grade": 7, "view": 0, "waterfront": false }
```

Returns `price`, `priceBasis`, `pricePerSqft`, `zipMedianPricePerSqft`, `interval {low, high, nominalCoverage,
empiricalCoverage}`, `tier {label, percentile, budgetBelow, luxuryFrom}`, `factors[]` and `modelVersion`.

| Status | Meaning |
|---|---|
| 422 | invalid or unknown field value, unsupported zip/grade/view, unknown region, or a region with no validated model; `detail[].loc` names the field |
| 500 | unexpected server error (generic message; details only in server logs) |

Also: `GET /health`, `GET /api/regions` (status, model card and input domain per region),
`GET /api/regions/{region}/insights`.

### Validation (enforced by the API, mirrored in the form)

Bounds below are Seattle / King County's; every region has its own domain, returned per-region by
`GET /api/regions` (`inputDomain`) and used to build that region's form. `zipcode`, `sqft`, `bedrooms`, `bathrooms`
and `ageYears` are required for every region; `grade`, `view` and `waterfront` are each present only when that
region's own dataset has the field (Chicago has `grade` but not `view` or `waterfront` - see above).

| Field | Seattle / King County |
|---|---|
| zipcode | one of the 70 King County zips with ≥ 20 training sales |
| sqft | 500 – 8,000 |
| bedrooms | 0 – 10 (integer) |
| bathrooms | 1 – 8, whole numbers only (the King County training data itself is ~69% fractional-bathroom sales; `PredictionRequest` still accepts that quarter-bath precision internally so training/evaluation aren't affected, but `POST /api/predict` only accepts whole numbers - see `backend/schemas.py::LivePredictionRequest`) |
| ageYears | 0 – 115 (age at sale) |
| grade | 4 – 13, King County Assessor building grade (labelled in the form) |
| view | 0 – 4 (No rated view → Excellent) |
| waterfront | true / false |

## Error handling and the offline estimate

| Situation | UI |
|---|---|
| Invalid input (client or API 422) | fields highlighted, "Please correct the highlighted inputs." |
| Other 4xx | the API's message |
| 5xx | "The prediction service encountered an error. Please try again." |
| Network failure, timeout, or gateway 502/503/504 | "Offline estimate — live model unavailable." with a zip median $/sqft × sqft baseline (test R² 0.77), no tier, interval or explanation |

## Setup

Prerequisites: Node.js 18+ (20 in CI/Docker), Python 3.11+ (3.13 in CI/Docker).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
npm install
cp .env.example .env

npm run train:model     # download + verify dataset, train, evaluate, write artifacts (~10 s)
npm run dev:full        # API on :8000, web on :8080
```

Other commands:

```bash
npm run test:api          # backend tests (needs trained artifacts)
npm test                  # frontend tests
npm run typecheck && npm run lint && npm run build
npm run benchmark:model   # regenerate docs/benchmarks/seattle.json (several minutes)
docker compose up --build # trains inside the build; web :8080, API :8000
```

Environment variables are documented in `.env.example` (`DATASET_URL`, `DATASET_PATH`, `OUTPUT_DIR`, `PUBLIC_DIR`,
`CORS_ORIGINS`, `LOG_LEVEL`, `VITE_API_BASE_URL`, `API_PROXY_TARGET`).

## Infrastructure decisions

- **No database:** predictions are stateless and comparisons live in the browser. See the design doc.
- **Docker + CI:** a multi-stage build trains once and feeds both images. CI trains, runs backend tests
  (including the performance guard), frontend typecheck/lint/tests/build, and the Docker build.
- **Structured logs:** JSON lines with request ids. No auth or rate limiting, since there are no users or
  privileged operations; rate limiting belongs at the gateway.

## Known limitations

- Only two validated regions (Seattle/King County, Chicago/Cook County); the rest need legitimate, documented
  per-sale datasets with a real ZIP code, which is why they remain unavailable rather than guessed.
- Prices are each region's own historical sale prices (2014–15 for Seattle, 2018–19 for Chicago), with no
  validated adjustment to today's market and not comparable between the two regions.
- Chicago's construction-quality "grade" is a coarser, less granular rating than Seattle's, and Chicago has no
  view or waterfront signal at all - its model is weaker on location-driven price variation for that reason.
- The test split is random in time, so no forward-in-time performance is measured.
- The interval has a fixed relative width, and zip encoding is in-sample target encoding.
- Grade is the most important feature and must be supplied by the user.

Future work is listed in [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md#14-future-improvements).
