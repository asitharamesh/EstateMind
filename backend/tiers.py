"""Budget / Mid-Range / Luxury, relative to one region's own market.

A predicted price is ranked against that region's training-split sale prices.
Both numbers are in the same price space (the region's dataset, same period,
nominal dollars) - nothing is inflated, deflated or rescaled on either side.
"""
from dataclasses import dataclass

import numpy as np

BUDGET_BELOW_PERCENTILE = 100 / 3
LUXURY_FROM_PERCENTILE = 200 / 3
TIERS = ("Budget", "Mid-Range", "Luxury")


@dataclass(frozen=True)
class PriceReference:
    sorted_prices: np.ndarray
    description: str

    @classmethod
    def from_prices(cls, prices, description: str) -> "PriceReference":
        values = np.sort(np.asarray(prices, dtype=float))
        if values.size == 0:
            raise ValueError("A price reference needs at least one sale")
        return cls(values, description)

    def percentile(self, price: float) -> float:
        """Mid-rank empirical percentile (ties count half), 0-100."""
        below = np.searchsorted(self.sorted_prices, price, side="left")
        at_or_below = np.searchsorted(self.sorted_prices, price, side="right")
        return float(100 * (below + at_or_below) / 2 / self.sorted_prices.size)

    def cutoffs(self) -> tuple[float, float]:
        low, high = np.percentile(self.sorted_prices, [BUDGET_BELOW_PERCENTILE, LUXURY_FROM_PERCENTILE])
        return float(low), float(high)


def tier_for_percentile(percentile: float) -> str:
    if percentile < BUDGET_BELOW_PERCENTILE:
        return "Budget"
    if percentile >= LUXURY_FROM_PERCENTILE:
        return "Luxury"
    return "Mid-Range"


def classify(price: float, reference: PriceReference) -> dict:
    percentile = reference.percentile(price)
    budget_max, luxury_min = reference.cutoffs()
    return {
        "label": tier_for_percentile(percentile),
        "percentile": round(percentile, 1),
        "budgetBelow": round(budget_max),
        "luxuryFrom": round(luxury_min),
        "referenceSales": int(reference.sorted_prices.size),
        "reference": reference.description,
    }
