import { ApiUnreachableError, apiRequest } from "@/lib/api";

export interface Metrics {
  r2: number;
  mae: number;
  rmse: number;
  mape: number;
  n: number;
}

/** backend/assets/regions/<region>/model_card.json, written by train_model.py. */
export interface ModelCard {
  region: string;
  regionLabel: string;
  modelVersion: string;
  trainedAt: string;
  algorithm: string;
  hyperparameters: Record<string, number>;
  features: { name: string; label: string }[];
  dataset: {
    name: string;
    provenance: string;
    license: string;
    sha256: string;
    timeSpan: string;
    priceBasis: string;
    rawRows: number;
    rowsAfterCleaning: number;
    removedImpossibleRows: number;
  };
  split: {
    method: string;
    testFraction: number;
    trainRows: number;
    testRows: number;
    propertiesSoldMoreThanOnce: number;
    propertiesInBothSplits: number;
    trainRowsUsed: number;
  };
  interval: { method: string; nominalCoverage: number };
  evaluation: {
    pipeline: string;
    testRows: number;
    admittedRows: number;
    metrics: Metrics;
    baseline: { name: string; metrics: Metrics };
    interval: { nominalCoverage: number; empiricalCoverage: number; medianRelativeWidth: number };
    predictedTierShare: Record<string, number>;
  };
}

export interface NumericRange {
  min: number;
  max: number;
}

export interface OrdinalScale extends NumericRange {
  labels: Record<string, string>;
}

export interface InputDomain {
  zipcodes: string[];
  sqft: NumericRange;
  bedrooms: NumericRange;
  bathrooms: NumericRange & { step: number };
  ageYears: NumericRange;
  /** Present only when this region's dataset has a construction-grade
   * rating - not every region's does (backend/features.py::OPTIONAL_FIELDS). */
  grade?: OrdinalScale;
  /** Present only when this region's dataset has a rated view field. */
  view?: OrdinalScale;
  /** Whether this region's dataset records a waterfront flag. */
  waterfront: boolean;
}

export interface ValidatedRegion {
  key: string;
  label: string;
  status: "validated";
  model: ModelCard;
  inputDomain: InputDomain;
  offlineBaseline: { method: string; metrics: Metrics; zipMedianPricePerSqft: Record<string, number> };
}

export interface UnavailableRegion {
  key: string;
  label: string;
  status: "unavailable";
  message: string;
}

export type RegionEntry = ValidatedRegion | UnavailableRegion;

export interface RegionCatalog {
  note: string;
  regions: RegionEntry[];
}

export interface LoadedCatalog {
  catalog: RegionCatalog;
  /** "snapshot" = the API was unreachable and the static copy written by the
   * last training run was used instead. */
  source: "api" | "snapshot";
}

export function isValidated(region: RegionEntry): region is ValidatedRegion {
  return region.status === "validated";
}

export async function fetchRegionCatalog(): Promise<LoadedCatalog> {
  try {
    return { catalog: await apiRequest<RegionCatalog>("/api/regions"), source: "api" };
  } catch (error) {
    if (!(error instanceof ApiUnreachableError)) throw error;
    const response = await fetch("/data/regions.json");
    if (!response.ok) throw error;
    return { catalog: (await response.json()) as RegionCatalog, source: "snapshot" };
  }
}

export interface RegionInsights {
  region: string;
  featureImportance: { feature: string; importance: number }[];
  correlationMatrix: { features: string[]; matrix: number[][] };
  trainingHistory: { estimators: number; trainR2: number; oobR2: number }[];
}

export function fetchRegionInsights(region: string): Promise<RegionInsights> {
  return apiRequest<RegionInsights>(`/api/regions/${encodeURIComponent(region)}/insights`);
}
