"""The one and only feature builder.

Training, evaluation and the live API all turn canonical property records
into model features by calling `FeatureSpec.transform`. There is no second
implementation anywhere: if the API sees a feature value, the model saw that
exact transformation during training and the evaluation measured it.

A `FeatureSpec` is fitted once per region on that region's *training* split
(it learns the zipcode location encoding and the supported input domain),
serialised next to the model, and loaded unchanged at inference time.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

SPEC_FORMAT_VERSION = 3

# Fields every region's dataset must provide and every request must supply -
# the model has no honest way to predict without them.
CORE_FIELDS = ("sqft_living", "bedrooms", "bathrooms", "age", "zipcode")

# Fields that are region-specific and only usable when a region's dataset
# genuinely has an equivalent. King County has all three (assessor grade,
# rated view, waterfront flag); a region without a real per-sale rating for
# one of these simply doesn't collect it - the model is not fitted or asked
# for it, rather than filling in an invented value. Order here is the
# canonical order used wherever these fields are listed.
OPTIONAL_FIELDS = ("grade", "view", "waterfront")

# Fields a user supplies (and a dataset adapter produces), in canonical names.
# Not every region uses every one of these - see FeatureSpec.fields.
CANONICAL_FIELDS = CORE_FIELDS + OPTIONAL_FIELDS

FEATURE_LABELS = {
    "sqft_living": "Square Footage",
    "bedrooms": "Bedrooms",
    "bathrooms": "Bathrooms",
    "age": "Property Age",
    "zip_price_index": "Location (zip code)",
    "grade": "Construction Grade",
    "view": "View Quality",
    "waterfront": "Waterfront",
}

# Product-level input domain, applied identically to API requests, training
# rows and evaluation rows. Values outside it are rejected, never clamped.
NUMERIC_BOUNDS: dict[str, tuple[float, float]] = {
    "sqft_living": (500, 8000),
    "bedrooms": (0, 10),
    "bathrooms": (0.5, 8.0),
    "age": (0, 115),
}
# Bathrooms are recorded in quarter steps (e.g. 1.75 = full bath + 3/4 bath).
# This is the training/evaluation domain (FeatureSpec, admit_records): it
# must keep matching what the model was actually fit and measured on. The
# live-facing product restricts user input further to whole numbers only -
# see backend/schemas.py::LivePredictionRequest, which is deliberately a
# narrower subset of this domain rather than a change to it.
BATHROOM_STEP = 0.25

# A zipcode or ordinal level needs at least this many training sales before
# the model is allowed to predict for it.
MIN_ZIP_SUPPORT = 20
MIN_LEVEL_SUPPORT = 10


def feature_columns_for(optional_fields: frozenset[str]) -> list[str]:
    """Model input columns for a region that uses `optional_fields` (a subset
    of OPTIONAL_FIELDS), in a fixed, deterministic order."""
    return ["sqft_living", "bedrooms", "bathrooms", "age", "zip_price_index"] + [
        f for f in OPTIONAL_FIELDS if f in optional_fields
    ]


class FeatureValidationError(ValueError):
    """Raised when records fall outside what the fitted spec supports.
    `errors` is a list of {"field": canonical_field, "message": str}."""

    def __init__(self, errors: list[dict[str, str]]):
        self.errors = errors
        super().__init__("; ".join(f"{e['field']}: {e['message']}" for e in errors))


def _supported_level_range(values: pd.Series) -> tuple[int, int]:
    counts = values.value_counts()
    supported = sorted(int(level) for level, n in counts.items() if n >= MIN_LEVEL_SUPPORT)
    if not supported:
        raise ValueError(f"No level of {values.name} has {MIN_LEVEL_SUPPORT}+ training rows")
    return supported[0], supported[-1]


@dataclass(frozen=True)
class FeatureSpec:
    region: str
    # Subset of OPTIONAL_FIELDS this region's dataset actually provides.
    optional_fields: frozenset[str]
    grade_range: tuple[int, int] | None
    view_range: tuple[int, int] | None
    # zipcode -> mean training sale price in that zip / overall training mean
    zip_price_index: dict[str, float]
    fit_rows: int

    # ---- fitting -----------------------------------------------------------
    @classmethod
    def fit(cls, region: str, train_records: pd.DataFrame, optional_fields: frozenset[str]) -> tuple["FeatureSpec", pd.Series]:
        """Fit on training records only. Returns the spec and a boolean mask
        of the training rows inside the supported domain (the rows the model
        should be trained on)."""
        fields = CORE_FIELDS + tuple(f for f in OPTIONAL_FIELDS if f in optional_fields)
        _require_columns(train_records, (*fields, "price"))
        zip_counts = train_records["zipcode"].value_counts()
        supported_zips = {str(z) for z, n in zip_counts.items() if n >= MIN_ZIP_SUPPORT}
        provisional = cls(
            region=region,
            optional_fields=optional_fields,
            grade_range=_supported_level_range(train_records["grade"]) if "grade" in optional_fields else None,
            view_range=_supported_level_range(train_records["view"]) if "view" in optional_fields else None,
            zip_price_index={z: 1.0 for z in supported_zips},
            fit_rows=0,
        )
        in_domain = provisional.valid_mask(train_records)
        admitted = train_records[in_domain]
        # Location encoding learned from in-domain training rows only, so no
        # test or live price ever influences it.
        zip_means = admitted.groupby("zipcode")["price"].mean()
        index = {str(z): float(v / admitted["price"].mean()) for z, v in zip_means.items() if str(z) in supported_zips}
        spec = cls(
            region=region,
            optional_fields=optional_fields,
            grade_range=provisional.grade_range,
            view_range=provisional.view_range,
            zip_price_index=dict(sorted(index.items())),
            fit_rows=int(len(admitted)),
        )
        # A zip whose rows were all out of domain has no encoding; re-mask.
        return spec, spec.valid_mask(train_records)

    # ---- validation --------------------------------------------------------
    @property
    def fields(self) -> tuple[str, ...]:
        """Canonical fields this region actually requires - the core fields
        plus whichever optional ones its dataset provides."""
        return CORE_FIELDS + tuple(f for f in OPTIONAL_FIELDS if f in self.optional_fields)

    @property
    def feature_columns(self) -> list[str]:
        return feature_columns_for(self.optional_fields)

    @property
    def supported_zipcodes(self) -> list[str]:
        return list(self.zip_price_index)

    def validate_record(self, record: Mapping[str, Any]) -> list[dict[str, str]]:
        errors: list[dict[str, str]] = []

        def fail(field: str, message: str) -> None:
            errors.append({"field": field, "message": message})

        fields = self.fields
        for field in fields:
            value = record.get(field)
            if value is None or (isinstance(value, float) and np.isnan(value)):
                fail(field, "is required")
        if errors:
            return errors

        for field, (low, high) in NUMERIC_BOUNDS.items():
            value = record[field]
            if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, float, np.integer, np.floating)):
                fail(field, "must be a number")
            elif not low <= value <= high:
                fail(field, f"must be between {low:g} and {high:g}")
        if not errors and (record["bathrooms"] / BATHROOM_STEP) % 1 != 0:
            fail("bathrooms", f"must be in steps of {BATHROOM_STEP}")

        zipcode = str(record["zipcode"])
        if zipcode not in self.zip_price_index:
            fail("zipcode", f"{zipcode} is not a supported zipcode for this region")

        for field, level_range in (("grade", self.grade_range), ("view", self.view_range)):
            if field not in fields:
                continue
            low, high = level_range
            value = record[field]
            if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)):
                fail(field, "must be a whole number")
            elif not low <= value <= high:
                fail(field, f"must be between {low} and {high} for this region")

        if "waterfront" in fields and not isinstance(record["waterfront"], (bool, np.bool_)):
            fail("waterfront", "must be true or false")
        return errors

    def valid_mask(self, records: pd.DataFrame) -> pd.Series:
        return pd.Series(
            [not self.validate_record(row) for row in records[list(self.fields)].to_dict("records")],
            index=records.index,
        )

    # ---- the transformation ------------------------------------------------
    def transform(self, records: pd.DataFrame | Mapping[str, Any]) -> pd.DataFrame:
        """Canonical records -> model feature frame (self.feature_columns
        order). Every row must be valid; nothing is defaulted, clamped or
        imputed."""
        frame = pd.DataFrame([records]) if isinstance(records, Mapping) else records
        fields = self.fields
        _require_columns(frame, fields)
        for position, row in enumerate(frame[list(fields)].to_dict("records")):
            errors = self.validate_record(row)
            if errors:
                raise FeatureValidationError([{**e, "row": str(position)} for e in errors])

        columns = {
            "sqft_living": frame["sqft_living"].astype(float),
            "bedrooms": frame["bedrooms"].astype(float),
            "bathrooms": frame["bathrooms"].astype(float),
            "age": frame["age"].astype(float),
            "zip_price_index": frame["zipcode"].astype(str).map(self.zip_price_index).astype(float),
        }
        for field in OPTIONAL_FIELDS:
            if field in self.optional_fields:
                columns[field] = frame[field].astype(float)
        features = pd.DataFrame(columns, index=frame.index)
        return features[self.feature_columns]

    # ---- serialisation -----------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "formatVersion": SPEC_FORMAT_VERSION,
            "region": self.region,
            "optionalFields": sorted(self.optional_fields),
            "featureColumns": self.feature_columns,
            "numericBounds": {k: list(v) for k, v in NUMERIC_BOUNDS.items()},
            "bathroomStep": BATHROOM_STEP,
            "gradeRange": list(self.grade_range) if self.grade_range else None,
            "viewRange": list(self.view_range) if self.view_range else None,
            "zipPriceIndex": self.zip_price_index,
            "fitRows": self.fit_rows,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "FeatureSpec":
        optional_fields = frozenset(data.get("optionalFields", []))
        if data.get("formatVersion") != SPEC_FORMAT_VERSION or data.get("featureColumns") != feature_columns_for(optional_fields):
            raise ValueError(
                "Feature spec artifact is incompatible with backend/features.py "
                f"(format {data.get('formatVersion')}, columns {data.get('featureColumns')}). Retrain the model."
            )
        if data.get("numericBounds") != {k: list(v) for k, v in NUMERIC_BOUNDS.items()}:
            raise ValueError("Feature spec was trained with different input bounds. Retrain the model.")
        grade_range = data.get("gradeRange")
        view_range = data.get("viewRange")
        return cls(
            region=data["region"],
            optional_fields=optional_fields,
            grade_range=tuple(grade_range) if grade_range else None,
            view_range=tuple(view_range) if view_range else None,
            zip_price_index=dict(data["zipPriceIndex"]),
            fit_rows=int(data["fitRows"]),
        )


def _require_columns(frame: pd.DataFrame, columns) -> None:
    missing = [c for c in columns if c not in frame.columns]
    if missing:
        raise FeatureValidationError([{"field": c, "message": "is required"} for c in missing])
