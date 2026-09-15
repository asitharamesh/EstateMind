"""Production-style evaluation.

Held-out sales are converted into the same JSON-like payloads a client sends,
validated by the same PredictionRequest contract and FeatureSpec domain,
transformed by the same FeatureSpec.transform, and predicted by the same
model object the API serves. Rows the API would reject (422) are not scored,
and how many there were is reported alongside the metrics.
"""
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from backend.features import FeatureSpec
from backend.pipeline import admit_records
from backend.tiers import TIERS, PriceReference, tier_for_percentile
from backend.uncertainty import PredictionInterval

PIPELINE_DESCRIPTION = (
    "test row -> client payload -> PredictionRequest -> FeatureSpec domain check -> FeatureSpec.transform -> model"
)
BASELINE_NAME = "Zip-code median $/sqft (training split) x square footage"


def regression_metrics(actual, predicted) -> dict:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    return {
        "r2": float(r2_score(actual, predicted)),
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        "mape": float(np.mean(np.abs((actual - predicted) / actual)) * 100),
        "n": int(actual.size),
    }


def evaluate_region(
    spec: FeatureSpec,
    model,
    interval: PredictionInterval,
    reference: PriceReference,
    zip_median_ppsf: dict[str, float],
    test_records: pd.DataFrame,
) -> dict:
    admitted, rejected = admit_records(spec, test_records)
    actual = test_records.loc[admitted.index, "price"].to_numpy(dtype=float)
    predicted = model.predict(spec.transform(admitted))

    low, high = interval.bounds(predicted)
    inside = (actual >= low) & (actual <= high)
    predicted_tiers = np.array([tier_for_percentile(reference.percentile(p)) for p in predicted])
    baseline = admitted["zipcode"].map(zip_median_ppsf).to_numpy(dtype=float) * admitted["sqft_living"].to_numpy(dtype=float)

    return {
        "pipeline": PIPELINE_DESCRIPTION,
        "testRows": int(len(test_records)),
        "admittedRows": int(len(admitted)),
        "rejectedByField": rejected,
        "metrics": regression_metrics(actual, predicted),
        "baseline": {"name": BASELINE_NAME, "metrics": regression_metrics(actual, baseline)},
        "interval": {
            "nominalCoverage": interval.nominal_coverage,
            "empiricalCoverage": float(inside.mean()),
            "medianRelativeWidth": float(np.median((high - low) / predicted)),
            "coverageByPredictedTier": {
                tier: float(inside[predicted_tiers == tier].mean()) for tier in TIERS if (predicted_tiers == tier).any()
            },
        },
        "predictedTierShare": {tier: float((predicted_tiers == tier).mean()) for tier in TIERS},
    }
