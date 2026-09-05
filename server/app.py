import json
import os
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

BASE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "assets"))
OUTPUT_DIR_PATH = OUTPUT_DIR if OUTPUT_DIR.is_absolute() else BASE_DIR / OUTPUT_DIR


def _resolve_artifact_path(env_name: str, default: Path) -> Path:
    raw_value = os.getenv(env_name)
    if not raw_value:
        return default

    candidate = Path(raw_value)
    if candidate.is_absolute():
        return candidate
    if "/" in raw_value or "\\" in raw_value:
        return BASE_DIR / candidate
    return OUTPUT_DIR_PATH / candidate


MODEL_PATH = _resolve_artifact_path("MODEL_FILE", OUTPUT_DIR_PATH / "random_forest_model.pkl")
METRICS_PATH = _resolve_artifact_path("METRICS_FILE", OUTPUT_DIR_PATH / "model_metrics.json")
FEATURES_PATH = _resolve_artifact_path("FEATURES_FILE", OUTPUT_DIR_PATH / "feature_columns.json")
FEATURE_IMPORTANCE_PATH = OUTPUT_DIR_PATH / "feature_importance.json"
CORRELATION_PATH = OUTPUT_DIR_PATH / "correlation_matrix.json"
TRAINING_HISTORY_PATH = OUTPUT_DIR_PATH / "training_history.json"
PROPERTY_TYPE_DEFAULTS_PATH = OUTPUT_DIR_PATH / "property_type_defaults.json"
METRO_PRICE_INDEX_PATH = OUTPUT_DIR_PATH / "metro_price_index.json"

app = FastAPI(title="EstateMind API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictionRequest(BaseModel):
    sqft: int
    bedrooms: int
    bathrooms: float
    city: str
    ageYears: int
    propertyType: str


def _load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Required artifact not found at {path}. Run `npm run train:model` first.")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _load_artifacts() -> dict[str, Any]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found at {MODEL_PATH}. Run `npm run train:model` first.")
    with MODEL_PATH.open("rb") as handle:
        model = pickle.load(handle)

    return {
        "model": model,
        "metrics": _load_json(METRICS_PATH),
        "feature_columns": _load_json(FEATURES_PATH),
        "feature_importance": _load_json(FEATURE_IMPORTANCE_PATH),
        "correlation_matrix": _load_json(CORRELATION_PATH),
        "training_history": _load_json(TRAINING_HISTORY_PATH),
        "property_type_defaults": _load_json(PROPERTY_TYPE_DEFAULTS_PATH),
        "metro_price_index": _load_json(METRO_PRICE_INDEX_PATH),
    }


ARTIFACTS = _load_artifacts()
MODEL = ARTIFACTS["model"]
MODEL_METRICS = ARTIFACTS["metrics"]
FEATURE_COLUMNS: list[str] = ARTIFACTS["feature_columns"]
PROPERTY_TYPES = ["studio", "apartment", "house", "villa"]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _resolve_metro(city: str) -> dict[str, Any]:
    key = city.lower().replace(" ", "-")
    metro = ARTIFACTS["metro_price_index"]["cities"].get(key)
    if metro is None:
        metro = ARTIFACTS["metro_price_index"]["cities"][ARTIFACTS["metro_price_index"]["trainingMetro"].split(",")[0].lower().replace(" ", "-")]
    return metro


def _build_feature_row(request: PredictionRequest) -> pd.DataFrame:
    sqft = _clamp(float(request.sqft), 500.0, 8000.0)
    bedrooms = int(_clamp(float(request.bedrooms), 0.0, 10.0))
    bathrooms = _clamp(float(request.bathrooms), 0.5, 8.0)
    age_years = int(_clamp(float(request.ageYears), 0.0, 115.0))

    property_type = request.propertyType.lower()
    if property_type not in PROPERTY_TYPES:
        property_type = "house"
    defaults = ARTIFACTS["property_type_defaults"][property_type]

    row = {
        "sqft_living": sqft,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "floors": defaults["floors"],
        "waterfront": defaults["waterfront"],
        "view": defaults["view"],
        "condition": defaults["condition"],
        "grade": defaults["grade"],
        "age": age_years,
        "was_renovated": defaults["wasRenovated"],
        # No address is collected, so we assume a typical location within the
        # chosen metro (index of 1.0 = average zip). Cross-metro differences
        # are handled separately via the real, cited Zillow ratio.
        "zip_price_index": 1.0,
        "property_type": PROPERTY_TYPES.index(property_type),
    }
    return pd.DataFrame([row])[FEATURE_COLUMNS]


def _tree_ensemble_predictions(features: pd.DataFrame) -> np.ndarray:
    return np.array([tree.predict(features)[0] for tree in MODEL.estimators_])


def _tree_interpreter_contributions(features: pd.DataFrame) -> tuple[float, np.ndarray]:
    """Real per-prediction feature attribution, decomposed from the actual
    decision paths taken through every tree in the forest (the same
    algorithm the `treeinterpreter` package uses). No hand-written weighting
    - the split points and leaf values come entirely from training."""
    x = features.to_numpy()
    n_features = x.shape[1]
    contributions = np.zeros(n_features)
    bias_total = 0.0

    for estimator in MODEL.estimators_:
        tree = estimator.tree_
        node_indicator = estimator.decision_path(x)
        node_index = node_indicator.indices[node_indicator.indptr[0]: node_indicator.indptr[1]]
        values = tree.value[:, 0, 0]

        bias_total += values[node_index[0]]
        for i in range(1, len(node_index)):
            parent = node_index[i - 1]
            feature_idx = tree.feature[parent]
            contributions[feature_idx] += values[node_index[i]] - values[parent]

    n = len(MODEL.estimators_)
    return bias_total / n, contributions / n


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/api/model-metrics")
def model_metrics() -> dict[str, Any]:
    return MODEL_METRICS


@app.get("/api/model-insights")
def model_insights() -> dict[str, Any]:
    return {
        "featureImportance": ARTIFACTS["feature_importance"],
        "correlationMatrix": ARTIFACTS["correlation_matrix"],
        "trainingHistory": ARTIFACTS["training_history"],
        "metroPriceIndex": ARTIFACTS["metro_price_index"],
        "modelMetrics": MODEL_METRICS,
    }


@app.post("/api/predict", response_model=dict[str, Any])
def predict(request: PredictionRequest) -> dict[str, Any]:
    try:
        features = _build_feature_row(request)
        training_metro_price = float(MODEL.predict(features)[0])
        tree_preds = _tree_ensemble_predictions(features)
        bias, contributions = _tree_interpreter_contributions(features)
    except Exception as exc:  # pragma: no cover - defensive path
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    metro = _resolve_metro(request.city)
    scale = metro["scaleVsTrainingMetro"]

    price = int(round(training_metro_price * scale))
    sqft = _clamp(float(request.sqft), 500.0, 8000.0)
    price_per_sqft = max(1, int(round(price / sqft)))
    market_avg_per_sqft = int(round((metro["zhviLatest"] / MODEL_METRICS["trainingMedianSqft"])))

    # Real, empirical prediction interval: the spread of the 250 individual
    # trees' predictions for this exact input, not a fabricated formula.
    low_raw, high_raw = np.percentile(tree_preds, [10, 90])
    range_low = int(round(low_raw * scale))
    range_high = int(round(high_raw * scale))
    spread_ratio = (tree_preds.std() / max(tree_preds.mean(), 1.0))
    confidence = round(_clamp(100 * (1 - spread_ratio), 45.0, 97.0), 1)

    metro_reference_price = metro["zhviLatest"]
    ratio_to_metro = price / metro_reference_price
    tier_score = round(_clamp(ratio_to_metro * 50, 0.0, 100.0), 1)
    tier = "Budget" if ratio_to_metro < 0.7 else "Luxury" if ratio_to_metro >= 1.4 else "Mid-Range"

    label_lookup = {
        "sqft_living": "Square Footage",
        "bedrooms": "Bedrooms",
        "bathrooms": "Bathrooms",
        "floors": "Floors",
        "waterfront": "Waterfront",
        "view": "View Quality",
        "condition": "Condition",
        "grade": "Construction Grade",
        "age": "Property Age",
        "was_renovated": "Renovated",
        "zip_price_index": "Location (within metro)",
        "property_type": "Property Type",
    }

    factor_rows = []
    scaled_contributions = contributions * scale
    total_abs = float(np.sum(np.abs(scaled_contributions))) or 1.0
    for col, contribution in zip(FEATURE_COLUMNS, scaled_contributions):
        factor_rows.append({
            "feature": col,
            "label": label_lookup.get(col, col),
            "contribution": round(float(contribution), 2),
            "share": round(float(abs(contribution) / total_abs), 4),
        })
    factor_rows.sort(key=lambda row: abs(row["contribution"]), reverse=True)

    return {
        "price": price,
        "trainingMetroPrice": int(round(training_metro_price)),
        "pricePerSqft": price_per_sqft,
        "marketAvgPerSqft": market_avg_per_sqft,
        "tier": tier,
        "tierScore": tier_score,
        "confidence": confidence,
        "factors": factor_rows[:6],
        "range": {"low": range_low, "high": range_high},
        "metro": {
            "city": request.city,
            "metro": metro["metro"],
            "scaleVsTrainingMetro": scale,
            "source": ARTIFACTS["metro_price_index"]["source"],
            "asOf": ARTIFACTS["metro_price_index"]["latestDate"],
        },
        "modelMetrics": MODEL_METRICS,
    }
