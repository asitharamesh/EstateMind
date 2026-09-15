"""Per-region model artifacts: writing them after training and loading them
for serving. Layout (one directory per validated region):

  <OUTPUT_DIR>/regions/<region>/
    model.pkl              trained RandomForestRegressor
    feature_spec.json      fitted FeatureSpec (feature order, zip encoding, domain)
    model_card.json        dataset, split, hyperparameters, test metrics, interval
    market_reference.json  training sale prices (tier reference), zip median $/sqft
    insights.json          feature importance, correlations, learning curve

If a region has a dataset but no artifacts, loading fails loudly instead of
guessing.
"""
import json
import os
import pickle
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.features import FeatureSpec
from backend.regions import REGIONS, RegionDefinition
from backend.tiers import PriceReference
from backend.uncertainty import PredictionInterval

BACKEND_DIR = Path(__file__).resolve().parent


def artifacts_root() -> Path:
    raw = Path(os.getenv("OUTPUT_DIR", "assets"))
    return raw if raw.is_absolute() else BACKEND_DIR / raw


def region_dir(region: str, root: Path | None = None) -> Path:
    return (root or artifacts_root()) / "regions" / region


class ArtifactsMissingError(FileNotFoundError):
    pass


@dataclass(frozen=True)
class RegionBundle:
    definition: RegionDefinition
    spec: FeatureSpec
    model: Any
    interval: PredictionInterval
    reference: PriceReference
    zip_median_ppsf: dict[str, float]
    card: dict
    insights: dict


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _read_json(path: Path) -> Any:
    if not path.exists():
        raise ArtifactsMissingError(f"Required artifact not found at {path}. Run `npm run train:model` first.")
    return json.loads(path.read_text(encoding="utf-8"))


def write_region_artifacts(trained, card: dict, insights: dict, root: Path | None = None) -> Path:
    directory = region_dir(trained.region, root)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "model.pkl").open("wb") as handle:
        pickle.dump(trained.model, handle)
    _write_json(directory / "feature_spec.json", trained.spec.to_dict())
    _write_json(directory / "model_card.json", card)
    _write_json(
        directory / "market_reference.json",
        {
            "description": trained.reference.description,
            "sortedPrices": trained.reference.sorted_prices.tolist(),
            "zipMedianPricePerSqft": trained.zip_median_ppsf,
        },
    )
    _write_json(directory / "insights.json", insights)
    return directory


def load_region_bundle(region: str, root: Path | None = None) -> RegionBundle:
    directory = region_dir(region, root)
    model_path = directory / "model.pkl"
    if not model_path.exists():
        raise ArtifactsMissingError(f"Model for region '{region}' not found at {model_path}. Run `npm run train:model` first.")
    with model_path.open("rb") as handle:
        model = pickle.load(handle)
    spec = FeatureSpec.from_dict(_read_json(directory / "feature_spec.json"))
    if list(getattr(model, "feature_names_in_", [])) != spec.feature_columns:
        raise ValueError(
            f"Model at {model_path} was trained on {getattr(model, 'feature_names_in_', None)}, "
            f"expected {spec.feature_columns}"
        )
    # One request is one row: thread fan-out costs more than it saves.
    model.set_params(n_jobs=1)

    card = _read_json(directory / "model_card.json")
    market = _read_json(directory / "market_reference.json")
    return RegionBundle(
        definition=REGIONS[region],
        spec=spec,
        model=model,
        interval=PredictionInterval.from_dict(card["interval"]),
        reference=PriceReference.from_prices(market["sortedPrices"], market["description"]),
        zip_median_ppsf=market["zipMedianPricePerSqft"],
        card=card,
        insights=_read_json(directory / "insights.json"),
    )


def load_validated_bundles(root: Path | None = None) -> dict[str, RegionBundle]:
    """Every region that has a dataset must have artifacts; regions without a
    dataset are simply not served."""
    return {key: load_region_bundle(key, root) for key, region in REGIONS.items() if region.has_dataset}
