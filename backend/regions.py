"""Region registry: which housing markets the product knows about, and which
of them are backed by a real, validated training dataset.

Each region is served by its own model, trained only on that region's sales.
A region without a dataset is listed (so the UI can say so) but can never
produce a prediction - there is no cross-region multiplier fallback.
"""
from dataclasses import dataclass

from backend.datasets import CHICAGO, KING_COUNTY, DatasetSource

UNAVAILABLE_MESSAGE = "Prediction unavailable for this region — insufficient validated training data."


@dataclass(frozen=True)
class RegionDefinition:
    key: str
    label: str
    dataset: DatasetSource | None

    @property
    def has_dataset(self) -> bool:
        return self.dataset is not None


REGIONS: dict[str, RegionDefinition] = {
    region.key: region
    for region in [
        RegionDefinition("seattle", "Seattle / King County, WA", KING_COUNTY),
        RegionDefinition("chicago", "Chicago / Cook County, IL", CHICAGO),
        # No legitimate, compatible sale-level dataset is in the repository for
        # these markets. Add a DatasetSource + adapter in backend/datasets.py,
        # train, and the region becomes available - nothing else changes.
        RegionDefinition("san-francisco", "San Francisco Bay Area, CA", None),
        RegionDefinition("los-angeles", "Los Angeles, CA", None),
        RegionDefinition("austin", "Austin, TX", None),
        RegionDefinition("new-york", "New York City, NY", None),
    ]
}
