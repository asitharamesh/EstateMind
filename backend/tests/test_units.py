"""Unit tests for the request contract, tiers and interval calibration."""
import numpy as np
import pytest
from pydantic import ValidationError

from backend.schemas import LivePredictionRequest, PredictionRequest, payload_from_record
from backend.tiers import PriceReference, classify, tier_for_percentile
from backend.uncertainty import PredictionInterval


# ------------------------------------------------------------------ schema
def test_valid_request_maps_to_canonical_record(valid_payload):
    record = PredictionRequest.model_validate(valid_payload).to_record()
    assert record == {"sqft_living": 1800, "bedrooms": 3, "bathrooms": 2.0, "age": 40,
                      "zipcode": "98103", "grade": 7, "view": 0, "waterfront": False}
    assert payload_from_record("seattle", record) == valid_payload


@pytest.mark.parametrize(
    "patch",
    [
        {"region": "atlantis"},
        {"propertyType": "castle"},  # removed field: rejected, not ignored
        {"city": "seattle"},
        {"sqft": "1800"},  # no silent string coercion
        {"waterfront": "yes"},
        {"zipcode": "9810"},
        {"sqft": 499},
        {"bathrooms": 2.3},
        {"bedrooms": 3.5},
    ],
)
def test_invalid_requests_are_rejected(valid_payload, patch):
    with pytest.raises(ValidationError):
        PredictionRequest.model_validate({**valid_payload, **patch})


def test_missing_core_field_is_rejected(valid_payload):
    del valid_payload["sqft"]
    with pytest.raises(ValidationError):
        PredictionRequest.model_validate(valid_payload)


def test_missing_region_specific_field_is_structurally_allowed(valid_payload):
    # grade/view/waterfront are structurally optional - not every region's
    # dataset has them. Whether a given region actually requires one is a
    # domain rule enforced by that region's fitted FeatureSpec, not here.
    del valid_payload["view"]
    request = PredictionRequest.model_validate(valid_payload)
    assert request.view is None


def test_integer_bathrooms_are_accepted(valid_payload):
    assert PredictionRequest.model_validate({**valid_payload, "bathrooms": 2}).bathrooms == 2


def test_base_request_still_accepts_fractional_bathrooms_for_training_and_evaluation(valid_payload):
    # admit_records (backend/pipeline.py) validates every training/evaluation
    # row through this exact class. It must keep accepting the quarter-bath
    # values ~69% of King County sales actually have, or the model's reported
    # metrics would silently stop matching what it was trained/measured on.
    assert PredictionRequest.model_validate({**valid_payload, "bathrooms": 2.75}).bathrooms == 2.75


@pytest.mark.parametrize("bathrooms", [1.25, 1.5, 1.75, 2.25, 2.5])
def test_live_request_rejects_fractional_bathrooms(valid_payload, bathrooms):
    # The live-facing contract (used by POST /api/predict) is stricter than
    # PredictionRequest: only whole-number bathrooms, per product decision.
    with pytest.raises(ValidationError):
        LivePredictionRequest.model_validate({**valid_payload, "bathrooms": bathrooms})


def test_live_request_accepts_whole_number_bathrooms(valid_payload):
    assert LivePredictionRequest.model_validate({**valid_payload, "bathrooms": 3}).bathrooms == 3


# ------------------------------------------------------------------- tiers
@pytest.fixture
def uniform_reference():
    return PriceReference.from_prices(np.arange(1, 1001) * 1000.0, "fixture")


def test_percentile_thresholds():
    assert tier_for_percentile(10) == "Budget"
    assert tier_for_percentile(50) == "Mid-Range"
    assert tier_for_percentile(90) == "Luxury"
    assert tier_for_percentile(33.3) == "Budget"
    assert tier_for_percentile(66.7) == "Luxury"


@pytest.mark.parametrize("price, tier", [(100_000, "Budget"), (500_000, "Mid-Range"), (950_000, "Luxury")])
def test_low_middle_high_prices(uniform_reference, price, tier):
    assert classify(price, uniform_reference)["label"] == tier


def test_prices_outside_reference_clamp_to_0_and_100(uniform_reference):
    assert uniform_reference.percentile(1) == 0.0
    assert uniform_reference.percentile(10**9) == 100.0


def test_same_price_is_ranked_against_each_regions_own_market():
    expensive_market = PriceReference.from_prices(np.linspace(800_000, 3_000_000, 500), "expensive")
    cheap_market = PriceReference.from_prices(np.linspace(150_000, 700_000, 500), "cheap")
    assert classify(1_000_000, expensive_market)["label"] == "Budget"
    assert classify(1_000_000, cheap_market)["label"] == "Luxury"


def test_tiers_split_the_reference_market_into_thirds(uniform_reference):
    labels = [classify(p, uniform_reference)["label"] for p in uniform_reference.sorted_prices]
    shares = {t: labels.count(t) / len(labels) for t in ("Budget", "Mid-Range", "Luxury")}
    assert all(0.3 < share < 0.37 for share in shares.values())


# ---------------------------------------------------------------- interval
def test_interval_calibration_hits_nominal_coverage_on_fresh_data():
    rng = np.random.default_rng(0)
    predicted = rng.uniform(2e5, 2e6, 20_000)
    noise = lambda: np.exp(rng.normal(0, 0.2, predicted.size))  # noqa: E731
    interval = PredictionInterval.calibrate(predicted * noise(), predicted, nominal_coverage=0.8)
    assert interval.coverage(predicted * noise(), predicted) == pytest.approx(0.8, abs=0.015)


def test_interval_ignores_rows_without_oob_prediction():
    interval = PredictionInterval.calibrate([100, 110, 90, 105], [100, 0, 100, np.nan], 0.8)
    assert interval.calibration_rows == 2
    assert PredictionInterval.from_dict(interval.to_dict()) == interval
