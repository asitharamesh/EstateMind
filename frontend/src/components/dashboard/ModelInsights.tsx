import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, BrainCircuit } from "lucide-react";
import { describeHyperparameters, modelCardTiles } from "@/lib/modelCard";
import { fetchRegionInsights, isValidated, type RegionCatalog, type ValidatedRegion } from "@/lib/regions";
import {
  CHART_AXIS_TICK,
  CHART_CURSOR_FILL,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from "@/lib/chartTheme";

function correlationColor(value: number): string {
  const alpha = Math.min(1, Math.abs(value));
  return value >= 0 ? `hsl(var(--primary) / ${0.12 + alpha * 0.5})` : `hsl(var(--destructive) / ${0.12 + alpha * 0.5})`;
}

export function ModelInsights({ catalog }: { catalog: RegionCatalog }) {
  const validated = catalog.regions.filter(isValidated);
  const unavailable = catalog.regions.filter((r) => !isValidated(r));

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="text-sm text-muted-foreground">{catalog.note}</p>
      {validated.map((region) => (
        <RegionModel key={region.key} region={region} />
      ))}
      {unavailable.length > 0 && (
        <Card className="shadow-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Regions Without a Validated Model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unavailable.map((region) => (
              <div key={region.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{region.label}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  Not validated
                </Badge>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-1">
              No legitimate sale-level training dataset is available for these markets, so no metrics exist and no
              prediction is produced. There is no cross-region price multiplier.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RegionModel({ region }: { region: ValidatedRegion }) {
  const card = region.model;
  const insights = useQuery({
    queryKey: ["insights", region.key],
    queryFn: () => fetchRegionInsights(region.key),
    retry: 1,
    staleTime: Infinity,
  });

  return (
    <div className="space-y-6">
      <Card className="shadow-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <BrainCircuit className="h-4 w-4 text-primary" />
            </div>
            {region.label}
          </CardTitle>
          <div className="text-xs text-muted-foreground font-mono">
            Model v{card.modelVersion} · {card.algorithm} · {describeHyperparameters(card)} · {card.features.length}{" "}
            features
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {modelCardTiles(card).map((tile) => (
              <div key={tile.label} className="rounded-lg bg-secondary/40 border border-border p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</div>
                <div className="text-lg font-semibold mt-0.5 font-mono">{tile.value}</div>
              </div>
            ))}
          </div>
          <dl className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Evaluation</dt>
            <dd>
              Held-out test sales scored through the same pipeline the API uses ({card.evaluation.pipeline}).
            </dd>
            <dt className="text-muted-foreground">Split</dt>
            <dd>
              {card.split.method}; {card.split.trainRows.toLocaleString()} train / {card.split.testRows.toLocaleString()}{" "}
              test sales, {card.split.propertiesInBothSplits} properties in both.
            </dd>
            <dt className="text-muted-foreground">Features</dt>
            <dd>{card.features.map((f) => f.label).join(", ")}</dd>
            <dt className="text-muted-foreground">Dataset</dt>
            <dd>
              {card.dataset.name} ({card.dataset.timeSpan}); {card.dataset.rowsAfterCleaning.toLocaleString()} sales after
              removing {card.dataset.removedImpossibleRows} impossible row. {card.dataset.license}
            </dd>
            <dt className="text-muted-foreground">Price basis</dt>
            <dd>{card.dataset.priceBasis}</dd>
          </dl>
        </CardContent>
      </Card>

      {insights.isPending ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      ) : insights.isError ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-card flex flex-col items-center">
          <AlertTriangle className="h-6 w-6 text-warning mb-2" />
          <p className="text-sm text-muted-foreground">Feature charts unavailable: {insights.error.message}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Feature Importance (impurity-based)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={insights.data.featureImportance} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={CHART_AXIS_TICK} />
                    <YAxis type="category" dataKey="feature" width={120} tick={CHART_AXIS_TICK} />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                      labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                      cursor={{ fill: CHART_CURSOR_FILL }}
                    />
                    <Bar dataKey="importance" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Learning Curve (Train R² vs. Out-of-Bag R²)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={insights.data.trainingHistory} margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="estimators" tick={CHART_AXIS_TICK} />
                    <YAxis domain={[0.6, 1]} tick={CHART_AXIS_TICK} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />
                    <Line type="monotone" dataKey="trainR2" name="Train R²" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="oobR2" name="Out-of-bag R²" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap items-center gap-4 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--chart-2))" }} /> Train R²
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--chart-1))" }} /> Out-of-bag R²
                    (shipped model uses {card.hyperparameters.n_estimators} trees)
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Feature Correlation Matrix (training split)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="p-1.5" />
                      {insights.data.correlationMatrix.features.map((f) => (
                        <th key={f} className="p-1.5 text-muted-foreground font-medium whitespace-nowrap">
                          {f}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {insights.data.correlationMatrix.matrix.map((row, i) => {
                      const name = insights.data.correlationMatrix.features[i];
                      return (
                        <tr key={name}>
                          <td className="p-1.5 text-muted-foreground font-medium whitespace-nowrap pr-3">{name}</td>
                          {row.map((value, j) => (
                            <td key={j} className="p-1.5 text-center font-mono w-14" style={{ background: correlationColor(value) }}>
                              {value.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
