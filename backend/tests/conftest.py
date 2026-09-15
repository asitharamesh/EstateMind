"""Shared fixtures.

Tests that need the trained Seattle artifacts are skipped locally when they
are missing, but CI sets ESTATEMIND_REQUIRE_ARTIFACTS=1 so a missing model
fails the build instead of silently skipping the performance checks.
"""
import os

import pytest
from fastapi.testclient import TestClient

from backend.artifacts import load_region_bundle, region_dir

ARTIFACTS_PRESENT = (region_dir("seattle") / "model.pkl").exists()
REQUIRE_ARTIFACTS = os.getenv("ESTATEMIND_REQUIRE_ARTIFACTS") == "1"

requires_artifacts = pytest.mark.skipif(
    not ARTIFACTS_PRESENT and not REQUIRE_ARTIFACTS,
    reason="Seattle artifacts missing - run `npm run train:model`",
)


@pytest.fixture(scope="session")
def seattle_bundle():
    return load_region_bundle("seattle")


@pytest.fixture(scope="session")
def client():
    from backend.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def valid_payload():
    return {
        "region": "seattle",
        "zipcode": "98103",
        "sqft": 1800,
        "bedrooms": 3,
        "bathrooms": 2,
        "ageYears": 40,
        "grade": 7,
        "view": 0,
        "waterfront": False,
    }
