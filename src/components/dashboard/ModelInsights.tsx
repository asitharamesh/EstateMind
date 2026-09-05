import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, BrainCircuit } from "lucide-react";
import { fetchModelInsights, type ModelInsights as ModelInsightsData } from "@/lib/predictionEngine";
import { fetchModelMetrics, type ModelMetrics } from "@/lib/modelMetrics";

function correlationColor(value: number): string {
  // Diverging scale: negative -> destructive hue, positive -> primary hue.
  const alpha = Math.min(1, Math.abs(value));
  return value >= 0
    ? `hsl(158 78% 52% / ${0.12 + alpha * 0.65})`
    : `hsl(0 75% 60% / ${0.12 + alpha * 0.65})`;
}

const CHART_TOOLTIP_STYLE = {
  background: "hsl(222 40% 9%)",
  border: "1px solid hsl(222 25% 16%)",
  borderRadius: "0.5rem",
  fontSize: "12px",
};

export function ModelInsights() {
  const [insights, setInsights] = useState<ModelInsightsData | null>(null);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchModelInsights(), fetchModelMetrics()])
      .then(([insightsData, metricsData]) => {
        if (cancelled) return;
        setInsights(insightsData);
        setMetrics(metricsData);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Unable to load model insights");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !insights || !metrics) {
    return (
      <div className="glass rounded-2xl p-12 text-center shadow-card flex flex-col items-center justify-center min-h-[400px]">
        <div className="h-16 w-16 rounded-2xl bg-warning/10 border border-warning/30 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8 text-warning" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Model insights unavailable</h3>
        <p className="text-muted-foreground text-sm max-w-md mb-1">
          {error ?? "The backend could not be reached."}
        </p>
        <p className="text-muted-foreground text-xs max-w-md font-mono">
          Start the backend with: uvicorn server.app:app --port 8009
        </p>
      </div>
    );
  }

  const { featureImportance, correlationMatrix, trainingHistory, metroPriceIndex } = insights;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Metrics summary */}
      <Card className="glass shadow-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="h-8 w-8 rounded-lg bg-gradient-primary/20 border border-primary/30 flex items-center justify-center">
              <BrainCircuit className="h-4 w-4 text-primary" />
            </div>
            {metrics.algorithm}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricTile label="R²" value={metrics.rSquared.toFixed(3)} />
            <MetricTile label="MAE" value={`$${Math.round(metrics.mae).toLocaleString()}`} />
            <MetricTile label="RMSE" value={`$${Math.round(metrics.rmse).toLocaleString()}`} />
            <MetricTile label="MAPE" value={`${metrics.mape.toFixed(1)}%`} />
          </div>
          <div className="mt-3 text-xs text-muted-foreground font-mono">
            {metrics.trainingSamples.toLocaleString()} training samples ·{" "}
            {metrics.testSamples.toLocaleString()} test samples · {metrics.features} features
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Feature importance */}
        <Card className="glass shadow-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Feature Importance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={featureImportance} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 25% 16%)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(215 20% 65%)" }} />
                <YAxis
                  type="category"
                  dataKey="feature"
                  width={110}
                  tick={{ fontSize: 11, fill: "hsl(215 20% 65%)" }}
                />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "hsl(222 25% 16% / 0.4)" }} />
                <Bar dataKey="importance" fill="hsl(158 78% 52%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Training curve */}
        <Card className="glass shadow-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Learning Curve (Train R² vs. Out-of-Bag R²)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trainingHistory} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 25% 16%)" />
                <XAxis
                  dataKey="estimators"
                  tick={{ fontSize: 11, fill: "hsl(215 20% 65%)" }}
                  label={{
                    value: "Estimators",
                    position: "insideBottom",
                    offset: -4,
                    fontSize: 11,
                    fill: "hsl(215 20% 65%)",
                  }}
                />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "hsl(215 20% 65%)" }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="trainR2"
                  name="Train R²"
                  stroke="hsl(192 90% 55%)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="oobR2"
                  name="Out-of-bag R²"
                  stroke="hsl(158 78% 52%)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: "hsl(192 90% 55%)" }} /> Train R²
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: "hsl(158 78% 52%)" }} /> Out-of-bag
                R² (not a held-out validation set)
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Correlation matrix */}
      <Card className="glass shadow-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Feature Correlation Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-1.5" />
                  {correlationMatrix.features.map((f) => (
                    <th
                      key={f}
                      className="p-1.5 text-muted-foreground font-medium whitespace-nowrap"
                    >
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlationMatrix.matrix.map((row, i) => (
                  <tr key={correlationMatrix.features[i]}>
                    <td className="p-1.5 text-muted-foreground font-medium whitespace-nowrap pr-3">
                      {correlationMatrix.features[i]}
                    </td>
                    {row.map((value, j) => (
                      <td
                        key={j}
                        className="p-1.5 text-center font-mono w-14"
                        style={{ background: correlationColor(value) }}
                        title={`${correlationMatrix.features[i]} × ${correlationMatrix.features[j]}: ${value.toFixed(2)}`}
                      >
                        {value.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Metro price index */}
      <Card className="glass shadow-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cross-Metro Price Index</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="pb-2 pr-4">Metro</th>
                  <th className="pb-2 pr-4">ZHVI (latest)</th>
                  <th className="pb-2">Scale vs. training metro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(metroPriceIndex.cities).map(([key, city]) => (
                  <tr key={key}>
                    <td className="py-2 pr-4 font-medium">{city.metro}</td>
                    <td className="py-2 pr-4 font-mono">
                      ${Math.round(city.zhviLatest).toLocaleString()}
                    </td>
                    <td className="py-2 font-mono">{city.scaleVsTrainingMetro.toFixed(3)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Source: {metroPriceIndex.source}. Training metro: {metroPriceIndex.trainingMetro} (reference{" "}
            {metroPriceIndex.trainingReferenceDate}). Latest data as of {metroPriceIndex.latestDate}.{" "}
            <a
              href={metroPriceIndex.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              View dataset
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/40 border border-border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5 font-mono">{value}</div>
    </div>
  );
}
