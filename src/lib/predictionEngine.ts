export type PropertyType = "apartment" | "house" | "villa" | "studio";

export interface PredictionInput {
  sqft: number;
  bedrooms: number;
  city: string;
  ageYears: number;
  propertyType: PropertyType;
}

export interface PredictionResult {
  price: number;
  pricePerSqft: number;
  marketAvgPerSqft: number;
  tier: "Budget" | "Mid-Range" | "Luxury";
  tierScore: number;
  confidence: number;
  factors: {
    location: number;
    size: number;
    bedrooms: number;
    age: number;
    type: number;
  };
  range: { low: number; high: number };
}

export const CITIES: Record<
  string,
  { multiplier: number; baseSqft: number; label: string; region: string }
> = {
  "san-francisco": { multiplier: 2.85, baseSqft: 1100, label: "San Francisco", region: "West Coast" },
  "new-york": { multiplier: 2.7, baseSqft: 1250, label: "New York", region: "East Coast" },
  "los-angeles": { multiplier: 2.2, baseSqft: 850, label: "Los Angeles", region: "West Coast" },
  "seattle": { multiplier: 1.85, baseSqft: 720, label: "Seattle", region: "West Coast" },
  "boston": { multiplier: 1.95, baseSqft: 780, label: "Boston", region: "East Coast" },
  "miami": { multiplier: 1.6, baseSqft: 620, label: "Miami", region: "South" },
  "austin": { multiplier: 1.45, baseSqft: 540, label: "Austin", region: "South" },
  "chicago": { multiplier: 1.25, baseSqft: 460, label: "Chicago", region: "Midwest" },
  "denver": { multiplier: 1.4, baseSqft: 520, label: "Denver", region: "Mountain" },
  "atlanta": { multiplier: 1.15, baseSqft: 410, label: "Atlanta", region: "South" },
  "dallas": { multiplier: 1.2, baseSqft: 430, label: "Dallas", region: "South" },
  "phoenix": { multiplier: 1.1, baseSqft: 390, label: "Phoenix", region: "Southwest" },
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

export function getGaugeAngle(score: number): number {
  const normalizedScore = clamp(score, 0, 100);
  return -90 + (normalizedScore / 100) * 180;
}

export function normalizeInput(input: PredictionInput): PredictionInput {
  return {
    ...input,
    sqft: clamp(input.sqft, 500, 6000),
    bedrooms: clamp(input.bedrooms, 1, 6),
    ageYears: clamp(input.ageYears, 0, 80),
  };
}

function fallbackPredict(input: PredictionInput): PredictionResult {
  const normalizedInput = normalizeInput(input);
  const city = CITIES[normalizedInput.city] ?? CITIES["austin"];
  const baseSqft = city.baseSqft;
  const bedFactor = 0.92 + Math.log2(normalizedInput.bedrooms + 1) * 0.09;
  const ageFactor = clamp(1 - normalizedInput.ageYears * 0.007, 0.75, 1.05);
  const typeFactor = PROPERTY_TYPE_MULT[normalizedInput.propertyType];
  const sizeFactor = clamp(1.05 - (normalizedInput.sqft - 1500) / 25000, 0.88, 1.08);
  const pricePerSqft = baseSqft * bedFactor * ageFactor * typeFactor * sizeFactor;
  const price = Math.round(pricePerSqft * normalizedInput.sqft);
  const marketAvgPerSqft = Math.round(baseSqft * city.multiplier * 0.55);
  const tierScore = clamp(Math.log10(price / 100000) * 35, 0, 100);
  const tier = getTierFromScore(tierScore);
  const rawLocation = city.multiplier * 30;
  const rawSize = (normalizedInput.sqft / 1000) * 18;
  const rawBeds = normalizedInput.bedrooms * 6;
  const rawAge = Math.max(0, 25 - normalizedInput.ageYears * 0.6);
  const rawType = typeFactor * 18;
  const sum = rawLocation + rawSize + rawBeds + rawAge + rawType;
  const factors = {
    location: Math.round((rawLocation / sum) * 100),
    size: Math.round((rawSize / sum) * 100),
    bedrooms: Math.round((rawBeds / sum) * 100),
    age: Math.round((rawAge / sum) * 100),
    type: Math.round((rawType / sum) * 100),
  };
  const sqftPenalty = normalizedInput.sqft < 500 || normalizedInput.sqft > 6000 ? 15 : 0;
  const agePenalty = normalizedInput.ageYears > 80 ? 10 : 0;
  const confidence = clamp(94 - sqftPenalty - agePenalty, 60, 97);
  const spread = (1 - confidence / 100) * 1.4;
  const range = {
    low: Math.round(price * (1 - spread)),
    high: Math.round(price * (1 + spread)),
  };

  return {
    price,
    pricePerSqft: Math.round(pricePerSqft),
    marketAvgPerSqft,
    tier,
    tierScore,
    confidence,
    factors,
    range,
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
      body: JSON.stringify({
        sqft: normalizedInput.sqft,
        bedrooms: normalizedInput.bedrooms,
        city: normalizedInput.city,
        ageYears: normalizedInput.ageYears,
        propertyType: normalizedInput.propertyType,
      }),
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
      };
    }
  } catch {
    // Fall back to the deterministic local model when the API is unavailable.
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

export const FEATURE_IMPORTANCE = [
  { feature: "Location (City)", importance: 0.32 },
  { feature: "Square Footage", importance: 0.27 },
  { feature: "Bedrooms", importance: 0.11 },
  { feature: "Property Type", importance: 0.1 },
  { feature: "Property Age", importance: 0.08 },
  { feature: "Lot Size", importance: 0.05 },
  { feature: "School Rating", importance: 0.04 },
  { feature: "Crime Index", importance: 0.03 },
];

export const CORRELATION_FEATURES = ["Price", "SqFt", "Beds", "Age", "Loc", "Type"];

export const CORRELATION_MATRIX: number[][] = [
  [1.0, 0.78, 0.62, -0.41, 0.71, 0.45],
  [0.78, 1.0, 0.69, -0.18, 0.22, 0.38],
  [0.62, 0.69, 1.0, -0.12, 0.15, 0.41],
  [-0.41, -0.18, -0.12, 1.0, -0.09, -0.22],
  [0.71, 0.22, 0.15, -0.09, 1.0, 0.19],
  [0.45, 0.38, 0.41, -0.22, 0.19, 1.0],
];

export const TRAINING_HISTORY = Array.from({ length: 20 }, (_, i) => {
  const epoch = i + 1;
  return {
    epoch,
    train: +(0.55 + Math.log10(epoch + 1) * 0.22 + (i > 12 ? 0.04 : 0)).toFixed(3),
    val: +(0.52 + Math.log10(epoch + 1) * 0.21).toFixed(3),
  };
});
