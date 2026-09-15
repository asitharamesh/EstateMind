"""FastAPI wiring: loads every validated region's artifacts once at startup
and exposes them over HTTP. ML logic lives in features/pipeline/valuation;
this file only defines routes and maps errors to HTTP status codes.
"""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load .env before anything reads OUTPUT_DIR and friends.
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.artifacts import RegionBundle, load_validated_bundles
from backend.catalog import region_catalog
from backend.observability import RequestLoggingMiddleware, configure_logging, log_event
from backend.pipeline import InputRejected
from backend.regions import REGIONS, UNAVAILABLE_MESSAGE
from backend.schemas import LivePredictionRequest
from backend.valuation import value_request

SERVER_ERROR_MESSAGE = "The prediction service encountered an error. Please try again."

configure_logging(os.getenv("LOG_LEVEL", "INFO"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.bundles = load_validated_bundles()
    log_event("models_loaded", regions=sorted(app.state.bundles),
              versions={k: b.card["modelVersion"] for k, b in app.state.bundles.items()})
    yield


app = FastAPI(title="EstateMind API", version="2.0.0", lifespan=lifespan)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def get_bundles(request: Request) -> dict[str, RegionBundle]:
    return request.app.state.bundles


def _field_error(field: str, message: str, error_type: str = "value_error") -> dict[str, Any]:
    # Same shape FastAPI uses for its own request-validation errors, so the
    # client handles every 422 identically.
    return {"loc": ["body", field], "msg": message, "type": error_type}


@app.get("/health")
def health(bundles: dict[str, RegionBundle] = Depends(get_bundles)) -> dict[str, Any]:
    return {"status": "ok", "validatedRegions": sorted(bundles)}


@app.get("/api/regions")
def regions(bundles: dict[str, RegionBundle] = Depends(get_bundles)) -> dict[str, Any]:
    return region_catalog(bundles)


@app.get("/api/regions/{region}/insights")
def region_insights(region: str, bundles: dict[str, RegionBundle] = Depends(get_bundles)) -> dict[str, Any]:
    if region not in REGIONS:
        raise HTTPException(status_code=404, detail=f"Unknown region '{region}'")
    bundle = bundles.get(region)
    if bundle is None:
        raise HTTPException(status_code=404, detail=UNAVAILABLE_MESSAGE)
    return {"region": region, "regionLabel": bundle.definition.label, "modelCard": bundle.card, **bundle.insights}


@app.post("/api/predict")
def predict(request: LivePredictionRequest, bundles: dict[str, RegionBundle] = Depends(get_bundles)) -> dict[str, Any]:
    bundle = bundles.get(request.region)
    if bundle is None:
        raise HTTPException(status_code=422, detail=[_field_error("region", UNAVAILABLE_MESSAGE, "region_unavailable")])
    try:
        result = value_request(bundle, request)
    except InputRejected as exc:
        raise HTTPException(status_code=422, detail=[_field_error(e["field"], e["message"]) for e in exc.errors]) from exc
    except Exception as exc:
        # Log the real cause server-side; never leak internals to the client.
        log_event("prediction_failed", logging.ERROR, exc_info=True, region=request.region)
        raise HTTPException(status_code=500, detail=SERVER_ERROR_MESSAGE) from exc
    log_event("prediction_served", region=result["region"], model_version=result["modelVersion"],
              zipcode=request.zipcode, price=result["price"], tier=result["tier"]["label"])
    return result
