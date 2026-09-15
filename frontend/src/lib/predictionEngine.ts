import {
  ApiClientError,
  ApiServerError,
  ApiUnreachableError,
  ApiValidationError,
  SERVER_ERROR_MESSAGE,
  VALIDATION_MESSAGE,
  apiRequest,
} from "@/lib/api";
import type { Metrics, ValidatedRegion } from "@/lib/regions";

/** Body of POST /api/predict (backend/schemas.py::PredictionRequest). */
export interface PredictionInput {
  region: string;
  zipcode: string;
  sqft: number;
  bedrooms: number;
  bathrooms: number;
  ageYears: number;
  // Not every region's dataset has these - see InputDomain in
  // frontend/src/lib/regions.ts and backend/features.py::OPTIONAL_FIELDS.
  grade?: number;
  view?: number;
  waterfront?: boolean;
}

export interface PredictionFactor {
  feature: string;
  label: string;
  contribution: number;
  share: number;
}

export type Tier = "Budget" | "Mid-Range" | "Luxury";

export interface ModelPrediction {
  source: "model";
  region: string;
  regionLabel: string;
  modelVersion: string;
  price: number;
  priceBasis: string;
  pricePerSqft: number;
  zipMedianPricePerSqft: number;
  interval: { low: number; high: number; nominalCoverage: number; empiricalCoverage: number; method: string };
  tier: {
    label: Tier;
    percentile: number;
    budgetBelow: number;
    luxuryFrom: number;
    referenceSales: number;
    reference: string;
  };
  factors: PredictionFactor[];
}

/** Used only when the API is unreachable. A documented baseline (zip median
 * $/sqft x sqft) whose accuracy was measured on the same test split - not the
 * trained model, and labelled as such everywhere it is shown. */
export interface OfflineEstimate {
  source: "offline-estimate";
  region: string;
  regionLabel: string;
  price: number;
  priceBasis: string;
  pricePerSqft: number;
  zipMedianPricePerSqft: number;
  baseline: { method: string; metrics: Metrics };
}

export type PredictionResult = ModelPrediction | OfflineEstimate;

export const OFFLINE_MESSAGE = "Offline estimate — live model unavailable.";

export function offlineEstimate(input: PredictionInput, region: ValidatedRegion): OfflineEstimate {
  const pricePerSqft = region.offlineBaseline.zipMedianPricePerSqft[input.zipcode];
  if (pricePerSqft === undefined) {
    throw new ApiClientError(0, `No offline baseline is available for zip code ${input.zipcode}.`);
  }
  return {
    source: "offline-estimate",
    region: region.key,
    regionLabel: region.label,
    price: Math.round(pricePerSqft * input.sqft),
    priceBasis: region.model.dataset.priceBasis,
    pricePerSqft: Math.round(pricePerSqft),
    zipMedianPricePerSqft: Math.round(pricePerSqft),
    baseline: { method: region.offlineBaseline.method, metrics: region.offlineBaseline.metrics },
  };
}

export async function predictPrice(input: PredictionInput, region: ValidatedRegion): Promise<PredictionResult> {
  try {
    const data = await apiRequest<Omit<ModelPrediction, "source">>("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return { ...data, source: "model" };
  } catch (error) {
    // Validation and server errors propagate: they must be shown as what they are.
    if (!(error instanceof ApiUnreachableError)) throw error;
    console.warn(
      "[predictPrice] API unreachable - showing the offline baseline estimate. " +
        "Start the backend with `npm run dev:api` (or `npm run dev:full`).",
      error,
    );
    return offlineEstimate(input, region);
  }
}

export function describePredictionError(error: unknown): { kind: "validation" | "client" | "server"; message: string } {
  if (error instanceof ApiValidationError) {
    return { kind: "validation", message: [VALIDATION_MESSAGE, ...error.formErrors].join(" ") };
  }
  if (error instanceof ApiServerError) return { kind: "server", message: SERVER_ERROR_MESSAGE };
  if (error instanceof ApiClientError) return { kind: "client", message: error.message };
  return { kind: "server", message: SERVER_ERROR_MESSAGE };
}

export function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function formatCurrencyFull(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export function formatPercent(fraction: number, digits = 0) {
  return `${(fraction * 100).toFixed(digits)}%`;
}
