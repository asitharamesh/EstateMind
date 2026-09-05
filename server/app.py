"""FastAPI wiring: loads the trained model's artifacts once at startup and
exposes them over HTTP. All ML logic lives in server/valuation.py and
server/artifacts.py - this file only defines routes.
"""
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from server.artifacts import load_artifacts
from server.schemas import PredictionRequest
from server.valuation import predict_price

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="EstateMind API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

ARTIFACTS = load_artifacts()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/api/model-metrics")
def model_metrics() -> dict[str, Any]:
    return ARTIFACTS["metrics"]


@app.get("/api/model-insights")
def model_insights() -> dict[str, Any]:
    return {
        "featureImportance": ARTIFACTS["feature_importance"],
        "correlationMatrix": ARTIFACTS["correlation_matrix"],
        "trainingHistory": ARTIFACTS["training_history"],
        "metroPriceIndex": ARTIFACTS["metro_price_index"],
        "modelMetrics": ARTIFACTS["metrics"],
    }


@app.post("/api/predict", response_model=dict[str, Any])
def predict(request: PredictionRequest) -> dict[str, Any]:
    try:
        return predict_price(ARTIFACTS, request)
    except Exception as exc:  # pragma: no cover - defensive path
        raise HTTPException(status_code=500, detail=str(exc)) from exc
