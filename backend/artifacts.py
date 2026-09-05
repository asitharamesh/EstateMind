"""Loads the artifacts backend/scripts/train_model.py writes: the trained
model plus every real, data-derived reference table the API needs (metrics,
feature importances, correlation matrix, training curve, per-property-type
defaults, and the cited cross-metro price index). Nothing here is
hand-typed - if an artifact is missing, this fails loudly and tells you to
run the training script rather than falling back to a guess.
"""
import json
import os
import pickle
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "assets"))
OUTPUT_DIR_PATH = OUTPUT_DIR if OUTPUT_DIR.is_absolute() else BACKEND_DIR / OUTPUT_DIR

PROPERTY_TYPES = ["studio", "apartment", "house", "villa"]

FEATURE_LABELS = {
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


def _resolve_artifact_path(env_name: str, default: Path) -> Path:
    raw_value = os.getenv(env_name)
    if not raw_value:
        return default

    candidate = Path(raw_value)
    if candidate.is_absolute():
        return candidate
    if "/" in raw_value or "\\" in raw_value:
        return BACKEND_DIR / candidate
    return OUTPUT_DIR_PATH / candidate


MODEL_PATH = _resolve_artifact_path("MODEL_FILE", OUTPUT_DIR_PATH / "random_forest_model.pkl")
METRICS_PATH = _resolve_artifact_path("METRICS_FILE", OUTPUT_DIR_PATH / "model_metrics.json")
FEATURES_PATH = _resolve_artifact_path("FEATURES_FILE", OUTPUT_DIR_PATH / "feature_columns.json")
FEATURE_IMPORTANCE_PATH = OUTPUT_DIR_PATH / "feature_importance.json"
CORRELATION_PATH = OUTPUT_DIR_PATH / "correlation_matrix.json"
TRAINING_HISTORY_PATH = OUTPUT_DIR_PATH / "training_history.json"
PROPERTY_TYPE_DEFAULTS_PATH = OUTPUT_DIR_PATH / "property_type_defaults.json"
METRO_PRICE_INDEX_PATH = OUTPUT_DIR_PATH / "metro_price_index.json"
PRICE_PERCENTILES_PATH = OUTPUT_DIR_PATH / "price_percentiles.json"


def _load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Required artifact not found at {path}. Run `npm run train:model` first.")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_artifacts() -> dict[str, Any]:
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
        "price_percentiles": _load_json(PRICE_PERCENTILES_PATH),
    }
