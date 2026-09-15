"""HTTP contract tests against the real trained Seattle artifacts."""
import dataclasses

import pytest

from backend.app import SERVER_ERROR_MESSAGE, app, get_bundles
from backend.regions import UNAVAILABLE_MESSAGE
from backend.schemas import PredictionRequest
from backend.tests.conftest import requires_artifacts

pytestmark = requires_artifacts


def _error_fields(response):
    return [error["loc"][-1] for error in response.json()["detail"]]


def test_health_lists_validated_regions(client):
    assert client.get("/health").json() == {"status": "ok", "validatedRegions": ["chicago", "seattle"]}


def test_region_catalog_marks_regions_without_data_unavailable(client):
    regions = {r["key"]: r for r in client.get("/api/regions").json()["regions"]}
    assert regions["seattle"]["status"] == "validated"
    assert regions["seattle"]["model"]["evaluation"]["metrics"]["n"] > 4000
    for key in ("san-francisco", "los-angeles", "austin", "new-york"):
        assert regions[key] == {"key": key, "label": regions[key]["label"], "status": "unavailable", "message": UNAVAILABLE_MESSAGE}


def test_valid_prediction(client, valid_payload, seattle_bundle):
    response = client.post("/api/predict", json=valid_payload)
    assert response.status_code == 200
    body = response.json()
    assert body["region"] == "seattle" and body["modelVersion"] == seattle_bundle.card["modelVersion"]
    assert body["interval"]["low"] < body["price"] < body["interval"]["high"]
    assert body["interval"]["nominalCoverage"] == 0.8
    assert body["tier"]["label"] in ("Budget", "Mid-Range", "Luxury")
    assert 1 <= len(body["factors"]) <= 6
    assert "X-Request-ID" in response.headers


def test_price_is_exactly_the_model_output_with_no_multiplier(client, valid_payload, seattle_bundle):
    record = PredictionRequest.model_validate(valid_payload).to_record()
    expected = seattle_bundle.model.predict(seattle_bundle.spec.transform(record))[0]
    assert client.post("/api/predict", json=valid_payload).json()["price"] == round(expected)


@pytest.mark.parametrize(
    "patch, field",
    [
        ({"zipcode": "99999"}, "zipcode"),  # well-formed but not a King County zip
        ({"zipcode": "abc"}, "zipcode"),
        ({"region": "atlantis"}, "region"),
        ({"grade": 99}, "grade"),
        ({"view": 9}, "view"),
        ({"propertyType": "castle"}, "propertyType"),
        ({"city": "atlantis"}, "city"),
        ({"sqft": "1800"}, "sqft"),
        ({"bathrooms": 2.3}, "bathrooms"),
        ({"bathrooms": 2.5}, "bathrooms"),  # a real, valid training value - but not a whole number
    ],
)
def test_invalid_input_returns_422_on_the_right_field(client, valid_payload, patch, field):
    response = client.post("/api/predict", json={**valid_payload, **patch})
    assert response.status_code == 422
    assert field in _error_fields(response)


def test_region_without_validated_model_is_refused(client, valid_payload):
    response = client.post("/api/predict", json={**valid_payload, "region": "san-francisco"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == UNAVAILABLE_MESSAGE


def test_missing_field_and_malformed_json(client, valid_payload):
    del valid_payload["waterfront"]
    assert "waterfront" in _error_fields(client.post("/api/predict", json=valid_payload))
    malformed = client.post("/api/predict", content=b"{not json", headers={"Content-Type": "application/json"})
    assert malformed.status_code == 422


def test_internal_failure_is_a_500_with_a_generic_message(client, valid_payload, seattle_bundle):
    class BrokenModel:
        def predict(self, _):
            raise RuntimeError("secret internal detail")

    broken = dataclasses.replace(seattle_bundle, model=BrokenModel())
    app.dependency_overrides[get_bundles] = lambda: {"seattle": broken}
    try:
        response = client.post("/api/predict", json=valid_payload)
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 500
    assert response.json() == {"detail": SERVER_ERROR_MESSAGE}


def test_seattle_is_not_automatically_luxury(client, valid_payload):
    modest = {**valid_payload, "zipcode": "98002", "sqft": 1100, "bedrooms": 2, "bathrooms": 1, "grade": 6, "ageYears": 60}
    grand = {**valid_payload, "zipcode": "98004", "sqft": 4200, "bedrooms": 5, "bathrooms": 4, "grade": 10, "ageYears": 5}
    assert client.post("/api/predict", json=modest).json()["tier"]["label"] == "Budget"
    assert client.post("/api/predict", json=valid_payload).json()["tier"]["label"] == "Mid-Range"
    assert client.post("/api/predict", json=grand).json()["tier"]["label"] == "Luxury"


def test_insights(client):
    assert client.get("/api/regions/seattle/insights").status_code == 200
    assert client.get("/api/regions/austin/insights").json() == {"detail": UNAVAILABLE_MESSAGE}
    assert client.get("/api/regions/atlantis/insights").status_code == 404
