"""HTTP request contract. Structural validation lives here; region-specific
domain rules (supported zipcodes, grade/view ranges) live in the fitted
FeatureSpec, because they are learned from each region's training data."""
import math
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.features import BATHROOM_STEP, NUMERIC_BOUNDS
from backend.regions import REGIONS

# API field name -> canonical record field name (backend/features.py).
RECORD_FIELD_FOR = {
    "sqft": "sqft_living",
    "bedrooms": "bedrooms",
    "bathrooms": "bathrooms",
    "ageYears": "age",
    "zipcode": "zipcode",
    "grade": "grade",
    "view": "view",
    "waterfront": "waterfront",
}
REQUEST_FIELD_FOR = {record: api for api, record in RECORD_FIELD_FOR.items()}


def _bounds(field: str) -> dict[str, float]:
    low, high = NUMERIC_BOUNDS[field]
    return {"ge": low, "le": high}


class PredictionRequest(BaseModel):
    # strict: "3" is not silently turned into 3, "yes" is not a boolean.
    # extra="forbid": fields the model does not use (e.g. the old
    # propertyType/city) are rejected instead of silently ignored.
    model_config = ConfigDict(strict=True, extra="forbid")

    region: str
    zipcode: str = Field(pattern=r"^\d{5}$")
    sqft: int = Field(**_bounds("sqft_living"))
    bedrooms: int = Field(**_bounds("bedrooms"))
    bathrooms: float = Field(**_bounds("bathrooms"))
    ageYears: int = Field(**_bounds("age"))
    # Not every region's dataset has these - see backend/features.py
    # ::OPTIONAL_FIELDS. Structurally optional here; whether a specific
    # region actually requires one is a domain rule enforced by that
    # region's fitted FeatureSpec, not by this request contract.
    grade: Optional[int] = None
    view: Optional[int] = None
    waterfront: Optional[bool] = None

    @field_validator("region")
    @classmethod
    def _known_region(cls, value: str) -> str:
        if value not in REGIONS:
            raise ValueError(f"Unknown region '{value}'. Supported regions: {', '.join(REGIONS)}")
        return value

    @field_validator("bathrooms")
    @classmethod
    def _quarter_steps(cls, value: float) -> float:
        if (value / BATHROOM_STEP) % 1 != 0:
            raise ValueError(f"Bathrooms must be in steps of {BATHROOM_STEP}")
        return value

    def to_record(self) -> dict[str, Any]:
        return {record: getattr(self, api) for api, record in RECORD_FIELD_FOR.items()}


# The public product only ever lets a user choose a whole number of bathrooms.
# This is strictly narrower than NUMERIC_BOUNDS["bathrooms"] above: every value
# in this range (1, 2, 3, ...) is a value FeatureSpec and the model already
# saw during training, just less granular than the quarter-bath precision
# (e.g. 2.75 = two full baths + one three-quarter bath) the training data
# actually records. King County sales are ~69% fractional-bathroom listings,
# so this constraint is deliberately NOT applied to `PredictionRequest` above:
# that class also gates every training and evaluation row (backend/pipeline.py
# admit_records), and doing so there would silently drop most of the dataset
# and invalidate the model's reported metrics (README.md, docs/SYSTEM_DESIGN.md).
LIVE_BATHROOM_BOUNDS = (1, int(NUMERIC_BOUNDS["bathrooms"][1]))
LIVE_BATHROOM_STEP = 1


class LivePredictionRequest(PredictionRequest):
    """The contract for POST /api/predict - the only path a real user can
    reach. Training and evaluation keep using the base PredictionRequest
    above unchanged, so this stricter bathroom rule affects what a user can
    type, not what the model was trained or measured on.

    `bathrooms` stays a float (not `int`) so a whole-number value serialised
    as JSON `2.0` - as `payload_from_record` and some non-browser clients
    produce - is treated the same as `2`; only the fractional part is
    rejected."""

    bathrooms: float = Field(ge=LIVE_BATHROOM_BOUNDS[0], le=LIVE_BATHROOM_BOUNDS[1])

    @field_validator("bathrooms")
    @classmethod
    def _whole_bathrooms_only(cls, value: float) -> float:
        if value % 1 != 0:
            raise ValueError("Bathrooms must be a whole number")
        return value


def payload_from_record(region: str, record: dict[str, Any]) -> dict[str, Any]:
    """Canonical dataset record -> the JSON-like payload a client would send.
    Used by evaluation so held-out rows enter through the same contract as
    live requests.

    `bathrooms` is emitted as a real int when the sale's true count is whole
    (e.g. `2`, not `2.0`) so it satisfies LivePredictionRequest's strict int
    field the same way a live client's JSON body would. A fractional count
    (e.g. `2.75`) is left as a float on purpose: PredictionRequest still
    accepts it for training/evaluation, while a strict int field correctly
    rejects it as not whole - the same outcome a live user hits."""
    bathrooms = record["bathrooms"]
    payload = {
        "region": region,
        "zipcode": str(record["zipcode"]),
        "sqft": int(record["sqft_living"]),
        "bedrooms": int(record["bedrooms"]),
        "bathrooms": int(bathrooms) if float(bathrooms) % 1 == 0 else float(bathrooms),
        "ageYears": int(record["age"]),
    }
    # Omitted entirely (rather than sent as null) when this region's dataset
    # has no value for the field - the same shape a real client sends for a
    # region that never asks for it.
    def present(value: Any) -> bool:
        return value is not None and not (isinstance(value, float) and math.isnan(value))

    grade = record.get("grade")
    if present(grade):
        payload["grade"] = int(grade)
    view = record.get("view")
    if present(view):
        payload["view"] = int(view)
    waterfront = record.get("waterfront")
    if present(waterfront):
        payload["waterfront"] = bool(waterfront)
    return payload
