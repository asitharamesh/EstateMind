"""Region catalog served at GET /api/regions and written as a static snapshot
(frontend/public/data/regions.json) for the offline fallback. One function
builds both, so the snapshot cannot drift from what the API reports."""
from backend.artifacts import RegionBundle
from backend.features import NUMERIC_BOUNDS
from backend.regions import REGIONS, UNAVAILABLE_MESSAGE
from backend.schemas import LIVE_BATHROOM_BOUNDS, LIVE_BATHROOM_STEP

PERFORMANCE_NOTE = "Model performance is region-specific. Metrics apply only to the region they were measured on."


def input_domain(bundle: RegionBundle) -> dict:
    spec = bundle.spec
    dataset = bundle.definition.dataset

    def bounds(field: str) -> dict:
        low, high = NUMERIC_BOUNDS[field]
        return {"min": low, "max": high}

    def scale(level_range: tuple[int, int], labels: dict[int, str]) -> dict:
        low, high = level_range
        return {"min": low, "max": high, "labels": {str(level): labels.get(level, str(level)) for level in range(low, high + 1)}}

    domain: dict = {
        "zipcodes": spec.supported_zipcodes,
        "sqft": bounds("sqft_living"),
        "bedrooms": bounds("bedrooms"),
        # The live-facing domain (whole numbers), not FeatureSpec's training
        # domain (which also supports quarter-bath precision) - see
        # backend/schemas.py::LivePredictionRequest.
        "bathrooms": {"min": LIVE_BATHROOM_BOUNDS[0], "max": LIVE_BATHROOM_BOUNDS[1], "step": LIVE_BATHROOM_STEP},
        "ageYears": bounds("age"),
        # Not every region's dataset has a construction grade, rated view or
        # waterfront flag (backend/features.py::OPTIONAL_FIELDS). Keys are
        # only present here when this region's model actually uses them -
        # the frontend must not assume they exist.
        "waterfront": "waterfront" in spec.optional_fields,
    }
    if spec.grade_range is not None:
        domain["grade"] = scale(spec.grade_range, dataset.grade_scale)
    if spec.view_range is not None:
        domain["view"] = scale(spec.view_range, dataset.view_scale)
    return domain


def region_catalog(bundles: dict[str, RegionBundle]) -> dict:
    regions = []
    for key, definition in REGIONS.items():
        bundle = bundles.get(key)
        if bundle is None:
            regions.append({"key": key, "label": definition.label, "status": "unavailable", "message": UNAVAILABLE_MESSAGE})
            continue
        regions.append(
            {
                "key": key,
                "label": definition.label,
                "status": "validated",
                "model": bundle.card,
                "inputDomain": input_domain(bundle),
                "offlineBaseline": {
                    "method": bundle.card["evaluation"]["baseline"]["name"],
                    "metrics": bundle.card["evaluation"]["baseline"]["metrics"],
                    "zipMedianPricePerSqft": bundle.zip_median_ppsf,
                },
            }
        )
    return {"note": PERFORMANCE_NOTE, "regions": regions}
