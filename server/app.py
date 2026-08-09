import json
import os
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
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

app = FastAPI(title="EstateMind API", version="1.0.0")


class PredictionRequest(BaseModel):
    sqft: int
    bedrooms: int
    city: str
    ageYears: int
    propertyType: str


class PredictionResponse(dict):
    pass


def _load_artifacts() -> tuple[Any, dict[str, Any], list[str]]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")
    if not METRICS_PATH.exists():
        raise FileNotFoundError(f"Metrics file not found at {METRICS_PATH}")
    if not FEATURES_PATH.exists():
        raise FileNotFoundError(f"Features file not found at {FEATURES_PATH}")

    with MODEL_PATH.open("rb") as handle:
        model = pickle.load(handle)
    with METRICS_PATH.open("r", encoding="utf-8") as handle:
        metrics = json.load(handle)
    with FEATURES_PATH.open("r", encoding="utf-8") as handle:
        feature_columns = json.load(handle)
    return model, metrics, feature_columns


MODEL, MODEL_METRICS, FEATURE_COLUMNS = _load_artifacts()


CITY_MULTIPLIERS = {
    "san-francisco": 1.55,
    "new-york": 1.47,
    "los-angeles": 1.33,
    "seattle": 1.24,
    "boston": 1.2,
    "miami": 1.08,
    "austin": 1.0,
    "chicago": 0.95,
    "denver": 1.02,
    "atlanta": 0.9,
    "dallas": 0.91,
    "phoenix": 0.88,
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _build_features(request: PredictionRequest) -> pd.DataFrame:
    sqft = _clamp(float(request.sqft), 500.0, 6000.0)
    bedrooms = int(_clamp(float(request.bedrooms), 1.0, 6.0))
    age_years = int(_clamp(float(request.ageYears), 0.0, 80.0))

    city_key = request.city.lower().replace(" ", "-")
    city_val = CITY_MULTIPLIERS.get(city_key, 1.0)
    property_type = {"studio": 0, "apartment": 1, "house": 2, "villa": 3}.get(request.propertyType.lower(), 1)

    lot_size = max(1200, int(round(sqft * 0.85 + bedrooms * 900)))
    school_rating = _clamp(3.5 + city_val * 1.2 + bedrooms * 0.25, 3.0, 10.0)
    crime_index = _clamp(4.2 + city_val * 0.8 + age_years * 0.02, 1.0, 10.0)

    frame = pd.DataFrame(
        [{
            "sqft": int(sqft),
            "beds": int(bedrooms),
            "age": int(age_years),
            "city_val": float(city_val),
            "property_type": int(property_type),
            "lot_size": int(lot_size),
            "school_rating": float(school_rating),
            "crime_index": float(crime_index),
        }]
    )
    return frame[FEATURE_COLUMNS]


def _tier_for_price(price: float) -> str:
    if price < 450000:
        return "Budget"
    if price < 850000:
        return "Mid-Range"
    return "Luxury"


def _build_factor_breakdown(request: PredictionRequest) -> dict[str, int]:
    sqft = _clamp(float(request.sqft), 500.0, 6000.0)
    bedrooms = int(_clamp(float(request.bedrooms), 1.0, 6.0))
    age_years = int(_clamp(float(request.ageYears), 0.0, 80.0))
    city_key = request.city.lower().replace(" ", "-")
    city_val = CITY_MULTIPLIERS.get(city_key, 1.0)
    property_type = {"studio": 0, "apartment": 1, "house": 2, "villa": 3}.get(request.propertyType.lower(), 1)

    location_score = int(round(_clamp(18 + city_val * 10 + (2 if city_val >= 1.2 else 0), 12, 36)))
    size_score = int(round(_clamp(16 + (sqft / 6000.0) * 22 + bedrooms * 0.8, 10, 35)))
    bedroom_score = int(round(_clamp(10 + bedrooms * 3.5, 8, 28)))
    age_score = int(round(_clamp(12 + max(0, 35 - age_years) * 0.45, 8, 30)))
    type_score = int(round(_clamp(10 + property_type * 5, 8, 24)))

    scores = {
        "location": location_score,
        "size": size_score,
        "bedrooms": bedroom_score,
        "age": age_score,
        "type": type_score,
    }
    total = sum(scores.values())
    normalized = {name: int(round(value * 100 / total)) for name, value in scores.items()}
    diff = 100 - sum(normalized.values())
    normalized["location"] += diff
    return normalized


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/api/model-metrics")
def model_metrics() -> dict[str, Any]:
    return MODEL_METRICS


@app.post("/api/predict", response_model=dict[str, Any])
def predict(request: PredictionRequest) -> dict[str, Any]:
    try:
        features = _build_features(request)
        prediction = float(MODEL.predict(features)[0])
    except Exception as exc:  # pragma: no cover - defensive path
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    price = int(round(prediction))
    price_per_sqft = max(120, int(round(price / max(_clamp(float(request.sqft), 500.0, 6000.0), 1))))
    market_avg_per_sqft = int(round(price_per_sqft * 1.14))
    tier_score = _clamp(min(100.0, max(0.0, (price / 100000.0) * 14.5)), 0.0, 100.0)
    tier = _tier_for_price(price)
    confidence = _clamp(93.5 - max(0, int(_clamp(float(request.ageYears), 0.0, 80.0)) - 35) * 0.2 - max(0, int(_clamp(float(request.sqft), 500.0, 6000.0)) - 5000) * 0.001, 70.0, 97.0)
    spread = (1 - confidence / 100) * 1.25
    low = int(round(price * (1 - spread)))
    high = int(round(price * (1 + spread)))

    return {
        "price": price,
        "pricePerSqft": price_per_sqft,
        "marketAvgPerSqft": market_avg_per_sqft,
        "tier": tier,
        "tierScore": round(tier_score, 1),
        "confidence": round(confidence, 1),
        "factors": _build_factor_breakdown(request),
        "range": {"low": low, "high": high},
        "modelMetrics": MODEL_METRICS,
    }
