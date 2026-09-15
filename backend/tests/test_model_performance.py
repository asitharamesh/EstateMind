"""Model regression guard.

Why this exists: v1 reported R^2 0.84 from `model.predict(X_test)` on
features the application never collected; through the real API inputs it
scored 0.48. These tests (a) re-run the evaluation through the production
request pipeline and require it to match the numbers the model card and UI
report, and (b) fail CI if that production-style performance degrades.

Baseline (model 2.0.0, grouped split seed 42, scikit-learn 1.9.0):
R^2 0.8584, MAE $79,120, 80% interval coverage 0.802 on 4,315 test sales.
Thresholds leave room for library-version noise, not for regressions.
"""
import pytest
from fastapi.testclient import TestClient

from backend.evaluation import evaluate_region
from backend.regions import REGIONS
from backend.tests.conftest import requires_artifacts
from backend.training import fit_region, grouped_split, load_region_records

pytestmark = requires_artifacts

MIN_R2 = 0.845
MAX_MAE = 83_000
COVERAGE_RANGE = (0.76, 0.84)


@pytest.fixture(scope="module")
def split():
    return grouped_split(load_region_records(REGIONS["seattle"]))


@pytest.fixture(scope="module")
def evaluation(seattle_bundle, split):
    b = seattle_bundle
    return evaluate_region(b.spec, b.model, b.interval, b.reference, b.zip_median_ppsf, split[1])


def test_no_property_appears_in_both_train_and_test(split):
    train, test = split
    assert not set(train["property_id"]) & set(test["property_id"])
    assert len(train) + len(test) == 21_612


def test_reported_metrics_match_the_production_pipeline(seattle_bundle, evaluation):
    reported = seattle_bundle.card["evaluation"]
    assert evaluation["metrics"] == pytest.approx(reported["metrics"], rel=1e-9)
    assert evaluation["interval"]["empiricalCoverage"] == pytest.approx(reported["interval"]["empiricalCoverage"])


def test_production_style_performance_has_not_regressed(evaluation):
    metrics = evaluation["metrics"]
    assert metrics["r2"] >= MIN_R2
    assert metrics["mae"] <= MAX_MAE
    assert evaluation["admittedRows"] / evaluation["testRows"] > 0.99
    assert evaluation["metrics"]["r2"] > evaluation["baseline"]["metrics"]["r2"] + 0.05


def test_interval_coverage_is_close_to_its_claim(evaluation):
    low, high = COVERAGE_RANGE
    assert low <= evaluation["interval"]["empiricalCoverage"] <= high


def test_tiers_are_not_collapsed_into_one_label(evaluation):
    assert all(0.2 < share < 0.5 for share in evaluation["predictedTierShare"].values())


def test_batch_evaluation_equals_live_api_responses(seattle_bundle, split, client):
    """The live API and the production evaluation pipeline agree, with one
    documented exception: LivePredictionRequest only accepts whole-number
    bathrooms (schemas.py), while PredictionRequest - which gates the
    training/evaluation rows behind `evaluation`/`admitted` above - also
    accepts the quarter-bath values ~69% of King County sales actually have.
    A fractional-bathroom row is scored in the reported metrics but cannot be
    replayed through the live endpoint; this checks both halves of that gap."""
    from backend.pipeline import admit_records
    from backend.schemas import payload_from_record

    sample = split[1].iloc[:40]
    admitted, _ = admit_records(seattle_bundle.spec, sample)
    batch = seattle_bundle.model.predict(seattle_bundle.spec.transform(admitted))
    whole_bathroom_rows = 0
    for record, expected in zip(admitted.to_dict("records"), batch):
        response = client.post("/api/predict", json=payload_from_record("seattle", record))
        if record["bathrooms"] % 1 == 0:
            whole_bathroom_rows += 1
            assert response.status_code == 200
            assert response.json()["price"] == round(expected)
        else:
            assert response.status_code == 422
    assert whole_bathroom_rows > 0  # sanity: the sample exercised the matching path too


def test_training_is_reproducible(seattle_bundle, split):
    train, test = split
    trained = fit_region("seattle", train, "reproducibility check", REGIONS["seattle"].dataset.optional_fields)
    result = evaluate_region(trained.spec, trained.model, trained.interval, trained.reference, trained.zip_median_ppsf, test)
    assert result["metrics"]["r2"] == pytest.approx(seattle_bundle.card["evaluation"]["metrics"]["r2"], abs=0.002)
    assert trained.spec == seattle_bundle.spec
