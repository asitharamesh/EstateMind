"""Dataset adapters: turn a raw regional dataset into canonical property records.

A canonical record has exactly the fields the application collects from a
user (see backend/features.py::CANONICAL_FIELDS), plus the sale price and a
property identifier used for leakage-free splitting. Everything downstream of
this module - training, evaluation and live inference - works on canonical
records only, so a new region only needs a new adapter here.
"""
import hashlib
import os
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class DatasetSource:
    key: str
    name: str
    url: str
    sha256: str
    default_path: Path
    provenance: str
    license_note: str
    time_span: str
    price_basis: str
    grade_scale: dict[int, str] = field(default_factory=dict)
    view_scale: dict[int, str] = field(default_factory=dict)
    # Which of backend/features.py::OPTIONAL_FIELDS this dataset genuinely
    # provides a per-sale value for. A region's model is only ever fitted on
    # and asked for the fields its own dataset actually has - see
    # backend/features.py::FeatureSpec.fields.
    optional_fields: frozenset[str] = frozenset({"grade", "view", "waterfront"})

    @property
    def path(self) -> Path:
        raw = os.getenv("DATASET_PATH")
        if not raw:
            return self.default_path
        candidate = Path(raw)
        return candidate if candidate.is_absolute() else BACKEND_DIR / candidate


# King County Assessor building-grade scale. It is specific to this county's
# assessment process - "grade 7" means nothing outside King County, which is
# one reason other regions need their own datasets rather than reusing it.
KING_COUNTY_GRADES = {
    1: "Cabin / fails minimum building standards",
    2: "Cabin / fails minimum building standards",
    3: "Cabin / fails minimum building standards",
    4: "Older, low-quality construction",
    5: "Low construction cost and workmanship",
    6: "Lowest grade meeting current building code",
    7: "Average construction and design",
    8: "Just above average",
    9: "Better architectural design and finishes",
    10: "High-quality features",
    11: "Custom design, higher-quality finish work",
    12: "Custom design, excellent builders",
    13: "Custom designed and built, mansion level",
}

KING_COUNTY_VIEWS = {
    0: "No rated view",
    1: "Fair",
    2: "Average",
    3: "Good",
    4: "Excellent",
}

KING_COUNTY = DatasetSource(
    key="king-county-2014-2015",
    name="House Sales in King County, USA",
    url=os.getenv(
        "DATASET_URL",
        "https://raw.githubusercontent.com/karan-shah/usa-housing-dataset/master/kc_house_data.csv",
    ),
    sha256="d0875baa0251b21d4bdc9d2ae940a4fe0bb6009824f23dd0e2a5b2bf04557b7e",
    default_path=BACKEND_DIR / "assets" / "kc_house_data.csv",
    provenance=(
        "King County, WA recorded home sales, published on Kaggle as 'House Sales in King County, USA'; "
        "downloaded from a third-party GitHub mirror and pinned by SHA-256."
    ),
    license_note="Listed as CC0 (public domain) on Kaggle. Verify before any commercial use.",
    time_span="2014-05-02 to 2015-05-27",
    price_basis="Nominal USD sale prices, May 2014 - May 2015 (not adjusted to today's market)",
    grade_scale=KING_COUNTY_GRADES,
    view_scale=KING_COUNTY_VIEWS,
)

# Cook County Assessor construction-quality rating - the closest genuine
# equivalent this dataset has to King County's assessor grade. It is a
# 3-level rating, not the 13-level King County scale, and specific to how
# Cook County's assessor records it - it does not transfer to other markets
# any more than King County's grade does.
COOK_COUNTY_QUALITY = {
    1: "Deluxe",
    2: "Average",
    3: "Poor",
}

CHICAGO = DatasetSource(
    key="cook-county-2018-2019",
    name="Cook County Assessor Residential Sales (single-family)",
    # This is the upstream API `default_path` was derived from, kept for
    # provenance - unlike KING_COUNTY's url, fetching it does NOT reproduce
    # the pinned file byte-for-byte (this project's own ZIP-join step isn't a
    # single downloadable resource), so ensure_dataset() only ever validates
    # the checksum of the file already committed at default_path.
    url="https://datacatalog.cookcountyil.gov/resource/5pge-nu6u.json",
    sha256="0d7af60e4d4604214eb39b07989f27576cbf72e08ba27ca217ef08266c55b6e5",
    default_path=BACKEND_DIR / "assets" / "chicago_house_data.csv",
    provenance=(
        "Cook County, IL (Chicago metro) Assessor's Office open data, 'Assessor [Archived] - Residential Sales "
        "Data' (single-family parcels, modeling_group='SF'), filtered to sale_price > $10,000. This project's own "
        "extract (backend/assets/chicago_house_data.csv, pinned by SHA-256) additionally assigns each sale a 5-digit "
        "ZIP code via a point-in-polygon join of the parcel centroid against the Census Bureau's 2020 cartographic "
        "ZCTA5 boundaries (cb_2020_us_zcta520_500k) - the source data has no ZIP field, only a lat/long centroid. "
        "'age' is the assessor's current effective age of the property, not necessarily its age at the historical "
        "sale date (the source does not publish year built), unlike King County's age-at-sale."
    ),
    license_note="Published by Cook County government as open data. Verify current terms before any commercial use.",
    time_span="2018-10-16 to 2019-12-31",
    price_basis="Nominal USD sale prices, Oct 2018 - Dec 2019 (not adjusted to today's market)",
    grade_scale=COOK_COUNTY_QUALITY,
    optional_fields=frozenset({"grade"}),
)

# A sale recorded with fewer square feet per bedroom than this is physically
# impossible rather than unusual. In this dataset it removes exactly one row:
# id 2402100895, 33 bedrooms in 1,620 sqft (a typo for 3). The next-lowest
# ratio in the data is 163 sqft/bedroom.
MIN_SQFT_PER_BEDROOM = 120


class DatasetChecksumError(RuntimeError):
    pass


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_dataset(source: DatasetSource) -> Path:
    """Download the dataset if absent, then refuse to continue unless it is
    byte-identical to the version every reported metric was produced from."""
    path = source.path
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        print(f"Downloading {source.name} from {source.url}")
        urllib.request.urlretrieve(source.url, path)
    actual = sha256_of(path)
    if actual != source.sha256:
        raise DatasetChecksumError(
            f"{path} has SHA-256 {actual}, expected {source.sha256}. The dataset changed upstream; "
            "re-audit it and update the pinned checksum before retraining."
        )
    return path


def drop_impossible_rows(df: pd.DataFrame) -> pd.DataFrame:
    impossible = (df["bedrooms"] > 0) & (df["sqft_living"] / df["bedrooms"] < MIN_SQFT_PER_BEDROOM)
    return df[~impossible]


def load_king_county_records(path: Path) -> pd.DataFrame:
    """Raw King County CSV -> canonical records (+ `property_id`, `price`)."""
    raw = pd.read_csv(path, dtype={"id": str, "zipcode": str})
    df = drop_impossible_rows(raw).copy()

    sale_year = pd.to_datetime(df["date"], format="%Y%m%dT%H%M%S").dt.year
    records = pd.DataFrame(
        {
            # The same house can sell more than once in this window; the id is
            # what lets the split keep every sale of a house on one side.
            "property_id": df["id"],
            "price": df["price"].astype(float),
            "sqft_living": df["sqft_living"].astype(float),
            "bedrooms": df["bedrooms"].astype(int),
            "bathrooms": df["bathrooms"].astype(float),
            # Age at the time of sale - the only age the price label reflects.
            "age": (sale_year - df["yr_built"]).clip(lower=0).astype(int),
            "zipcode": df["zipcode"].str.zfill(5),
            "grade": df["grade"].astype(int),
            "view": df["view"].astype(int),
            "waterfront": df["waterfront"].astype(bool),
        }
    )
    return records.reset_index(drop=True)


def load_chicago_records(path: Path) -> pd.DataFrame:
    """Raw Chicago/Cook County extract -> canonical records (+ `property_id`,
    `price`). No view or waterfront rating exists in this dataset, so those
    columns are left absent - FeatureSpec never requires or uses them for
    this region (CHICAGO.optional_fields == {"grade"})."""
    raw = pd.read_csv(path, dtype={"property_id": str, "zipcode": str})
    records = pd.DataFrame(
        {
            "property_id": raw["property_id"],
            "price": raw["price"].astype(float),
            "sqft_living": raw["sqft_living"].astype(float),
            "bedrooms": raw["bedrooms"].astype(int),
            "bathrooms": raw["bathrooms"].astype(float),
            "age": raw["age"].astype(int),
            "zipcode": raw["zipcode"].str.zfill(5),
            "grade": raw["cnst_qlty"].astype(int),
        }
    )
    return records.reset_index(drop=True)


LOADERS = {
    KING_COUNTY.key: load_king_county_records,
    CHICAGO.key: load_chicago_records,
}
