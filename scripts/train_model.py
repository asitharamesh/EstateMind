"""Train EstateMind's price model on real, per-property home-sale records.

Data sources (both fetched fresh at train time, never hand-typed into code):
  1. King County, WA home sales (~21.6k real transactions, May 2014-May 2015),
     mirrored from the well-known Kaggle "House Sales in King County, USA"
     dataset. Every training feature and the target price come directly from
     this real dataset - none of it is a hand-written pricing formula.
  2. Zillow Home Value Index (ZHVI) by metro, from Zillow's public research
     data (files.zillowstatic.com). This gives real, dated home-price levels
     for the other cities the product supports, used only as a ratio to
     rescale the King County-trained prediction to another metro's price
     level - see build_metro_price_index().

Because the training data only covers one metro (King County / Seattle), the
model itself only ever predicts a King County-equivalent price. Cross-metro
adjustment is a separate, clearly-labelled multiplier derived from public
statistics, not part of the learned model.
"""
import csv
import io
import json
import os
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

DATASET_URL = os.getenv(
    "DATASET_URL",
    "https://raw.githubusercontent.com/karan-shah/usa-housing-dataset/master/kc_house_data.csv",
)
DATASET_PATH = Path(os.getenv("DATASET_PATH", BASE_DIR / "assets" / "kc_house_data.csv"))
METRO_INDEX_URL = os.getenv(
    "METRO_INDEX_URL",
    "https://files.zillowstatic.com/research/public_csvs/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
)

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", BASE_DIR / "assets"))
MODEL_PATH = OUTPUT_DIR / os.getenv("MODEL_FILE", "random_forest_model.pkl")
METRICS_PATH = OUTPUT_DIR / os.getenv("METRICS_FILE", "model_metrics.json")
FEATURES_PATH = OUTPUT_DIR / os.getenv("FEATURES_FILE", "feature_columns.json")
FEATURE_IMPORTANCE_PATH = OUTPUT_DIR / "feature_importance.json"
CORRELATION_PATH = OUTPUT_DIR / "correlation_matrix.json"
TRAINING_HISTORY_PATH = OUTPUT_DIR / "training_history.json"
PROPERTY_TYPE_DEFAULTS_PATH = OUTPUT_DIR / "property_type_defaults.json"
ZIP_PRICE_INDEX_PATH = OUTPUT_DIR / "zip_price_index.json"
METRO_PRICE_INDEX_PATH = OUTPUT_DIR / "metro_price_index.json"

PUBLIC_DIR = Path(os.getenv("PUBLIC_DIR", BASE_DIR / "public"))

# City keys the product exposes, mapped to the exact metro names used in
# Zillow's ZHVI file. Seattle is the reference metro because that's what the
# training data actually covers.
METRO_NAME_BY_CITY = {
    "seattle": "Seattle, WA",
    "new-york": "New York, NY",
    "los-angeles": "Los Angeles, CA",
    "san-francisco": "San Francisco, CA",
    "boston": "Boston, MA",
    "miami": "Miami, FL",
    "austin": "Austin, TX",
    "chicago": "Chicago, IL",
    "denver": "Denver, CO",
    "atlanta": "Atlanta, GA",
    "dallas": "Dallas, TX",
    "phoenix": "Phoenix, AZ",
}

FEATURE_COLUMNS = [
    "sqft_living",
    "bedrooms",
    "bathrooms",
    "floors",
    "waterfront",
    "view",
    "condition",
    "grade",
    "age",
    "was_renovated",
    "zip_price_index",
    "property_type",
]

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

PROPERTY_TYPES = ["studio", "apartment", "house", "villa"]


def ensure_dataset() -> Path:
    DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not DATASET_PATH.exists():
        print(f"Downloading real King County home-sales dataset from {DATASET_URL}")
        urllib.request.urlretrieve(DATASET_URL, DATASET_PATH)
    return DATASET_PATH


def classify_property_type(sqft_living: float, floors: float, grade: int, bedrooms: int, waterfront: int) -> str:
    """Bucket a real sale into a property-type label from its real attributes.

    This only assigns a category based on observed characteristics - it does
    not encode any price relationship. The model learns the price effect of
    each bucket itself from the real training data.
    """
    if waterfront == 1 or grade >= 11:
        return "villa"
    if bedrooms <= 1 and sqft_living < 750:
        return "studio"
    if floors <= 1.0 and sqft_living < 1600:
        return "apartment"
    return "house"


def build_training_frame(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.dropna(subset=[
        "price", "bedrooms", "bathrooms", "sqft_living", "floors", "waterfront",
        "view", "condition", "grade", "yr_built", "yr_renovated", "zipcode", "date",
    ]).copy()

    sale_date = pd.to_datetime(df["date"], format="%Y%m%dT%H%M%S")
    df["age"] = (sale_date.dt.year - df["yr_built"]).clip(lower=0)
    df["was_renovated"] = (df["yr_renovated"] > 0).astype(int)
    df["property_type"] = [
        classify_property_type(sqft, floors, grade, beds, waterfront)
        for sqft, floors, grade, beds, waterfront in zip(
            df["sqft_living"], df["floors"], df["grade"], df["bedrooms"], df["waterfront"]
        )
    ]
    df["property_type"] = df["property_type"].map({name: i for i, name in enumerate(PROPERTY_TYPES)})
    df["zipcode"] = df["zipcode"].astype(int)
    return df


def fit_zip_price_index(train_df: pd.DataFrame) -> dict[str, float]:
    """Real, data-derived location signal: each zip's mean sale price versus
    the training-set overall mean. Fit on the training split only, so the
    held-out test set (and later, live inference) look up a value learned
    purely from training data - no leakage, no invented numbers."""
    overall_mean = train_df["price"].mean()
    zip_means = train_df.groupby("zipcode")["price"].mean()
    return (zip_means / overall_mean).to_dict()


def apply_zip_price_index(df: pd.DataFrame, index: dict[str, float]) -> pd.Series:
    return df["zipcode"].map(index).fillna(1.0)


def compute_training_history(X_train: pd.DataFrame, y_train: pd.Series, step: int = 10, max_estimators: int = 250) -> list[dict]:
    """Real learning curve: grow the forest incrementally and record actual
    training R^2 and actual out-of-bag R^2 at each size - not a fabricated
    curve. OOB score is scored on samples each tree never saw, so it is a
    genuine (if slightly optimistic vs. a fresh test set) generalization
    estimate."""
    history = []
    model = RandomForestRegressor(
        n_estimators=step,
        max_depth=18,
        random_state=42,
        n_jobs=-1,
        warm_start=True,
        oob_score=True,
        bootstrap=True,
    )
    for n in range(step, max_estimators + 1, step):
        model.set_params(n_estimators=n)
        model.fit(X_train, y_train)
        train_r2 = float(r2_score(y_train, model.predict(X_train)))
        history.append({
            "estimators": n,
            "trainR2": round(train_r2, 4),
            "oobR2": round(float(model.oob_score_), 4),
        })
    return history


def build_metro_price_index(reference_date: pd.Timestamp) -> dict:
    """Fetch Zillow's public ZHVI-by-metro CSV and derive a real, cited
    cross-metro price ratio for each supported city, relative to Seattle at
    the training data's own time period. This is the only place city-level
    pricing differences enter the app, and every number traces back to a
    dated public statistic instead of a guessed multiplier."""
    print(f"Downloading Zillow ZHVI metro index from {METRO_INDEX_URL}")
    with urllib.request.urlopen(METRO_INDEX_URL) as response:
        raw_csv = response.read().decode("utf-8")

    reader = csv.DictReader(io.StringIO(raw_csv))
    fieldnames = reader.fieldnames or []
    date_columns = [c for c in fieldnames if c[:4].isdigit() and len(c) == 10]
    latest_col = date_columns[-1]
    ref_col = min(date_columns, key=lambda c: abs((pd.Timestamp(c) - reference_date).days))

    by_metro: dict[str, dict[str, float]] = {}
    for row in reader:
        if row.get("RegionType") != "msa":
            continue
        name = row.get("RegionName")
        if name in METRO_NAME_BY_CITY.values():
            latest_raw = row.get(latest_col)
            ref_raw = row.get(ref_col)
            if latest_raw and ref_raw:
                by_metro[name] = {"latest": float(latest_raw), "reference": float(ref_raw)}

    seattle_ref = by_metro[METRO_NAME_BY_CITY["seattle"]]["reference"]

    cities = {}
    for city_key, metro_name in METRO_NAME_BY_CITY.items():
        stats = by_metro.get(metro_name)
        if not stats:
            continue
        cities[city_key] = {
            "metro": metro_name,
            "zhviLatest": round(stats["latest"], 2),
            "scaleVsTrainingMetro": round(stats["latest"] / seattle_ref, 4),
        }

    return {
        "source": "Zillow Research, Metro ZHVI (All Homes, Mid-Tier, Smoothed, Seasonally Adjusted)",
        "sourceUrl": METRO_INDEX_URL,
        "trainingMetro": METRO_NAME_BY_CITY["seattle"],
        "trainingReferenceDate": ref_col,
        "latestDate": latest_col,
        "cities": cities,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    dataset_path = ensure_dataset()
    raw = pd.read_csv(dataset_path)
    df = build_training_frame(raw)

    X_train_full, X_test_full, y_train, y_test = train_test_split(
        df, df["price"], test_size=0.2, random_state=42
    )

    zip_index = fit_zip_price_index(X_train_full)
    X_train_full = X_train_full.copy()
    X_test_full = X_test_full.copy()
    X_train_full["zip_price_index"] = apply_zip_price_index(X_train_full, zip_index)
    X_test_full["zip_price_index"] = apply_zip_price_index(X_test_full, zip_index)

    X_train = X_train_full[FEATURE_COLUMNS]
    X_test = X_test_full[FEATURE_COLUMNS]

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
        "features": int(X_train.shape[1]),
        "algorithm": "Random Forest Regressor",
        "dataset": "King County, WA home sales (real transactions, May 2014-May 2015)",
        "trainingMedianSqft": float(X_train["sqft_living"].median()),
    }

    feature_importance = sorted(
        (
            {"feature": FEATURE_LABELS.get(col, col), "importance": round(float(imp), 4)}
            for col, imp in zip(FEATURE_COLUMNS, model.feature_importances_)
        ),
        key=lambda row: row["importance"],
        reverse=True,
    )

    corr_columns = FEATURE_COLUMNS + ["price"]
    corr_frame = X_train.copy()
    corr_frame["price"] = y_train.values
    corr = corr_frame[corr_columns].corr().round(3)
    correlation_matrix = {
        "features": [FEATURE_LABELS.get(c, c) if c != "price" else "Price" for c in corr_columns],
        "matrix": corr.values.tolist(),
    }

    training_history = compute_training_history(X_train, y_train)

    property_type_defaults = {}
    for i, name in enumerate(PROPERTY_TYPES):
        bucket = X_train_full[X_train_full["property_type"] == i]
        if bucket.empty:
            continue
        property_type_defaults[name] = {
            "floors": float(bucket["floors"].median()),
            "waterfront": int(bucket["waterfront"].median() >= 0.5),
            "view": float(bucket["view"].median()),
            "condition": float(bucket["condition"].median()),
            "grade": float(bucket["grade"].median()),
            "wasRenovated": int(bucket["was_renovated"].median() >= 0.5),
            "bathrooms": float(bucket["bathrooms"].median()),
            "sampleSize": int(len(bucket)),
        }

    median_sale_date = pd.to_datetime(raw["date"], format="%Y%m%dT%H%M%S").median()
    metro_price_index = build_metro_price_index(median_sale_date)

    with MODEL_PATH.open("wb") as handle:
        import pickle
        pickle.dump(model, handle)

    FEATURES_PATH.write_text(json.dumps(FEATURE_COLUMNS, indent=2), encoding="utf-8")
    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    FEATURE_IMPORTANCE_PATH.write_text(json.dumps(feature_importance, indent=2), encoding="utf-8")
    CORRELATION_PATH.write_text(json.dumps(correlation_matrix, indent=2), encoding="utf-8")
    TRAINING_HISTORY_PATH.write_text(json.dumps(training_history, indent=2), encoding="utf-8")
    PROPERTY_TYPE_DEFAULTS_PATH.write_text(json.dumps(property_type_defaults, indent=2), encoding="utf-8")
    ZIP_PRICE_INDEX_PATH.write_text(json.dumps({str(k): v for k, v in zip_index.items()}, indent=2), encoding="utf-8")
    METRO_PRICE_INDEX_PATH.write_text(json.dumps(metro_price_index, indent=2), encoding="utf-8")

    public_data_dir = PUBLIC_DIR / "data"
    public_data_dir.mkdir(parents=True, exist_ok=True)
    for name, payload in [
        ("model-metrics.json", metrics),
        ("feature-importance.json", feature_importance),
        ("correlation-matrix.json", correlation_matrix),
        ("training-history.json", training_history),
        ("metro-price-index.json", metro_price_index),
    ]:
        (public_data_dir / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
