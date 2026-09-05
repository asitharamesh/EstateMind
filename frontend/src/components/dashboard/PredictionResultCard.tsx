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
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  BookmarkCheck,
  BookmarkPlus,
  Gauge,
  MapPin,
} from "lucide-react";
import {
  CITIES,
  PROPERTY_TYPE_LABELS,
  formatCurrency,
  formatCurrencyFull,
  type PredictionInput,
  type PredictionResult,
} from "@/lib/predictionEngine";
import {
  CHART_AXIS_TICK,
  CHART_CATEGORICAL_COLORS,
  CHART_CURSOR_FILL,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  TIER_CHART_COLOR,
} from "@/lib/chartTheme";

interface PredictionResultCardProps {
  result: PredictionResult;
  input: PredictionInput;
  onSave: (label: string) => void;
  isSaved: boolean;
}

const TIER_STYLES: Record<PredictionResult["tier"], string> = {
  Budget: "bg-tier-budget/15 text-tier-budget border-tier-budget/40",
  "Mid-Range": "bg-tier-mid/15 text-tier-mid border-tier-mid/40",
  Luxury: "bg-tier-luxury/15 text-tier-luxury border-tier-luxury/40",
};

export function PredictionResultCard({ result, input, onSave, isSaved }: PredictionResultCardProps) {
  const cityLabel = CITIES[input.city]?.label ?? input.city;
  const typeLabel = PROPERTY_TYPE_LABELS[input.propertyType] ?? input.propertyType;
  const tierColor = TIER_CHART_COLOR[result.tier];
  const defaultLabel = `${typeLabel} in ${cityLabel}`;
  const [saveLabel, setSaveLabel] = useState("");

  // Real gauge data: the tier score comes straight from the backend's
  // ratio-to-metro calculation (backend/valuation.py) - nothing here is a
  // display-only fabrication.
  const gaugeData = [{ name: "tierScore", value: result.tierScore, fill: tierColor }];

  // A single-row floating bar: transparent from 0 to the range low, then a
  // visible segment from low to high, with a reference line marking the
  // actual point estimate - all three numbers are the real 10th/50th/90th
  // percentile-derived values the backend returns.
  const rangeChartData = [
    {
      name: "range",
      base: result.range.low,
      spread: Math.max(result.range.high - result.range.low, 1),
    },
  ];
  const rangePadding = Math.max((result.range.high - result.range.low) * 0.15, 1);

  // Feature-attribution donut: each slice is this feature's share of the
  // model's total price adjustment (the backend's `share`, always >= 0 and
  // summing to ~100%) - so "how much of the price swing did this feature
  // cause" reads as a part-of-100% breakdown instead of a +/- bar. Direction
  // (did it push price up or down) is called out separately per row rather
  // than folded into the slice size.
  const pieData = result.factors.map((factor, i) => ({
    ...factor,
    color: CHART_CATEGORICAL_COLORS[i % CHART_CATEGORICAL_COLORS.length],
  }));

  const handleSave = () => onSave(saveLabel.trim() || defaultLabel);

  return (
    <div className="space-y-4 animate-fade-in">
      {result.source === "offline-estimate" && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Offline estimate — live model unreachable. This is a rough heuristic, not the trained Random
            Forest prediction.
          </span>
        </div>
      )}

      <Card className="shadow-card border-border overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {typeLabel} · {cityLabel}
              </CardTitle>
              <div className="mt-1 text-4xl font-bold text-primary">{formatCurrency(result.price)}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">
                {formatCurrencyFull(result.price)}
              </div>
            </div>
            <Badge variant="outline" className={TIER_STYLES[result.tier]}>
              {result.tier}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-secondary/40 border border-border p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">$/sqft</div>
              <div className="text-lg font-semibold mt-0.5">${result.pricePerSqft.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-secondary/40 border border-border p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Market avg $/sqft</div>
              <div className="text-lg font-semibold mt-0.5">${result.marketAvgPerSqft.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-secondary/40 border border-border p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Gauge className="h-3 w-3" /> Confidence
              </div>
              <div className="text-lg font-semibold mt-0.5">{result.confidence.toFixed(0)}%</div>
            </div>
          </div>

          {/* Tier gauge + feature contribution, side by side so neither
              wastes a full row on its own. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-medium mb-1">Tier Score</div>
              <div className="relative h-[190px] overflow-hidden">
                <ResponsiveContainer width="100%" height={190}>
                  <RadialBarChart
                    cx="50%"
                    cy="88%"
                    startAngle={180}
                    endAngle={0}
                    innerRadius="145%"
                    outerRadius="220%"
                    barSize={20}
                    data={gaugeData}
                  >
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar
                      dataKey="value"
                      cornerRadius={10}
                      background={{ fill: "hsl(var(--secondary))" }}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-x-0 bottom-2 text-center">
                  <div className="text-4xl font-bold font-mono" style={{ color: tierColor }}>
                    {result.tierScore.toFixed(0)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">tier score / 100</div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs px-1 -mt-2">
                {(["Budget", "Mid-Range", "Luxury"] as const).map((label) => (
                  <span
                    key={label}
                    className={
                      result.tier === label
                        ? "font-semibold"
                        : "text-muted-foreground"
                    }
                    style={result.tier === label ? { color: tierColor } : undefined}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1.5 text-center">
                Priced higher than <span className="font-medium text-foreground">{result.tierScore.toFixed(0)}%</span> of
                comparable real home sales.
              </div>
            </div>

            {pieData.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">What Drove This Price</div>
                <div className="relative h-[220px] w-[220px] mx-auto sm:mx-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="share"
                        nameKey="label"
                        innerRadius="62%"
                        outerRadius="100%"
                        paddingAngle={2}
                        startAngle={90}
                        endAngle={-270}
                        stroke="none"
                      >
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
                  {pieData.map((factor) => {
                    const isPositive = factor.contribution >= 0;
                    return (
                      <div key={factor.feature} className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: factor.color }}
                          />
                          <span className="truncate text-muted-foreground">{factor.label}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0 font-mono font-medium">
                          {isPositive ? (
                            <ArrowUpRight className="h-3 w-3 text-primary" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 text-destructive" />
                          )}
                          {(factor.share * 100).toFixed(0)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  Share of the model's total price adjustment;{" "}
                  <ArrowUpRight className="h-2.5 w-2.5 inline text-primary" /> raises the price,{" "}
                  <ArrowDownRight className="h-2.5 w-2.5 inline text-destructive" /> lowers it.
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="text-sm font-medium">Estimated Range</div>
            <ResponsiveContainer width="100%" height={56}>
              <BarChart
                data={rangeChartData}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
              >
                <XAxis
                  type="number"
                  domain={[
                    Math.max(0, result.range.low - rangePadding),
                    result.range.high + rangePadding,
                  ]}
                  tick={CHART_AXIS_TICK}
                  tickFormatter={(v: number) => formatCurrency(v)}
                />
                <YAxis type="category" dataKey="name" hide />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  cursor={false}
                  formatter={() => [
                    `${formatCurrencyFull(result.range.low)} – ${formatCurrencyFull(result.range.high)}`,
                    "Range",
                  ]}
                />
                <Bar dataKey="base" stackId="range" fill="transparent" isAnimationActive={false} />
                <Bar
                  dataKey="spread"
                  stackId="range"
                  fill="hsl(var(--primary) / 0.35)"
                  radius={[6, 6, 6, 6]}
                />
                <ReferenceLine x={result.price} stroke="hsl(var(--primary))" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
            <div className="text-xs text-muted-foreground">
              10th–90th percentile of the ensemble's tree predictions; the line marks the point estimate.
            </div>
          </div>

          {result.metro && (
            <div className="text-[11px] text-muted-foreground flex items-start gap-1.5 pt-1">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
              <span>
                Cross-metro adjustment ({result.metro.metro}, ×{result.metro.scaleVsTrainingMetro.toFixed(2)}):{" "}
                {result.metro.source}, as of {result.metro.asOf}.
              </span>
            </div>
          )}

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
