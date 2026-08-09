import json
import os
import pickle
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[1]
DATASET_URL = os.getenv("DATASET_URL", "https://raw.githubusercontent.com/ageron/handson-ml/master/datasets/housing/housing.csv")
DATASET_PATH = Path(os.getenv("DATASET_PATH", BASE_DIR / "assets" / "housing.csv"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", BASE_DIR / "assets"))
MODEL_PATH = OUTPUT_DIR / os.getenv("MODEL_FILE", "random_forest_model.pkl")
METRICS_PATH = OUTPUT_DIR / os.getenv("METRICS_FILE", "model_metrics.json")
FEATURES_PATH = OUTPUT_DIR / os.getenv("FEATURES_FILE", "feature_columns.json")
PUBLIC_METRICS_PATH = Path(os.getenv("PUBLIC_METRICS_FILE", BASE_DIR / "public" / "model-metrics.json"))

FEATURE_COLUMNS = ["sqft", "beds", "age", "city_val", "property_type", "lot_size", "school_rating", "crime_index"]


def ensure_dataset() -> Path:
    DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DATASET_PATH.exists():
        return DATASET_PATH

    print(f"Downloading dataset from {DATASET_URL}")
    urllib.request.urlretrieve(DATASET_URL, DATASET_PATH)
    return DATASET_PATH


def build_training_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df[["median_income", "total_rooms", "total_bedrooms", "population", "households", "ocean_proximity"]].copy()
    df = df.dropna().reset_index(drop=True)

    proximity_map = {
        "<1H OCEAN": 1.25,
        "INLAND": 0.95,
        "ISLAND": 1.55,
        "NEAR BAY": 1.4,
        "NEAR OCEAN": 1.2,
    }
    df["proximity_score"] = df["ocean_proximity"].map(proximity_map).fillna(1.0)

    rng = np.random.default_rng(42)
    df["sqft"] = np.clip(
        np.round(df["total_rooms"] * 18 + df["median_income"] * 320 + rng.uniform(140, 420, len(df))).astype(int),
        500,
        8500,
    )
    df["beds"] = np.clip(
        np.round((df["total_bedrooms"] / np.maximum(df["households"], 1)) * 1.6).astype(int),
        1,
        6,
    )
    df["age"] = np.clip(np.round(rng.uniform(5, 45, len(df))).astype(int), 1, 50)
    df["city_val"] = np.clip(
        (df["median_income"] * 0.75 + df["proximity_score"] * 0.35 + rng.uniform(-0.08, 0.08, len(df))),
        0.8,
        2.4,
    )
    df["property_type"] = np.select(
        [df["median_income"] < 2.0, df["median_income"] < 4.0, df["median_income"] < 6.0],
        [0, 1, 2],
        default=3,
    ).astype(int)
    df["lot_size"] = np.clip(
        np.round(df["population"] * 2.4 + df["households"] * 3.2 + df["median_income"] * 420).astype(int),
        1200,
        14000,
    )
    df["school_rating"] = np.clip(
        np.round(3.3 + df["median_income"] * 0.6 + df["proximity_score"] * 0.5 + rng.uniform(0, 0.7, len(df))),
        3.0,
        10.0,
    )
    df["crime_index"] = np.clip(
        np.round(7.4 - df["median_income"] * 0.35 + rng.uniform(0, 1.25, len(df))),
        1.0,
        10.0,
    )
    base_price = (
        df["sqft"] * 165
        + df["beds"] * 10800
        + df["age"] * 820
        + df["city_val"] * 24500
        + df["lot_size"] * 7.5
        + df["school_rating"] * 4800
        - df["crime_index"] * 3200
        + df["property_type"] * 9000
        + np.maximum(df["sqft"] - 2600, 0) * 4.8
        - np.maximum(df["age"] - 25, 0) * 720
    )
    hidden_neighborhood_effect = df["proximity_score"] * 14500 + rng.normal(0, 18000, len(df))
    market_shift = rng.normal(0, 22000, len(df))
    df["price"] = np.round(base_price + hidden_neighborhood_effect + market_shift).astype(int)
    df["price"] = np.clip(df["price"], 180000, 2200000)
    return df


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    dataset_path = ensure_dataset()
    df = pd.read_csv(dataset_path)
    training_frame = build_training_frame(df)

    X = training_frame[FEATURE_COLUMNS]
    y = training_frame["price"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = RandomForestRegressor(n_estimators=250, max_depth=18, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    metrics = {
        "rSquared": float(r2_score(y_test, predictions)),
        "mae": float(mean_absolute_error(y_test, predictions)),
        "rmse": float(mean_squared_error(y_test, predictions) ** 0.5),
        "mape": float(np.mean(np.abs((y_test - predictions) / y_test)) * 100),
        "trainingSamples": int(len(X_train)),
        "testSamples": int(len(X_test)),
        "features": int(X.shape[1]),
        "algorithm": "Random Forest Regressor",
    }

    with MODEL_PATH.open("wb") as handle:
        pickle.dump(model, handle)

    with METRICS_PATH.open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2)

    with FEATURES_PATH.open("w", encoding="utf-8") as handle:
        json.dump(FEATURE_COLUMNS, handle, indent=2)

    PUBLIC_METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
