import { formatCurrencyFull, formatPercent } from "@/lib/predictionEngine";
import type { ModelCard } from "@/lib/regions";

export interface ModelCardTile {
  label: string;
  value: string;
}

/** Headline numbers for a region's model, all read from its model card. */
export function modelCardTiles(card: ModelCard): ModelCardTile[] {
  const { metrics, interval, admittedRows } = card.evaluation;
  return [
    { label: "Test R²", value: metrics.r2.toFixed(3) },
    { label: "Test MAE", value: formatCurrencyFull(metrics.mae) },
    { label: "Test RMSE", value: formatCurrencyFull(metrics.rmse) },
    { label: "Test MAPE", value: `${metrics.mape.toFixed(1)}%` },
    { label: "Training sales", value: card.split.trainRowsUsed.toLocaleString() },
    { label: "Test sales", value: admittedRows.toLocaleString() },
    {
      label: `${formatPercent(interval.nominalCoverage)} interval coverage`,
      value: formatPercent(interval.empiricalCoverage, 1),
    },
    { label: "Baseline R² (zip $/sqft)", value: card.evaluation.baseline.metrics.r2.toFixed(3) },
  ];
}

export function describeHyperparameters(card: ModelCard): string {
  const h = card.hyperparameters;
  return [
    h.n_estimators !== undefined && `${h.n_estimators} trees`,
    h.max_depth !== undefined && `max depth ${h.max_depth}`,
    h.min_samples_leaf !== undefined && `min ${h.min_samples_leaf} sales per leaf`,
  ]
    .filter(Boolean)
    .join(" · ");
}
