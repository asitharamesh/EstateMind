import { z } from "zod";
import type { PredictionInput } from "@/lib/predictionEngine";
import type { NumericRange, OrdinalScale, ValidatedRegion } from "@/lib/regions";

/** Raw form state: text inputs stay strings until validated. */
export interface PredictionFormValues {
  region: string;
  zipcode: string;
  sqft: string;
  bedrooms: string;
  bathrooms: string;
  ageYears: number;
  // Empty string / unused when the region's domain doesn't have the field.
  grade: string;
  view: string;
  waterfront: boolean;
}

const NUMBER_PATTERN = /^\d+(\.\d+)?$/;

function numericText(label: string, range: NumericRange, step: number) {
  return z.string().transform((raw, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    const text = raw.trim();
    if (text === "") return fail(`${label} is required`);
    if (!NUMBER_PATTERN.test(text)) return fail("Enter a valid number");
    const value = Number(text);
    if (value < range.min || value > range.max) {
      return fail(`Must be between ${range.min.toLocaleString()} and ${range.max.toLocaleString()}`);
    }
    if (!Number.isInteger(value / step)) {
      return fail(step === 1 ? `${label} must be a whole number` : `${label} must be in steps of ${step}`);
    }
    return value;
  });
}

function ordinal(label: string, scale: OrdinalScale) {
  return z.string().transform((raw, ctx) => {
    const value = Number(raw);
    if (raw === "" || !Number.isInteger(value) || value < scale.min || value > scale.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be between ${scale.min} and ${scale.max}` });
      return z.NEVER;
    }
    return value;
  });
}

/**
 * Client-side mirror of the API contract, built from the region's input
 * domain as reported by the API (itself learned from that region's training
 * data). The API re-validates everything; this only gives faster feedback.
 */
export function buildPredictionSchema(region: ValidatedRegion): z.ZodType<PredictionInput, z.ZodTypeDef, PredictionFormValues> {
  const domain = region.inputDomain;
  const zipcodes = new Set(domain.zipcodes);
  // Cast: with tsconfig `strict: false`, zod infers every output key as optional.
  const schema = z.object({
    region: z.literal(region.key),
    zipcode: z.string().transform((raw, ctx) => {
      const zip = raw.trim();
      if (!/^\d{5}$/.test(zip)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a 5-digit zip code" });
        return z.NEVER;
      }
      if (!zipcodes.has(zip)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${zip} is not a supported zip code for ${region.label}` });
        return z.NEVER;
      }
      return zip;
    }),
    sqft: numericText("Square footage", domain.sqft, 1),
    bedrooms: numericText("Bedrooms", domain.bedrooms, 1),
    bathrooms: numericText("Bathrooms", domain.bathrooms, domain.bathrooms.step),
    ageYears: z.number().int().min(domain.ageYears.min).max(domain.ageYears.max),
    // Undefined (rather than validated) when this region's domain has no
    // such field - the API payload then omits the key entirely, matching
    // what a region without the field expects.
    grade: domain.grade ? ordinal("Grade", domain.grade) : z.string().transform(() => undefined),
    view: domain.view ? ordinal("View", domain.view) : z.string().transform(() => undefined),
    waterfront: domain.waterfront ? z.boolean() : z.boolean().transform(() => undefined),
  });
  return schema as unknown as z.ZodType<PredictionInput, z.ZodTypeDef, PredictionFormValues>;
}

export function defaultFormValues(region: ValidatedRegion): PredictionFormValues {
  const { grade, view, zipcodes } = region.inputDomain;
  return {
    region: region.key,
    zipcode: zipcodes[0] ?? "",
    sqft: "1800",
    bedrooms: "3",
    bathrooms: "2",
    ageYears: 30,
    grade: grade ? String(Math.floor((grade.min + grade.max) / 2)) : "",
    view: view ? String(view.min) : "",
    waterfront: false,
  };
}
