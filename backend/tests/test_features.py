"""Unit tests for the shared feature builder. The small frame below is a
hand-built test fixture, not training data."""
import pandas as pd
import pytest

from backend.features import (
    CANONICAL_FIELDS,
    OPTIONAL_FIELDS,
    FeatureSpec,
    FeatureValidationError,
    feature_columns_for,
)

ALL_OPTIONAL = frozenset(OPTIONAL_FIELDS)
FEATURE_COLUMNS = feature_columns_for(ALL_OPTIONAL)


def _fixture_records() -> pd.DataFrame:
    rows = []
    for i in range(60):
        zipcode = "98001" if i < 30 else "98004"
        rows.append(
            {
                "sqft_living": 1500 + 10 * i,
                "bedrooms": 3,
                "bathrooms": 2.0,
                "age": 20,
                "zipcode": zipcode,
                "grade": 7 if i % 2 else 8,
                "view": 0,
                "waterfront": False,
                "price": 300_000.0 if zipcode == "98001" else 900_000.0,
            }
        )
    # Out of the product domain: must not influence the location encoding.
    rows.append({**rows[0], "sqft_living": 20_000, "price": 50_000_000.0})
    return pd.DataFrame(rows)


@pytest.fixture
def spec():
    fitted, _ = FeatureSpec.fit("seattle", _fixture_records(), ALL_OPTIONAL)
    return fitted


def _record(**overrides):
    base = {"sqft_living": 1800, "bedrooms": 3, "bathrooms": 2.25, "age": 10,
            "zipcode": "98004", "grade": 8, "view": 0, "waterfront": True}
    return {**base, **overrides}


def test_feature_columns_are_the_eight_collected_features():
    assert FEATURE_COLUMNS == ["sqft_living", "bedrooms", "bathrooms", "age",
                               "zip_price_index", "grade", "view", "waterfront"]
    for removed in ("property_type", "floors", "condition", "was_renovated"):
        assert removed not in FEATURE_COLUMNS


def test_transform_output_order_does_not_depend_on_input_order(spec):
    shuffled = pd.DataFrame([_record()])[list(reversed(CANONICAL_FIELDS))]
    features = spec.transform(shuffled)
    assert list(features.columns) == FEATURE_COLUMNS
    assert features.iloc[0].tolist() == [1800.0, 3.0, 2.25, 10.0, spec.zip_price_index["98004"], 8.0, 0.0, 1.0]


def test_single_record_and_frame_transform_identically(spec):
    frame = spec.transform(pd.DataFrame([_record()]))
    single = spec.transform(_record())
    pd.testing.assert_frame_equal(frame, single)


def test_zip_encoding_is_learned_from_in_domain_training_rows_only(spec):
    # 30 sales at 300k and 30 at 900k -> overall mean 600k; the 50M
    # out-of-domain row is excluded.
    assert spec.zip_price_index == {"98001": pytest.approx(0.5), "98004": pytest.approx(1.5)}
    assert spec.fit_rows == 60


def test_fit_mask_marks_out_of_domain_training_rows():
    _, mask = FeatureSpec.fit("seattle", _fixture_records(), ALL_OPTIONAL)
    assert mask.sum() == 60 and not mask.iloc[-1]


def test_region_with_partial_optional_fields_drops_unused_columns():
    records = _fixture_records().drop(columns=["view", "waterfront"])
    spec, mask = FeatureSpec.fit("chicago", records, frozenset({"grade"}))
    assert spec.fields == ("sqft_living", "bedrooms", "bathrooms", "age", "zipcode", "grade")
    assert spec.feature_columns == ["sqft_living", "bedrooms", "bathrooms", "age", "zip_price_index", "grade"]
    assert spec.view_range is None
    record = {"sqft_living": 1800, "bedrooms": 3, "bathrooms": 2.0, "age": 10, "zipcode": "98004", "grade": 8}
    features = spec.transform(record)
    assert list(features.columns) == spec.feature_columns
    assert "view" not in features.columns and "waterfront" not in features.columns


def test_unknown_zipcode_is_rejected_not_defaulted(spec):
    with pytest.raises(FeatureValidationError) as exc:
        spec.transform(_record(zipcode="99999"))
    assert exc.value.errors[0]["field"] == "zipcode"


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"sqft_living": 100}, "sqft_living"),
        ({"bedrooms": 11}, "bedrooms"),
        ({"bathrooms": 2.3}, "bathrooms"),
        ({"age": -1}, "age"),
        ({"grade": 12}, "grade"),  # fixture only supports grades 7-8
        ({"view": 3}, "view"),
        ({"waterfront": 1}, "waterfront"),
        ({"grade": None}, "grade"),
    ],
)
def test_invalid_values_are_rejected(spec, overrides, field):
    errors = spec.validate_record(_record(**overrides))
    assert [e["field"] for e in errors] == [field]


def test_missing_column_is_rejected(spec):
    frame = pd.DataFrame([_record()]).drop(columns=["grade"])
    with pytest.raises(FeatureValidationError) as exc:
        spec.transform(frame)
    assert exc.value.errors == [{"field": "grade", "message": "is required"}]


def test_spec_round_trips_and_rejects_incompatible_artifacts(spec):
    data = spec.to_dict()
    assert FeatureSpec.from_dict(data) == spec
    with pytest.raises(ValueError):
        FeatureSpec.from_dict({**data, "featureColumns": FEATURE_COLUMNS + ["property_type"]})
    with pytest.raises(ValueError):
        FeatureSpec.from_dict({**data, "numericBounds": {**data["numericBounds"], "sqft_living": [0, 99999]}})
