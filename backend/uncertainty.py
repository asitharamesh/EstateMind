"""Calibrated prediction interval.

The previous range was the 10th-90th percentile of individual tree
predictions. That describes disagreement between trees, not error against
real sale prices, and covered only ~68% of held-out sales.

This interval is calibrated on out-of-bag (OOB) predictions: every training
sale is predicted only by trees that never saw it, the log residuals
log(actual / predicted) are collected, and their (1-c)/2 and (1+c)/2 quantiles
become a multiplicative band. Its real coverage is then *measured* on the
untouched test split and reported next to the nominal target.
"""
from dataclasses import dataclass

import numpy as np

METHOD = "Out-of-bag log-residual quantiles (training split), coverage measured on held-out test sales"


@dataclass(frozen=True)
class PredictionInterval:
    nominal_coverage: float
    log_low: float
    log_high: float
    calibration_rows: int

    @classmethod
    def calibrate(cls, actual, oob_predicted, nominal_coverage: float) -> "PredictionInterval":
        actual = np.asarray(actual, dtype=float)
        oob_predicted = np.asarray(oob_predicted, dtype=float)
        # sklearn leaves a row's OOB prediction at 0 if every tree saw it.
        usable = np.isfinite(oob_predicted) & (oob_predicted > 0)
        residuals = np.log(actual[usable] / oob_predicted[usable])
        tail = (1 - nominal_coverage) / 2
        low, high = np.quantile(residuals, [tail, 1 - tail])
        return cls(float(nominal_coverage), float(low), float(high), int(usable.sum()))

    def bounds(self, predicted):
        predicted = np.asarray(predicted, dtype=float)
        return predicted * np.exp(self.log_low), predicted * np.exp(self.log_high)

    def coverage(self, actual, predicted) -> float:
        low, high = self.bounds(predicted)
        actual = np.asarray(actual, dtype=float)
        return float(np.mean((actual >= low) & (actual <= high)))

    def to_dict(self) -> dict:
        return {
            "method": METHOD,
            "nominalCoverage": self.nominal_coverage,
            "logLow": self.log_low,
            "logHigh": self.log_high,
            "calibrationRows": self.calibration_rows,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PredictionInterval":
        return cls(float(data["nominalCoverage"]), float(data["logLow"]), float(data["logHigh"]), int(data["calibrationRows"]))
