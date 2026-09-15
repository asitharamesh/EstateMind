"""Reproduces every model-selection number quoted in docs/SYSTEM_DESIGN.md.

    python -m backend.scripts.benchmark_model [--quick]

Sections:
  1. legacy     - the v1 model (12 features, random split, 250 trees) scored
                  with real feature values vs. the values the v1 API supplied
  2. features   - feature-set ablation (grouped 5-fold CV on the training split)
  3. leakage    - random vs. grouped split over several seeds, plus error on
                  repeat-sale rows that leak across a random split
  4. trees      - n_estimators x min_samples_leaf: CV R^2, test metrics,
                  model size and latency
  5. intervals  - tree-percentile range vs. OOB-calibrated interval coverage

Model selection uses CV on the training split only; test numbers are reported
for transparency, never used to choose.
"""
import argparse
import json
import pickle
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import GroupKFold, train_test_split

from backend.datasets import KING_COUNTY, drop_impossible_rows, ensure_dataset
from backend.evaluation import evaluate_region, regression_metrics
from backend.features import FeatureSpec
from backend.pipeline import admit_records
from backend.regions import REGIONS
from backend.training import SPLIT_SEED, fit_region, grouped_split, load_region_records
from backend.valuation import tree_contributions

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = REPO_ROOT / "docs" / "benchmarks" / "seattle.json"


def _fold_scores(train: pd.DataFrame, folds: int, **overrides) -> list[float]:
    scores = []
    for fit_idx, val_idx in GroupKFold(n_splits=folds).split(train, groups=train["property_id"]):
        fold_train, fold_val = train.iloc[fit_idx], train.iloc[val_idx]
        trained = fit_region("seattle", fold_train, "fold", KING_COUNTY.optional_fields, **overrides)
        admitted, _ = admit_records(trained.spec, fold_val)
        predicted = trained.model.predict(trained.spec.transform(admitted))
        scores.append(regression_metrics(fold_val.loc[admitted.index, "price"], predicted)["r2"])
    return scores


# ---------------------------------------------------------------- 1. legacy
LEGACY_TYPES = ["studio", "apartment", "house", "villa"]
LEGACY_COLUMNS = ["sqft_living", "bedrooms", "bathrooms", "floors", "waterfront", "view", "condition",
                  "grade", "age", "was_renovated", "zip_price_index", "property_type"]


def _legacy_frame() -> pd.DataFrame:
    raw = pd.read_csv(ensure_dataset(KING_COUNTY), dtype={"id": str, "zipcode": str})
    df = drop_impossible_rows(raw).reset_index(drop=True)
    df["age"] = (pd.to_datetime(df["date"], format="%Y%m%dT%H%M%S").dt.year - df["yr_built"]).clip(lower=0)
    df["was_renovated"] = (df["yr_renovated"] > 0).astype(int)

    def classify(row) -> int:  # v1's rule-derived "property type"
        if row.waterfront == 1 or row.grade >= 11:
            return 3
        if row.bedrooms <= 1 and row.sqft_living < 750:
            return 0
        if row.floors <= 1.0 and row.sqft_living < 1600:
            return 1
        return 2

    df["property_type"] = [classify(r) for r in df.itertuples()]
    return df


def legacy(df: pd.DataFrame) -> dict:
    train, test = train_test_split(df, test_size=0.2, random_state=42)
    train, test = train.copy(), test.copy()
    zip_index = (train.groupby("zipcode")["price"].mean() / train["price"].mean()).to_dict()
    train["zip_price_index"] = train["zipcode"].map(zip_index)
    test["zip_price_index"] = test["zipcode"].map(zip_index).fillna(1.0)
    model = RandomForestRegressor(n_estimators=250, max_depth=18, random_state=42, n_jobs=-1)
    model.fit(train[LEGACY_COLUMNS], train["price"])

    app_style = test.copy()
    for code in range(len(LEGACY_TYPES)):
        bucket = train[train["property_type"] == code]
        rows = app_style["property_type"] == code
        for column in ("floors", "view", "condition", "grade"):
            app_style.loc[rows, column] = bucket[column].median()
        app_style.loc[rows, "waterfront"] = int(bucket["waterfront"].median() >= 0.5)
        app_style.loc[rows, "was_renovated"] = int(bucket["was_renovated"].median() >= 0.5)
    app_style["zip_price_index"] = 1.0  # v1 API constant
    app_style["bathrooms"] = app_style["bathrooms"].round().clip(1, 8)  # v1 UI: whole bathrooms only
    return {
        "description": "v1: 12 features, random 80/20 split, 250 trees, max_depth 18",
        "trainRows": len(train),
        "testRows": len(test),
        "propertiesInBothSplits": len(set(train["id"]) & set(test["id"])),
        "modelSizeMB": round(len(pickle.dumps(model)) / 1e6, 1),
        "withRealFeatureValues": regression_metrics(test["price"], model.predict(test[LEGACY_COLUMNS])),
        "withV1ApiInputs": regression_metrics(test["price"], model.predict(app_style[LEGACY_COLUMNS])),
    }


# -------------------------------------------------------------- 2. features
def feature_ablation(df: pd.DataFrame, records: pd.DataFrame, folds: int) -> list[dict]:
    """Simple study frame (all cleaned rows, fold-fitted zip encoding) - for
    relative comparison of feature sets only."""
    df = df.assign(property_id=records["property_id"])
    train, _ = grouped_split(df)
    base = ["sqft_living", "bedrooms", "bathrooms", "age"]
    shipped = base + ["zip_price_index", "grade", "view", "waterfront"]
    candidates = {
        "sqft, bedrooms, bathrooms, age, property_type (v1 user inputs)": base + ["property_type"],
        "sqft, bedrooms, bathrooms, age, zip": base + ["zip_price_index"],
        "shipped 8: + zip, grade, view, waterfront": shipped,
        "shipped 8 + property_type": shipped + ["property_type"],
        "shipped 8 + floors": shipped + ["floors"],
        "shipped 8 + condition": shipped + ["condition"],
        "shipped 8 + was_renovated": shipped + ["was_renovated"],
    }
    rows = []
    for name, columns in candidates.items():
        scores = []
        for fit_idx, val_idx in GroupKFold(n_splits=folds).split(train, groups=train["property_id"]):
            fit, val = train.iloc[fit_idx].copy(), train.iloc[val_idx].copy()
            index = (fit.groupby("zipcode")["price"].mean() / fit["price"].mean()).to_dict()
            fit["zip_price_index"] = fit["zipcode"].map(index)
            val["zip_price_index"] = val["zipcode"].map(index).fillna(1.0)
            model = RandomForestRegressor(n_estimators=100, max_depth=18, min_samples_leaf=3, random_state=42, n_jobs=-1)
            model.fit(fit[columns], fit["price"])
            scores.append(regression_metrics(val["price"], model.predict(val[columns]))["r2"])
        rows.append({"features": name, "cvR2Mean": float(np.mean(scores)), "cvR2Std": float(np.std(scores))})
        print(f"  features {name}: {np.mean(scores):.4f} ± {np.std(scores):.4f}", flush=True)
    return rows


# --------------------------------------------------------------- 3. leakage
def leakage(records: pd.DataFrame, seeds: list[int]) -> dict:
    runs = []
    for seed in seeds:
        for method in ("random", "grouped"):
            if method == "random":
                train, test = train_test_split(records, test_size=0.2, random_state=seed)
            else:
                train, test = grouped_split(records, seed=seed)
            trained = fit_region("seattle", train, "study", KING_COUNTY.optional_fields)
            result = evaluate_region(trained.spec, trained.model, trained.interval, trained.reference,
                                     trained.zip_median_ppsf, test)
            shared = set(train["property_id"]) & set(test["property_id"])
            entry = {"seed": seed, "split": method, "propertiesInBothSplits": len(shared), **result["metrics"]}
            if method == "random" and shared:
                admitted, _ = admit_records(trained.spec, test)
                predicted = pd.Series(trained.model.predict(trained.spec.transform(admitted)), index=admitted.index)
                leaked = admitted["property_id"].isin(shared) if "property_id" in admitted else test.loc[admitted.index, "property_id"].isin(shared)
                actual = test.loc[admitted.index, "price"]
                entry["maeOnLeakedRepeatSales"] = float((actual[leaked] - predicted[leaked]).abs().mean())
                entry["maeOnOtherRows"] = float((actual[~leaked] - predicted[~leaked]).abs().mean())
                entry["leakedRowsScored"] = int(leaked.sum())
            runs.append(entry)
            print(f"  leakage seed={seed} {method}: R2={entry['r2']:.4f} MAE={entry['mae']:,.0f}", flush=True)
    summary = {}
    for method in ("random", "grouped"):
        r2 = [r["r2"] for r in runs if r["split"] == method]
        mae = [r["mae"] for r in runs if r["split"] == method]
        summary[method] = {"r2Mean": float(np.mean(r2)), "r2Std": float(np.std(r2)), "maeMean": float(np.mean(mae))}
    return {"runs": runs, "summary": summary}


# ----------------------------------------------------------------- 4. trees
def trees(records: pd.DataFrame, folds: int, grid: list[tuple[int, int]]) -> list[dict]:
    train, test = grouped_split(records)
    rows = []
    for leaf, n_trees in grid:
        overrides = {"n_estimators": n_trees, "min_samples_leaf": leaf}
        cv = _fold_scores(train, folds, **overrides)
        trained = fit_region("seattle", train, "study", KING_COUNTY.optional_fields, **overrides)
        result = evaluate_region(trained.spec, trained.model, trained.interval, trained.reference,
                                 trained.zip_median_ppsf, test)
        model = trained.model
        size_mb = len(pickle.dumps(model)) / 1e6
        model.set_params(n_jobs=1)
        row = trained.spec.transform(admit_records(trained.spec, test.iloc[:1])[0])
        predict_ms = _median_ms(lambda: model.predict(row), 30)
        explain_ms = _median_ms(lambda: tree_contributions(model, row), 10)
        entry = {
            "nEstimators": n_trees, "minSamplesLeaf": leaf,
            "cvR2Mean": float(np.mean(cv)), "cvR2Std": float(np.std(cv)),
            "test": result["metrics"], "sizeMB": round(size_mb, 1),
            "predictMs": round(predict_ms, 2), "explainMs": round(explain_ms, 2),
        }
        rows.append(entry)
        print(f"  trees leaf={leaf} n={n_trees}: CV {entry['cvR2Mean']:.4f}±{entry['cvR2Std']:.4f} "
              f"test R2 {entry['test']['r2']:.4f} MAE {entry['test']['mae']:,.0f} "
              f"{size_mb:.1f}MB predict {predict_ms:.1f}ms explain {explain_ms:.1f}ms", flush=True)
    return rows


def _median_ms(fn, repeats: int) -> float:
    fn()
    timings = []
    for _ in range(repeats):
        started = time.perf_counter()
        fn()
        timings.append((time.perf_counter() - started) * 1000)
    return float(np.median(timings))


# ------------------------------------------------------------- 5. intervals
def intervals(records: pd.DataFrame) -> dict:
    train, test = grouped_split(records)
    trained = fit_region("seattle", train, "study", KING_COUNTY.optional_fields)
    admitted, _ = admit_records(trained.spec, test)
    features = trained.spec.transform(admitted)
    actual = test.loc[admitted.index, "price"].to_numpy()
    predicted = trained.model.predict(features)
    per_tree = np.stack([tree.predict(features.to_numpy()) for tree in trained.model.estimators_])
    p10, p90 = np.percentile(per_tree, [10, 90], axis=0)
    low, high = trained.interval.bounds(predicted)

    def describe(lo, hi):
        return {"coverage": float(np.mean((actual >= lo) & (actual <= hi))),
                "medianRelativeWidth": float(np.median((hi - lo) / predicted))}

    return {
        "v1TreePercentile10to90": describe(p10, p90),
        "oobCalibrated80": describe(low, high),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="fewer folds/seeds/configs (smoke run)")
    args = parser.parse_args()
    folds = 3 if args.quick else 5
    seeds = [SPLIT_SEED] if args.quick else [0, 1, 2, 3, SPLIT_SEED]
    grid = [(1, 50), (3, 100)] if args.quick else [(leaf, n) for leaf in (1, 3, 5) for n in (50, 100, 150, 250)]

    records = load_region_records(REGIONS["seattle"])
    frame = _legacy_frame()
    print("1/5 legacy", flush=True)
    report = {"legacy": legacy(frame)}
    print("2/5 features", flush=True)
    report["features"] = feature_ablation(frame, records, folds)
    print("3/5 leakage", flush=True)
    report["leakage"] = leakage(records, seeds)
    print("4/5 trees", flush=True)
    report["trees"] = trees(records, folds, grid)
    print("5/5 intervals", flush=True)
    report["intervals"] = intervals(records)

    if not args.quick:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"wrote {OUT_PATH}")
    print(json.dumps({k: report[k] for k in ("legacy", "intervals")}, indent=2))


if __name__ == "__main__":
    main()
