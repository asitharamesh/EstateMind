"""Train one model per region that has a validated dataset, evaluate it
through the production request pipeline, and write all artifacts.

    python -m backend.scripts.train_model        (or: npm run train:model)

Regions without a dataset (backend/regions.py) are skipped and reported as
unavailable - no substitute prediction is ever produced for them.
"""
import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path

import sklearn
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")

from backend.artifacts import load_validated_bundles, write_region_artifacts  # noqa: E402
from backend.catalog import region_catalog  # noqa: E402
from backend.evaluation import evaluate_region  # noqa: E402
from backend.features import FEATURE_LABELS  # noqa: E402
from backend.regions import REGIONS, RegionDefinition  # noqa: E402
from backend.training import (  # noqa: E402
    HYPERPARAMETERS,
    MODEL_SEED,
    MODEL_VERSION,
    SPLIT_SEED,
    TEST_FRACTION,
    build_insights,
    fit_region,
    grouped_split,
    load_region_records,
)


def _public_dir() -> Path:
    raw = os.getenv("PUBLIC_DIR")
    if not raw:
        return REPO_ROOT / "frontend" / "public"
    return Path(raw) if Path(raw).is_absolute() else REPO_ROOT / raw


def train_region(region: RegionDefinition) -> dict:
    dataset = region.dataset
    records = load_region_records(region)
    with dataset.path.open(encoding="utf-8") as handle:
        raw_rows = sum(1 for _ in handle) - 1

    train, test = grouped_split(records)
    trained = fit_region(
        region.key,
        train,
        reference_description=f"{region.label} training-split sale prices, {dataset.time_span}",
        optional_fields=dataset.optional_fields,
    )
    evaluation = evaluate_region(
        trained.spec, trained.model, trained.interval, trained.reference, trained.zip_median_ppsf, test
    )
    repeat_counts = records["property_id"].value_counts()

    card = {
        "region": region.key,
        "regionLabel": region.label,
        "modelVersion": MODEL_VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "algorithm": "RandomForestRegressor",
        "hyperparameters": {**HYPERPARAMETERS, "random_state": MODEL_SEED},
        "environment": {"python": platform.python_version(), "scikitLearn": sklearn.__version__},
        "features": [{"name": c, "label": FEATURE_LABELS[c]} for c in trained.spec.feature_columns],
        "dataset": {
            "name": dataset.name,
            "provenance": dataset.provenance,
            "license": dataset.license_note,
            "url": dataset.url,
            "sha256": dataset.sha256,
            "timeSpan": dataset.time_span,
            "priceBasis": dataset.price_basis,
            "rawRows": raw_rows,
            "rowsAfterCleaning": int(len(records)),
            "removedImpossibleRows": raw_rows - int(len(records)),
        },
        "split": {
            "method": "GroupShuffleSplit grouped by property id (every sale of a house on one side)",
            "testFraction": TEST_FRACTION,
            "seed": SPLIT_SEED,
            "trainRows": int(len(train)),
            "testRows": int(len(test)),
            "propertiesSoldMoreThanOnce": int((repeat_counts > 1).sum()),
            "propertiesInBothSplits": len(set(train["property_id"]) & set(test["property_id"])),
            "trainRowsUsed": int(len(trained.train_prices)),
            "trainRowsRejectedByField": trained.train_rejected,
        },
        "interval": trained.interval.to_dict(),
        "evaluation": evaluation,
    }
    write_region_artifacts(trained, card, build_insights(trained))
    return card


def main() -> None:
    for region in REGIONS.values():
        if not region.has_dataset:
            print(f"[skip] {region.label}: no validated dataset - region stays unavailable")
            continue
        card = train_region(region)
        m = card["evaluation"]["metrics"]
        print(
            f"[done] {region.label}: R2={m['r2']:.4f} MAE=${m['mae']:,.0f} RMSE=${m['rmse']:,.0f} "
            f"MAPE={m['mape']:.2f}% n={m['n']} interval coverage="
            f"{card['evaluation']['interval']['empiricalCoverage']:.3f}"
        )

    data_dir = _public_dir() / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    catalog = region_catalog(load_validated_bundles())
    (data_dir / "regions.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"[done] wrote offline region catalog to {data_dir / 'regions.json'}")


if __name__ == "__main__":
    main()
