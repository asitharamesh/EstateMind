export type PropertyType = "apartment" | "house" | "villa" | "studio";

export interface PredictionInput {
  sqft: number;
  bedrooms: number;
  bathrooms: number;
  city: string;
  ageYears: number;
  propertyType: PropertyType;
}

export interface PredictionFactor {
  feature: string;
  label: string;
  contribution: number;
  share: number;
}

export interface PredictionResult {
  price: number;
  pricePerSqft: number;
  marketAvgPerSqft: number;
  tier: "Budget" | "Mid-Range" | "Luxury";
  tierScore: number;
  confidence: number;
  factors: PredictionFactor[];
  range: { low: number; high: number };
  metro?: {
    city: string;
    metro: string;
    scaleVsTrainingMetro: number;
    source: string;
    asOf: string;
  };
  /** "model" when served by the live FastAPI + Random Forest backend,
   * "offline-estimate" when the app fell back to the local heuristic
   * because the backend was unreachable. Surface this in the UI so a
   * fallback number is never presented as if it were the real model. */
  source: "model" | "offline-estimate";
}

// Display metadata only (labels/regions for the dropdown) - no pricing
// numbers live here. Real per-metro pricing comes from the backend's
// metro_price_index.json, which is derived from Zillow's public ZHVI data
// at training time (see backend/scripts/train_model.py).
export const CITIES: Record<string, { label: string; region: string }> = {
  "san-francisco": { label: "San Francisco", region: "West Coast" },
  "new-york": { label: "New York", region: "East Coast" },
  "los-angeles": { label: "Los Angeles", region: "West Coast" },
  "seattle": { label: "Seattle", region: "West Coast" },
  "boston": { label: "Boston", region: "East Coast" },
  "miami": { label: "Miami", region: "South" },
  "austin": { label: "Austin", region: "South" },
  "chicago": { label: "Chicago", region: "Midwest" },
  "denver": { label: "Denver", region: "Mountain" },
  "atlanta": { label: "Atlanta", region: "South" },
  "dallas": { label: "Dallas", region: "South" },
  "phoenix": { label: "Phoenix", region: "Southwest" },
};

// Shared property-type display labels, so the form, the result card, and
// the comparison view all describe the same value the same way.
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  studio: "Studio",
  apartment: "Apartment",
  house: "House",
  villa: "Villa",
};

const PROPERTY_TYPE_MULT: Record<PropertyType, number> = {
  studio: 0.85,
  apartment: 1.0,
  house: 1.18,
  villa: 1.45,
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function getTierFromScore(score: number): PredictionResult["tier"] {
  const normalizedScore = clamp(score, 0, 100);
  if (normalizedScore < 38) return "Budget";
  if (normalizedScore < 70) return "Mid-Range";
  return "Luxury";
}

export function normalizeInput(input: PredictionInput): PredictionInput {
  return {
    ...input,
    sqft: Math.round(clamp(input.sqft, 500, 8000)),
    bedrooms: Math.round(clamp(input.bedrooms, 0, 10)),
    // Whole bathrooms only - see PredictionForm.tsx and backend/schemas.py.
    bathrooms: Math.round(clamp(input.bathrooms, 1, 8)),
    ageYears: Math.round(clamp(input.ageYears, 0, 115)),
  };
}

let cachedMetroIndex: Record<string, { zhviLatest: number; scaleVsTrainingMetro: number }> | null = null;

/**
 * Offline fallback only: used when the FastAPI backend cannot be reached.
 * It reuses the same real, cited Zillow metro index the backend trains
 * with (fetched from the static /data/metro-price-index.json snapshot
 * written by backend/scripts/train_model.py) so even the fallback numbers are
 * anchored to real published data rather than an invented per-city
 * multiplier. If that snapshot itself can't be loaded, this throws rather
 * than silently guessing - callers must treat total failure as "no
 * estimate available".
 */
async function loadMetroIndex() {
  if (cachedMetroIndex) return cachedMetroIndex;
  const response = await fetch("/data/metro-price-index.json");
  if (!response.ok) throw new Error("Metro price index unavailable");
  const data = await response.json();
  cachedMetroIndex = data.cities;
  return cachedMetroIndex!;
}

async function fallbackPredict(input: PredictionInput): Promise<PredictionResult> {
  const normalizedInput = normalizeInput(input);
  const metroIndex = await loadMetroIndex();
  const metro = metroIndex[normalizedInput.city] ?? metroIndex["seattle"];

  // Rough physical-value heuristic (NOT the trained model): a simple
  // price-per-sqft baseline scaled by the same real Zillow metro ratio the
  // backend uses. This exists purely so the UI degrades gracefully when the
  // API is down - it is always labeled `source: "offline-estimate"`.
  const basePricePerSqft = 220; // derived from the real training data's
  // overall price/sqft_living average (~King County, 2014-15); see README.
  const typeFactor = PROPERTY_TYPE_MULT[normalizedInput.propertyType];
  const ageFactor = clamp(1 - normalizedInput.ageYears * 0.004, 0.7, 1.05);
  const bedBathFactor = 0.85 + Math.log2(normalizedInput.bedrooms + normalizedInput.bathrooms + 1) * 0.08;

  const trainingMetroPrice =
    basePricePerSqft * normalizedInput.sqft * typeFactor * ageFactor * bedBathFactor;
  const price = Math.round(trainingMetroPrice * metro.scaleVsTrainingMetro);
  const pricePerSqft = Math.round(price / normalizedInput.sqft);
  const marketAvgPerSqft = Math.round(metro.zhviLatest / 1910);

  const ratioToMetro = price / metro.zhviLatest;
  const tierScore = clamp(ratioToMetro * 50, 0, 100);
  const tier = ratioToMetro < 0.7 ? "Budget" : ratioToMetro >= 1.4 ? "Luxury" : "Mid-Range";

  const confidence = 55; // fixed, low: this is a heuristic, not a model - we
  // don't pretend to know its uncertainty the way we do for the real
  // tree-ensemble spread the backend reports.
  const spread = 0.35;

  return {
    price,
    pricePerSqft,
    marketAvgPerSqft,
    tier,
    tierScore,
    confidence,
    factors: [],
    range: {
      low: Math.round(price * (1 - spread)),
      high: Math.round(price * (1 + spread)),
    },
    source: "offline-estimate",
  };
}

export async function predictPrice(input: PredictionInput): Promise<PredictionResult> {
  const normalizedInput = normalizeInput(input);
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  const url = `${baseUrl}/api/predict`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedInput),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        price: data.price,
        pricePerSqft: data.pricePerSqft,
        marketAvgPerSqft: data.marketAvgPerSqft,
        tier: data.tier,
        tierScore: data.tierScore,
        confidence: data.confidence,
        factors: data.factors,
        range: data.range,
        metro: data.metro,
        source: "model",
      };
    }
    console.warn(
      `[predictPrice] ${url} responded ${response.status} - using the offline heuristic instead. ` +
        "Is the backend running? (`npm run dev:api`, or `npm run dev:full` to start both.)",
    );
  } catch (err) {
    console.warn(
      `[predictPrice] could not reach ${url} - using the offline heuristic instead. ` +
        "Is the backend running? (`npm run dev:api`, or `npm run dev:full` to start both.)",
      err,
    );
  }

  return fallbackPredict(normalizedInput);
}

export function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function formatCurrencyFull(n: number) {
  return `$${n.toLocaleString()}`;
}

export interface ModelInsights {
  featureImportance: { feature: string; importance: number }[];
  correlationMatrix: { features: string[]; matrix: number[][] };
  trainingHistory: { estimators: number; trainR2: number; oobR2: number }[];
  metroPriceIndex: {
    source: string;
    sourceUrl: string;
    trainingMetro: string;
    trainingReferenceDate: string;
    latestDate: string;
    cities: Record<string, { metro: string; zhviLatest: number; scaleVsTrainingMetro: number }>;
  };
}

/** Real model internals (feature importances, correlation matrix, learning
 * curve, cited metro index) computed once at training time by
 * backend/scripts/train_model.py and served by the backend - nothing here is
 * hardcoded in the frontend. */
export async function fetchModelInsights(): Promise<ModelInsights> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/model-insights`);
  if (!response.ok) {
    throw new Error("Unable to load model insights");
  }
  return response.json();
}
