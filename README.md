# 🏠 EstateMind

EstateMind is a full-stack real-estate valuation application that combines a React + TypeScript frontend, a FastAPI backend, and a trained Random Forest Regressor to deliver explainable property price predictions. The project was built to look and feel like a realistic, interview-ready AI product rather than a static demo.

## Why this project stands out
- End-to-end machine learning workflow: data ingestion, feature engineering, training, evaluation, and inference
- Explainable predictions: users see market tier, value comparison, confidence, and price drivers
- Real backend integration: the UI consumes live prediction results from a Python API
- Local-first architecture: no cloud dependency required for core prediction workflows

## Architecture

```text
User input (React + Vite UI)
        ↓
   PredictionForm / Dashboard
        ↓
   FastAPI backend (server/app.py)
        ↓
Feature engineering + inference
        ↓
Trained Random Forest model artifacts
        ↓
Live results: price, range, tier, factors, metrics
```

### Tech stack
- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts
- Backend: Python, FastAPI, Pydantic, Uvicorn
- Machine learning: scikit-learn, RandomForestRegressor, pandas, numpy
- Configuration: dotenv-based environment variables
- Testing: Vitest

## Prediction flow
1. The user enters property features such as square footage, bedrooms, city, age, and property type.
2. The frontend normalizes and clamps values to keep the input range realistic.
3. A POST request is sent to the FastAPI prediction endpoint.
4. The backend builds the feature vector, runs inference through the trained model, and returns:
   - predicted price
   - price range
   - market tier
   - price-per-square-foot comparison
   - explanation factors such as location, size, bedrooms, age, and property type
5. The UI updates the market-tier gauge, value analysis chart, and influence radar in real time.

## Model details
- Algorithm: Random Forest Regressor (250 trees, max depth 18)
- Training source: real King County, WA home-sale records (~21.6k transactions, May 2014-May 2015) - every row is an actual sale, not a synthetic formula
- Training approach: 80/20 train/test split, real held-out evaluation
- Model artifacts (written by `scripts/train_model.py`, all gitignored, regenerate with `npm run train:model`):
  - `random_forest_model.pkl`
  - `model_metrics.json`, `feature_importance.json`, `correlation_matrix.json`, `training_history.json`
  - `feature_columns.json`, `property_type_defaults.json`, `zip_price_index.json`, `metro_price_index.json`
- All of the above are computed from real data at train time and served from the backend at runtime - nothing here is hard-coded in the React app.

### Current model performance
The current trained model achieves the following results on the real held-out test set (regenerate with `npm run train:model` - numbers will vary slightly run to run because the upstream dataset and Zillow index can update):
- R²: ~0.84
- MAE: ~$80,600
- RMSE: ~$156,800
- MAPE: ~14.5%

These are honest numbers for a home-price model trained on ~12 real features - a ~94% R² / 1.5% MAPE claim (as an earlier version of this README stated) is not achievable on real transaction data with this feature set, and was a symptom of training on a self-generated formula instead of real prices.

### Beyond King County: the cross-metro adjustment
The training data only covers the Seattle metro area, so the model itself only ever predicts a King County-equivalent price. To support the other 11 cities in the UI, `scripts/train_model.py` also downloads Zillow Research's public [Metro ZHVI dataset](https://www.zillow.com/research/data/) and computes, for each city, the ratio of that metro's current typical home value to Seattle's typical home value at the training data's own reference period (Oct 2014). The backend multiplies the model's raw prediction by this real, dated, cited ratio (`metro_price_index.json`) - it is never a hand-typed multiplier.

## Feature engineering
`scripts/train_model.py` builds its feature set entirely from columns that exist in the real sale records, plus a small number of features derived from them without inventing any price relationship:
- `sqft_living`, `bedrooms`, `bathrooms`, `floors`, `waterfront`, `view`, `condition`, `grade` - real columns from the dataset
- `age` - sale year minus `yr_built` (real, computed per sale)
- `was_renovated` - real, from `yr_renovated`
- `zip_price_index` - each zip code's mean sale price relative to the training set's overall mean, fit on the training split only (no leakage into the held-out test set)
- `property_type` - a studio/apartment/house/villa label assigned to each real sale by a documented rule over `sqft_living`, `floors`, `grade`, `bedrooms`, and `waterfront`; the model learns each bucket's actual price effect from data, the rule only assigns the label

At inference time, the app only collects sqft, bedrooms, bathrooms, age, city, and property type - it doesn't ask for condition, grade, floors, etc. Those are filled from the real, training-data-derived medians for the selected property type (`property_type_defaults.json`), and `zip_price_index` defaults to 1.0 (an average location within the chosen metro) since no address is collected.

Random Forest was chosen because these features have non-linear effects and interactions (e.g. construction grade matters far more at high square footage) that tree ensembles capture well without manual feature crossing.

## Explainability and confidence
Both the per-prediction "why" and the uncertainty range are derived from the trained ensemble itself, not separate formulas:
- **Factor contributions**: for each prediction, the backend walks the actual decision path taken through all 250 trees and attributes the change in predicted value at each split to the feature that caused it (the same technique the `treeinterpreter` package uses). The returned `factors` are real, signed dollar contributions for that specific input.
- **Confidence and price range**: the backend predicts with each of the 250 individual trees and uses the empirical spread of those 250 predictions (10th-90th percentile for the range, coefficient of variation for the confidence score) - a home whose inputs are rare in the training data (e.g. an unusual property type) genuinely gets a wider range and lower confidence, because the trees genuinely disagree more.

## Setup
### Prerequisites
- Node.js 18+
- Python 3.11+
- A local virtual environment is recommended

### Installation
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install pandas numpy scikit-learn python-dotenv fastapi uvicorn
npm install
cp .env.example .env
```

### Train the model
```bash
npm run train:model
```

### Run the app
```bash
npm run dev:api
npm run dev
```

Then open:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/health

## Environment variables
The project uses a dotenv-based configuration file. See `.env.example` for the full list with defaults:
- `VITE_API_BASE_URL` - frontend's base URL for the FastAPI backend
- `DATASET_URL`, `DATASET_PATH` - real King County home-sale CSV source
- `METRO_INDEX_URL` - Zillow Research ZHVI-by-metro CSV source
- `OUTPUT_DIR`, `MODEL_FILE`, `METRICS_FILE`, `FEATURES_FILE` - artifact locations
- `CORS_ORIGINS` - allowed origins for the FastAPI backend

## Project structure
```text
server/              # FastAPI backend and prediction endpoint
scripts/             # Training pipeline and artifact generation
src/                 # React + TypeScript frontend
assets/              # Model artifacts and downloaded dataset
public/              # Static files and exported metrics
```

## Verification
Run the following checks locally:
```bash
npm run build
npm test
```

## Why this is interview-friendly
This project demonstrates several interview-relevant skills:
- building a real machine-learning workflow instead of relying on mock data
- integrating a Python model into a modern React frontend
- creating explainable AI outputs for end users
- using environment-based configuration and clean project structure
- presenting a working full-stack portfolio project with clear business value

## Git readiness
The repository is set up to be safe for Git pushes. Local environment files and Python artifacts are ignored so secrets and temporary development files are not committed accidentally.