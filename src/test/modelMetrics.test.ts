import { describe, expect, it } from "vitest";
import { resolveModelMetrics } from "@/lib/modelMetrics";

describe("resolveModelMetrics", () => {
  it("prefers the real model metrics over a hard-coded fallback", () => {
    const metrics = resolveModelMetrics(
      {
        rSquared: 0.876,
        mae: 22840,
        rmse: 34120,
        mape: 5.7,
        trainingSamples: 48230,
        testSamples: 12058,
        features: 10,
        algorithm: "Random Forest Regressor",
      },
      {
        rSquared: 0.913,
        mae: 24750,
        rmse: 38420,
        mape: 6.8,
        trainingSamples: 48230,
        testSamples: 12058,
        features: 14,
        algorithm: "Random Forest Regressor",
      },
    );

    expect(metrics.rSquared).toBe(0.876);
    expect(metrics.mae).toBe(22840);
    expect(metrics.features).toBe(10);
  });
});
