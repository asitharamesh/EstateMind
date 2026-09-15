import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiServerError, ApiUnreachableError, ApiValidationError, SERVER_ERROR_MESSAGE, VALIDATION_MESSAGE } from "@/lib/api";
import { describePredictionError, offlineEstimate, predictPrice, type PredictionInput } from "@/lib/predictionEngine";
import { describeHyperparameters, modelCardTiles } from "@/lib/modelCard";
import { modelPrediction, validatedRegion } from "./fixtures";

const input: PredictionInput = {
  region: "seattle",
  zipcode: "98103",
  sqft: 2000,
  bedrooms: 3,
  bathrooms: 2,
  ageYears: 30,
  grade: 7,
  view: 0,
  waterfront: false,
};

function mockFetch(response: Response | Error) {
  const fn = response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("predictPrice", () => {
  it("returns the live model result and sends exactly the collected fields", async () => {
    const { source: _source, ...body } = modelPrediction();
    const fetchMock = mockFetch(json(200, body));
    const result = await predictPrice(input, validatedRegion);
    expect(result.source).toBe("model");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it("uses the offline estimate only when the API is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch(new TypeError("Failed to fetch"));
    const result = await predictPrice(input, validatedRegion);
    expect(result).toMatchObject({ source: "offline-estimate", price: 600000, pricePerSqft: 300 });
  });

  it("does NOT fall back to offline on a 422", async () => {
    mockFetch(json(422, { detail: [{ loc: ["body", "zipcode"], msg: "unsupported" }] }));
    await expect(predictPrice(input, validatedRegion)).rejects.toBeInstanceOf(ApiValidationError);
  });

  it("does NOT fall back to offline on a 500", async () => {
    mockFetch(json(500, { detail: SERVER_ERROR_MESSAGE }));
    await expect(predictPrice(input, validatedRegion)).rejects.toBeInstanceOf(ApiServerError);
  });
});

describe("offlineEstimate", () => {
  it("is zip median $/sqft times square footage, with no tier or interval", () => {
    const estimate = offlineEstimate({ ...input, zipcode: "98001", sqft: 1000 }, validatedRegion);
    expect(estimate.price).toBe(150000);
    expect(estimate).not.toHaveProperty("tier");
    expect(estimate).not.toHaveProperty("interval");
  });

  it("refuses to invent a number for an unknown zip", () => {
    expect(() => offlineEstimate({ ...input, zipcode: "99999" }, validatedRegion)).toThrow(/No offline baseline/);
  });
});

describe("describePredictionError", () => {
  it("maps each failure to the message the user should see", () => {
    expect(describePredictionError(new ApiValidationError({ sqft: "bad" }, [])).message).toBe(VALIDATION_MESSAGE);
    expect(describePredictionError(new ApiServerError(500))).toEqual({ kind: "server", message: SERVER_ERROR_MESSAGE });
    expect(describePredictionError(new ApiUnreachableError("x")).kind).toBe("server");
  });
});

describe("model card", () => {
  it("shows numbers straight from the model card", () => {
    const tiles = Object.fromEntries(modelCardTiles(validatedRegion.model).map((t) => [t.label, t.value]));
    expect(tiles["Test R²"]).toBe("0.850");
    expect(tiles["Test MAE"]).toBe("$80,000");
    expect(tiles["Training sales"]).toBe("79");
    expect(tiles["80% interval coverage"]).toBe("80.2%");
    expect(describeHyperparameters(validatedRegion.model)).toBe("100 trees · max depth 18 · min 3 sales per leaf");
  });
});
