"""Turns an admitted PredictionRequest into a valuation response using only
the region's trained artifacts: the shared feature builder, the model, the
calibrated interval and the region's own price reference. No multipliers,
no defaults, no hand-written pricing."""
from typing import Any

import numpy as np

from backend.artifacts import RegionBundle
from backend.features import FEATURE_LABELS
from backend.pipeline import admit_request
from backend.schemas import PredictionRequest
from backend.tiers import classify

TOP_FACTORS = 6


def tree_contributions(model: Any, features) -> tuple[float, np.ndarray]:
    """Per-prediction attribution decomposed from the actual decision paths
    through every tree (the algorithm the `treeinterpreter` package uses):
    each split's change in node value is credited to the split feature."""
    x = features.to_numpy()
    contributions = np.zeros(x.shape[1])
    bias_total = 0.0
    for estimator in model.estimators_:
        tree = estimator.tree_
        path = estimator.decision_path(x)
        nodes = path.indices[path.indptr[0] : path.indptr[1]]
        values = tree.value[:, 0, 0]
        bias_total += values[nodes[0]]
        for parent, child in zip(nodes[:-1], nodes[1:]):
            contributions[tree.feature[parent]] += values[child] - values[parent]
    n = len(model.estimators_)
    return bias_total / n, contributions / n


def value_request(bundle: RegionBundle, request: PredictionRequest) -> dict[str, Any]:
    record = admit_request(bundle.spec, request)
    features = bundle.spec.transform(record)
    price = float(bundle.model.predict(features)[0])
    low, high = bundle.interval.bounds(price)
    _, contributions = tree_contributions(bundle.model, features)

    total_abs = float(np.sum(np.abs(contributions))) or 1.0
    factors = sorted(
        (
            {
                "feature": column,
                "label": FEATURE_LABELS[column],
                "contribution": round(float(value), 2),
                "share": round(float(abs(value) / total_abs), 4),
            }
            for column, value in zip(bundle.spec.feature_columns, contributions)
        ),
        key=lambda row: abs(row["contribution"]),
        reverse=True,
    )

    card = bundle.card
    return {
        "region": bundle.definition.key,
        "regionLabel": bundle.definition.label,
        "modelVersion": card["modelVersion"],
        "price": round(price),
        "priceBasis": bundle.definition.dataset.price_basis,
        "pricePerSqft": round(price / record["sqft_living"]),
        "zipMedianPricePerSqft": round(bundle.zip_median_ppsf[record["zipcode"]]),
        "interval": {
            "low": round(float(low)),
            "high": round(float(high)),
            "nominalCoverage": bundle.interval.nominal_coverage,
            "empiricalCoverage": card["evaluation"]["interval"]["empiricalCoverage"],
            "method": card["interval"]["method"],
        },
        "tier": classify(price, bundle.reference),
        "factors": factors[:TOP_FACTORS],
    }
