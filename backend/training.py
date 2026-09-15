"""Training steps shared by the training CLI, the benchmark script and tests.

Flow for one region:
  dataset adapter -> canonical records -> grouped train/test split
  -> FeatureSpec.fit(train) -> admit train rows through the request contract
  -> FeatureSpec.transform -> RandomForestRegressor
  -> OOB-calibrated interval, regional price reference, zip $/sqft baseline
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import GroupShuffleSplit

from backend.datasets import LOADERS, ensure_dataset
from backend.features import FEATURE_LABELS, FeatureSpec
from backend.pipeline import admit_records
from backend.regions import RegionDefinition
from backend.tiers import PriceReference
from backend.uncertainty import PredictionInterval

MODEL_VERSION = "2.0.0"
TEST_FRACTION = 0.2
SPLIT_SEED = 42
MODEL_SEED = 42
INTERVAL_NOMINAL_COVERAGE = 0.8

# Chosen with backend/scripts/benchmark_model.py on grouped 5-fold CV of the
# training split only (docs/SYSTEM_DESIGN.md, "Model size"): CV R^2 0.8536 vs
# 0.8562 for the best configuration (difference < 1 CV std), at 38 MB instead
# of 238 MB. 50 trees was also within that margin (19 MB) but was not chosen:
# each training row then has only ~18 out-of-bag trees for interval
# calibration, and per-prediction explanations get noisier.
HYPERPARAMETERS = {"n_estimators": 100, "max_depth": 18, "min_samples_leaf": 3}


def load_region_records(region: RegionDefinition) -> pd.DataFrame:
    if region.dataset is None:
        raise ValueError(f"Region {region.key} has no dataset")
    return LOADERS[region.dataset.key](ensure_dataset(region.dataset))


def grouped_split(records: pd.DataFrame, seed: int = SPLIT_SEED, test_fraction: float = TEST_FRACTION):
    """Every sale of the same property lands on the same side of the split."""
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_fraction, random_state=seed)
    train_idx, test_idx = next(splitter.split(records, groups=records["property_id"]))
    return records.iloc[train_idx], records.iloc[test_idx]


def make_model(**overrides) -> RandomForestRegressor:
    params = {**HYPERPARAMETERS, **overrides}
    return RandomForestRegressor(**params, random_state=MODEL_SEED, n_jobs=-1, oob_score=True)


@dataclass
class TrainedRegion:
    region: str
    spec: FeatureSpec
    model: RandomForestRegressor
    interval: PredictionInterval
    reference: PriceReference
    zip_median_ppsf: dict[str, float]
    train_features: pd.DataFrame
    train_prices: pd.Series
    train_rejected: dict[str, int]


def fit_region(
    region: str,
    train_records: pd.DataFrame,
    reference_description: str,
    optional_fields: frozenset[str],
    **model_overrides,
) -> TrainedRegion:
    spec, in_domain = FeatureSpec.fit(region, train_records, optional_fields)
    admitted, rejected = admit_records(spec, train_records)
    if not admitted.index.equals(train_records.index[in_domain.to_numpy()]):
        raise RuntimeError("Request contract and feature spec disagree about the training domain")

    prices = train_records.loc[admitted.index, "price"]
    features = spec.transform(admitted)
    model = make_model(**model_overrides).fit(features, prices)

    ppsf = (prices / admitted["sqft_living"]).groupby(admitted["zipcode"]).median()
    return TrainedRegion(
        region=region,
        spec=spec,
        model=model,
        interval=PredictionInterval.calibrate(prices.to_numpy(), model.oob_prediction_, INTERVAL_NOMINAL_COVERAGE),
        reference=PriceReference.from_prices(prices, reference_description),
        zip_median_ppsf={str(z): float(v) for z, v in sorted(ppsf.items())},
        train_features=features,
        train_prices=prices,
        train_rejected=rejected,
    )


def learning_curve(trained: TrainedRegion, step: int = 25, max_estimators: int = 250) -> list[dict]:
    """Train R^2 and out-of-bag R^2 as trees are added (warm start)."""
    model = make_model(n_estimators=step, warm_start=True)
    history = []
    for n in range(step, max_estimators + 1, step):
        model.set_params(n_estimators=n)
        model.fit(trained.train_features, trained.train_prices)
        history.append(
            {
                "estimators": n,
                "trainR2": round(float(model.score(trained.train_features, trained.train_prices)), 4),
                "oobR2": round(float(model.oob_score_), 4),
            }
        )
    return history


def build_insights(trained: TrainedRegion) -> dict:
    importance = sorted(
        (
            {"feature": FEATURE_LABELS[c], "importance": round(float(v), 4)}
            for c, v in zip(trained.spec.feature_columns, trained.model.feature_importances_)
        ),
        key=lambda row: row["importance"],
        reverse=True,
    )
    frame = trained.train_features.assign(price=trained.train_prices.to_numpy())
    corr = frame.corr().round(3)
    return {
        "featureImportance": importance,
        "correlationMatrix": {
            "features": [FEATURE_LABELS.get(c, "Price") for c in corr.columns],
            "matrix": np.nan_to_num(corr.to_numpy()).tolist(),
        },
        "trainingHistory": learning_curve(trained),
    }
