import { describe, expect, it } from "vitest";
import { buildPredictionSchema, defaultFormValues, type PredictionFormValues } from "@/lib/predictionSchema";
import { validatedRegion, validatedRegionWithoutViewOrWaterfront } from "./fixtures";

const schema = buildPredictionSchema(validatedRegion);
const valid: PredictionFormValues = { ...defaultFormValues(validatedRegion), zipcode: "98103", bathrooms: "2", grade: "7" };

function firstError(patch: Partial<PredictionFormValues>) {
  const result = schema.safeParse({ ...valid, ...patch });
  if (result.success) return null;
  const issue = result.error.issues[0];
  return { field: issue.path[0], message: issue.message };
}

describe("prediction form schema", () => {
  it("converts valid form text into the API payload", () => {
    expect(schema.parse(valid)).toEqual({
      region: "seattle",
      zipcode: "98103",
      sqft: 1800,
      bedrooms: 3,
      bathrooms: 2,
      ageYears: 30,
      grade: 7,
      view: 0,
      waterfront: false,
    });
  });

  it.each([
    [{ zipcode: "99999" }, "zipcode", "99999 is not a supported zip code for Seattle / King County, WA"],
    [{ zipcode: "981" }, "zipcode", "Enter a 5-digit zip code"],
    [{ sqft: "" }, "sqft", "Square footage is required"],
    [{ sqft: "abc" }, "sqft", "Enter a valid number"],
    [{ sqft: "9000" }, "sqft", "Must be between 500 and 8,000"],
    [{ bedrooms: "2.5" }, "bedrooms", "Bedrooms must be a whole number"],
    [{ bathrooms: "2.3" }, "bathrooms", "Bathrooms must be a whole number"],
    [{ grade: "3" }, "grade", "Grade must be between 4 and 13"],
    [{ view: "5" }, "view", "View must be between 0 and 4"],
    [{ region: "austin" }, "region", undefined],
  ])("rejects %o", (patch, field, message) => {
    const error = firstError(patch);
    expect(error?.field).toBe(field);
    if (message) expect(error?.message).toBe(message);
  });
});

describe("prediction form schema for a region without view/waterfront", () => {
  const region = validatedRegionWithoutViewOrWaterfront;
  const noViewSchema = buildPredictionSchema(region);
  const defaults = defaultFormValues(region);

  it("omits grade default's dependency on view/waterfront and drops both keys from the payload", () => {
    expect(defaults.view).toBe("");
    const parsed = noViewSchema.parse({ ...defaults, zipcode: "98103", bathrooms: "2", grade: "1" });
    expect(parsed).toEqual({
      region: "chicago",
      zipcode: "98103",
      sqft: 1800,
      bedrooms: 3,
      bathrooms: 2,
      ageYears: 30,
      grade: 1,
      view: undefined,
      waterfront: undefined,
    });
  });

  it("still validates grade, which this region's dataset does have", () => {
    const result = noViewSchema.safeParse({ ...defaults, zipcode: "98103", bathrooms: "2", grade: "9" });
    expect(result.success).toBe(false);
  });
});
