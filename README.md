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
- Algorithm: Random Forest Regressor
- Training source: public housing dataset from the Hands-On Machine Learning repository
- Training approach: 80/20 train/test split
- Model artifacts:
  - random_forest_model.pkl
  - model_metrics.json
  - feature_columns.json
- Metrics are generated during training and served from the backend at runtime rather than being hard-coded in the React app.

### Current model performance
The current trained model achieved the following results on the held-out test set:
- R²: 0.9424
- MAE: 23,962.97
- RMSE: 29,916.87
- MAPE: 1.53%

These values are more realistic than a perfect or synthetic benchmark and are appropriate for presenting as a practical ML demo.

## Feature engineering
The training pipeline in scripts/train_model.py creates a richer feature set from the public housing data by deriving variables such as:
- square footage
- bedroom count
- property age
- city valuation
- property type encoding
- lot size
- school rating
- crime index
- proximity-based scoring from ocean proximity

The model also uses a mix of engineered signals and non-linear interactions that tree-based models can capture well, which is why Random Forest was chosen for this use case.

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
The project uses a dotenv-based configuration file. The default values are defined in .env.example:
- DATASET_URL
- DATASET_PATH
- OUTPUT_DIR
- MODEL_FILE
- METRICS_FILE
- FEATURES_FILE
- PUBLIC_METRICS_FILE

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