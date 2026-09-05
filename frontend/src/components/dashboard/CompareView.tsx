import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitCompareArrows, Trash2, X } from "lucide-react";
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
  CHART_CURSOR_FILL,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  TIER_CHART_COLOR,
} from "@/lib/chartTheme";

export interface SavedItem {
  id: string;
  /** User-entered name for this saved property, e.g. "Downtown listing" -
   * falls back to a generated "{type} in {city}" label if left blank. */
  label: string;
  input: PredictionInput;
  result: PredictionResult;
}

interface CompareViewProps {
  saved: SavedItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

const TIER_STYLES: Record<PredictionResult["tier"], string> = {
  Budget: "bg-tier-budget/15 text-tier-budget border-tier-budget/40",
  "Mid-Range": "bg-tier-mid/15 text-tier-mid border-tier-mid/40",
  Luxury: "bg-tier-luxury/15 text-tier-luxury border-tier-luxury/40",
};

export function CompareView({ saved, onRemove, onClear }: CompareViewProps) {
  if (saved.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-12 text-center shadow-card flex flex-col items-center justify-center min-h-[400px]">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
          <GitCompareArrows className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Nothing to compare yet</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          Run a prediction and save it to start comparing up to 3 properties side by side.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Comparing {saved.length} of 3 properties
        </div>
        <Button variant="outline" size="sm" onClick={onClear}>
          <Trash2 className="h-3.5 w-3.5" /> Clear all
        </Button>
      </div>

      <Card className="shadow-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Price Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={saved.length * 44 + 24}>
            <BarChart
              data={saved.map((item) => ({
                id: item.id,
                label: item.label,
                price: item.result.price,
                tier: item.result.tier,
              }))}
              layout="vertical"
              margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
            >
              <XAxis
                type="number"
                tick={CHART_AXIS_TICK}
                tickFormatter={(v: number) => formatCurrency(v)}
              />
              <YAxis type="category" dataKey="label" width={100} tick={CHART_AXIS_TICK} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                cursor={{ fill: CHART_CURSOR_FILL }}
                formatter={(value: number, _name, item) => [
                  formatCurrencyFull(value),
                  item.payload.tier,
                ]}
              />
              <Bar dataKey="price" radius={[0, 4, 4, 0]}>
                {saved.map((item) => (
                  <Cell key={item.id} fill={TIER_CHART_COLOR[item.result.tier]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {saved.map((item) => {
          const cityLabel = CITIES[item.input.city]?.label ?? item.input.city;
          const typeLabel = PROPERTY_TYPE_LABELS[item.input.propertyType] ?? item.input.propertyType;
          return (
            <Card key={item.id} className="shadow-card border-border relative">
              <button
                onClick={() => onRemove(item.id)}
                className="absolute top-3 right-3 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                aria-label="Remove from comparison"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium truncate pr-6">{item.label}</CardTitle>
                <div className="text-xs text-muted-foreground">
                  {typeLabel} · {cityLabel}
                </div>
                <div className="text-2xl font-bold text-primary">{formatCurrency(item.result.price)}</div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge variant="outline" className={TIER_STYLES[item.result.tier]}>
                  {item.result.tier}
                </Badge>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-secondary/40 border border-border p-2">
                    <div className="text-muted-foreground">Sqft</div>
                    <div className="font-mono font-medium">{item.input.sqft.toLocaleString()}</div>
                  </div>
                  <div className="rounded-md bg-secondary/40 border border-border p-2">
                    <div className="text-muted-foreground">Beds / Baths</div>
                    <div className="font-mono font-medium">
                      {item.input.bedrooms} / {item.input.bathrooms}
                    </div>
                  </div>
                  <div className="rounded-md bg-secondary/40 border border-border p-2">
                    <div className="text-muted-foreground">$/sqft</div>
                    <div className="font-mono font-medium">${item.result.pricePerSqft.toLocaleString()}</div>
                  </div>
                  <div className="rounded-md bg-secondary/40 border border-border p-2">
                    <div className="text-muted-foreground">Confidence</div>
                    <div className="font-mono font-medium">{item.result.confidence.toFixed(0)}%</div>
                  </div>
                </div>
                {item.result.source === "offline-estimate" && (
                  <div className="text-[10px] text-warning">Offline estimate</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
