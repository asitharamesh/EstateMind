export interface ModelMetrics {
  rSquared: number;
  mae: number;
  rmse: number;
  mape: number;
  trainingSamples: number;
  testSamples: number;
  features: number;
  algorithm: string;
}

export function resolveModelMetrics(
  liveMetrics?: Partial<ModelMetrics> | null,
  fallbackMetrics?: Partial<ModelMetrics> | null,
): ModelMetrics {
  const base: Partial<ModelMetrics> = {
    rSquared: 0,
    mae: 0,
    rmse: 0,
    mape: 0,
    trainingSamples: 0,
    testSamples: 0,
    features: 0,
    algorithm: "Random Forest Regressor",
    ...fallbackMetrics,
    ...liveMetrics,
  };

  return {
    rSquared: Number(base.rSquared ?? 0),
    mae: Number(base.mae ?? 0),
    rmse: Number(base.rmse ?? 0),
    mape: Number(base.mape ?? 0),
    trainingSamples: Number(base.trainingSamples ?? 0),
    testSamples: Number(base.testSamples ?? 0),
    features: Number(base.features ?? 0),
    algorithm: base.algorithm ?? "Random Forest Regressor",
  };
}

export async function fetchModelMetrics(): Promise<ModelMetrics> {
  const response = await fetch("/api/model-metrics");
  if (!response.ok) {
    throw new Error("Unable to load model metrics");
  }
  return response.json();
}
