// Hand-written test fixtures shaped like the API's responses. Numbers here are
// arbitrary test values, not model results.
import type { ModelPrediction } from "@/lib/predictionEngine";
import type { RegionEntry, ValidatedRegion } from "@/lib/regions";

const metrics = { r2: 0.85, mae: 80000, rmse: 140000, mape: 15, n: 4000 };

export const validatedRegion: ValidatedRegion = {
  key: "seattle",
  label: "Seattle / King County, WA",
  status: "validated",
  model: {
    region: "seattle",
    regionLabel: "Seattle / King County, WA",
    modelVersion: "2.0.0",
    trainedAt: "2026-09-15T00:00:00+00:00",
    algorithm: "RandomForestRegressor",
    hyperparameters: { n_estimators: 100, max_depth: 18, min_samples_leaf: 3 },
    features: [{ name: "sqft_living", label: "Square Footage" }],
    dataset: {
      name: "Fixture dataset",
      provenance: "fixture",
      license: "fixture",
      sha256: "0",
      timeSpan: "2014-05-02 to 2015-05-27",
      priceBasis: "Fixture price basis",
      rawRows: 100,
      rowsAfterCleaning: 99,
      removedImpossibleRows: 1,
    },
    split: {
      method: "grouped",
      testFraction: 0.2,
      trainRows: 80,
      testRows: 19,
      propertiesSoldMoreThanOnce: 0,
      propertiesInBothSplits: 0,
      trainRowsUsed: 79,
    },
    interval: { method: "fixture", nominalCoverage: 0.8 },
    evaluation: {
      pipeline: "fixture",
      testRows: 19,
      admittedRows: 18,
      metrics,
      baseline: { name: "Zip-code median $/sqft", metrics: { ...metrics, r2: 0.77 } },
      interval: { nominalCoverage: 0.8, empiricalCoverage: 0.802, medianRelativeWidth: 0.44 },
      predictedTierShare: { Budget: 0.3, "Mid-Range": 0.4, Luxury: 0.3 },
    },
  },
  inputDomain: {
    zipcodes: ["98001", "98103"],
    sqft: { min: 500, max: 8000 },
    bedrooms: { min: 0, max: 10 },
    bathrooms: { min: 1, max: 8, step: 1 },
    ageYears: { min: 0, max: 115 },
    grade: { min: 4, max: 13, labels: { "4": "Low", "7": "Average", "13": "Mansion" } },
    view: { min: 0, max: 4, labels: { "0": "None", "4": "Excellent" } },
    waterfront: true,
  },
  offlineBaseline: { method: "Zip-code median $/sqft x square footage", metrics, zipMedianPricePerSqft: { "98001": 150, "98103": 300 } },
};

// A region whose dataset has a construction-grade rating but no view rating
// or waterfront flag - exercises the optional-field paths (e.g. Chicago).
export const validatedRegionWithoutViewOrWaterfront: ValidatedRegion = {
  ...validatedRegion,
  key: "chicago",
  label: "Chicago / Cook County, IL",
  model: { ...validatedRegion.model, region: "chicago", regionLabel: "Chicago / Cook County, IL" },
  inputDomain: {
    ...validatedRegion.inputDomain,
    grade: { min: 1, max: 3, labels: { "1": "Deluxe", "2": "Average", "3": "Poor" } },
    view: undefined,
    waterfront: false,
  },
};

export const regions: RegionEntry[] = [
  validatedRegion,
  { key: "austin", label: "Austin, TX", status: "unavailable", message: "Prediction unavailable for this region — insufficient validated training data." },
];

export function modelPrediction(overrides: Partial<ModelPrediction> = {}): ModelPrediction {
  return {
    source: "model",
    region: "seattle",
    regionLabel: "Seattle / King County, WA",
    modelVersion: "2.0.0",
    price: 470000,
    priceBasis: "Fixture price basis",
    pricePerSqft: 261,
    zipMedianPricePerSqft: 300,
    interval: { low: 370000, high: 577000, nominalCoverage: 0.8, empiricalCoverage: 0.802, method: "fixture" },
    tier: { label: "Mid-Range", percentile: 53.3, budgetBelow: 360000, luxuryFrom: 565000, referenceSales: 17260, reference: "fixture" },
    factors: [{ feature: "grade", label: "Construction Grade", contribution: -20000, share: 0.4 }],
    ...overrides,
  };
}
