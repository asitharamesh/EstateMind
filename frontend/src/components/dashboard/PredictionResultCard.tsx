import { useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BookmarkCheck, BookmarkPlus, MapPin } from "lucide-react";
import {
  OFFLINE_MESSAGE,
  formatCurrency,
  formatCurrencyFull,
  formatPercent,
  type ModelPrediction,
  type PredictionInput,
  type PredictionResult,
} from "@/lib/predictionEngine";
import {
  CHART_AXIS_TICK,
  CHART_CATEGORICAL_COLORS,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  TIER_BADGE_STYLES,
  TIER_CHART_COLOR,
} from "@/lib/chartTheme";

interface PredictionResultCardProps {
  result: PredictionResult;
  input: PredictionInput;
  onSave: (label: string) => void;
  isSaved: boolean;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/40 border border-border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}

export function PredictionResultCard({ result, input, onSave, isSaved }: PredictionResultCardProps) {
  const [saveLabel, setSaveLabel] = useState("");
  const defaultLabel = `Zip ${input.zipcode}, ${input.sqft.toLocaleString()} sq ft`;
  const handleSave = () => onSave(saveLabel.trim() || defaultLabel);

  return (
    <div className="space-y-4 animate-fade-in">
      {result.source === "offline-estimate" && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {OFFLINE_MESSAGE} This is a {result.baseline.method.toLowerCase()} baseline (test R²{" "}
            {result.baseline.metrics.r2.toFixed(2)}), not the trained model: no tier, range or explanation.
          </span>
        </div>
      )}

      <Card className="shadow-card border-border overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Zip {input.zipcode} · {result.regionLabel}
              </CardTitle>
              <div className="mt-1 text-4xl font-bold text-primary">{formatCurrency(result.price)}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{formatCurrencyFull(result.price)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">Price basis: {result.priceBasis}</div>
            </div>
            {result.source === "model" && (
              <Badge variant="outline" className={TIER_BADGE_STYLES[result.tier.label]}>
                {result.tier.label}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="$/sqft" value={`$${result.pricePerSqft.toLocaleString()}`} />
            <Stat label="Zip median $/sqft" value={`$${result.zipMedianPricePerSqft.toLocaleString()}`} />
            {result.source === "model" ? (
              <Stat label="Model" value={`v${result.modelVersion}`} />
            ) : (
              <Stat label="Source" value="Offline baseline" />
            )}
          </div>

          {result.source === "model" && <ModelDetails result={result} />}

          {isSaved ? (
            <Button variant="secondary" className="w-full" disabled>
              <BookmarkCheck className="h-4 w-4" /> Saved to comparison
            </Button>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="save-label" className="text-xs text-muted-foreground">
                Name this property (optional)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="save-label"
                  placeholder={defaultLabel}
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                  maxLength={40}
                />
                <Button variant="outline" onClick={handleSave} className="shrink-0">
                  <BookmarkPlus className="h-4 w-4" /> Save
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModelDetails({ result }: { result: ModelPrediction }) {
  const { tier, interval } = result;
  const tierColor = TIER_CHART_COLOR[tier.label];
  const gaugeData = [{ name: "percentile", value: tier.percentile, fill: tierColor }];
  const rangeChartData = [{ name: "range", base: interval.low, spread: Math.max(interval.high - interval.low, 1) }];
  const rangePadding = Math.max((interval.high - interval.low) * 0.15, 1);
  const pieData = result.factors.map((factor, i) => ({
    ...factor,
    color: CHART_CATEGORICAL_COLORS[i % CHART_CATEGORICAL_COLORS.length],
  }));

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-medium mb-1">Market Tier</div>
          <div className="relative h-[190px] overflow-hidden">
            <ResponsiveContainer width="100%" height={190}>
              <RadialBarChart cx="50%" cy="88%" startAngle={180} endAngle={0} innerRadius="145%" outerRadius="220%" barSize={20} data={gaugeData}>
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={10} background={{ fill: "hsl(var(--secondary))" }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-x-0 bottom-2 text-center">
              <div className="text-4xl font-bold font-mono" style={{ color: tierColor }}>
                {tier.percentile.toFixed(0)}
              </div>
              <div className="text-[11px] text-muted-foreground">percentile in region</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs px-1 -mt-2">
            {(["Budget", "Mid-Range", "Luxury"] as const).map((label) => (
              <span
                key={label}
                className={tier.label === label ? "font-semibold" : "text-muted-foreground"}
                style={tier.label === label ? { color: tierColor } : undefined}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5 text-center">
            Priced above {tier.percentile.toFixed(0)}% of {tier.referenceSales.toLocaleString()} training sales in this
            region (same price basis). Budget below {formatCurrency(tier.budgetBelow)}, Luxury from{" "}
            {formatCurrency(tier.luxuryFrom)}.
          </div>
        </div>

        {pieData.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-1">What Drove This Price</div>
            <div className="relative h-[220px] w-[220px] mx-auto sm:mx-0">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="share" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={2} startAngle={90} endAngle={-270} stroke="none">
                    {pieData.map((factor) => (
                      <Cell key={factor.feature} fill={factor.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                    labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                    formatter={(_value, _name, item) => {
                      const factor = item.payload as (typeof pieData)[number];
                      return [
                        `${(factor.share * 100).toFixed(0)}% of price impact (${factor.contribution >= 0 ? "+" : "-"}${formatCurrency(Math.abs(factor.contribution))})`,
                        factor.label,
                      ];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-2xl font-bold">{pieData.length}</div>
                <div className="text-[11px] text-muted-foreground">factors</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3">
              {pieData.map((factor) => (
                <div key={factor.feature} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: factor.color }} />
                    <span className="truncate text-muted-foreground">{factor.label}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 font-mono font-medium">
                    {factor.contribution >= 0 ? (
                      <ArrowUpRight className="h-3 w-3 text-primary" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 text-destructive" />
                    )}
                    {(factor.share * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1.5">
              Share of the model's total price adjustment, decomposed from the trees' decision paths.
            </div>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="text-sm font-medium">
          {formatPercent(interval.nominalCoverage)} Prediction Interval: {formatCurrencyFull(interval.low)} –{" "}
          {formatCurrencyFull(interval.high)}
        </div>
        <ResponsiveContainer width="100%" height={56}>
          <BarChart data={rangeChartData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            <XAxis
              type="number"
              domain={[Math.max(0, interval.low - rangePadding), interval.high + rangePadding]}
              tick={CHART_AXIS_TICK}
              tickFormatter={(v: number) => formatCurrency(v)}
            />
            <YAxis type="category" dataKey="name" hide />
            <Bar dataKey="base" stackId="range" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="spread" stackId="range" fill="hsl(var(--primary) / 0.35)" radius={[6, 6, 6, 6]} />
            <ReferenceLine x={result.price} stroke="hsl(var(--primary))" strokeWidth={2} />
          </BarChart>
        </ResponsiveContainer>
        <div className="text-xs text-muted-foreground">
          Calibrated on out-of-bag training errors. Measured coverage:{" "}
          <span className="font-medium text-foreground">{formatPercent(interval.empiricalCoverage, 1)}</span> of held-out
          test sales fell inside their interval. Not a guarantee for any single property.
        </div>
      </div>
    </>
  );
}
