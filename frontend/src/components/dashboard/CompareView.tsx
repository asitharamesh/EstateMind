import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitCompareArrows, Trash2, X } from "lucide-react";
import {
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
  TIER_BADGE_STYLES,
  TIER_CHART_COLOR,
} from "@/lib/chartTheme";

export interface SavedItem {
  id: string;
  /** User-entered name, or a generated "Zip {zip}, {sqft} sq ft" label. */
  label: string;
  input: PredictionInput;
  result: PredictionResult;
}

interface CompareViewProps {
  saved: SavedItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

const OFFLINE_COLOR = "hsl(var(--muted-foreground))";

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
        <div className="text-sm text-muted-foreground">Comparing {saved.length} of 3 properties</div>
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
                tier: item.result.source === "model" ? item.result.tier.label : "Offline estimate",
              }))}
              layout="vertical"
              margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
            >
              <XAxis type="number" tick={CHART_AXIS_TICK} tickFormatter={(v: number) => formatCurrency(v)} />
              <YAxis type="category" dataKey="label" width={100} tick={CHART_AXIS_TICK} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                cursor={{ fill: CHART_CURSOR_FILL }}
                formatter={(value: number, _name, item) => [formatCurrencyFull(value), item.payload.tier]}
              />
              <Bar dataKey="price" radius={[0, 4, 4, 0]}>
                {saved.map((item) => (
                  <Cell
                    key={item.id}
                    fill={item.result.source === "model" ? TIER_CHART_COLOR[item.result.tier.label] : OFFLINE_COLOR}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {saved.map((item) => {
          const { result, input } = item;
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
                  Zip {input.zipcode} · {result.regionLabel}
                </div>
                <div className="text-2xl font-bold text-primary">{formatCurrency(result.price)}</div>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.source === "model" ? (
                  <Badge variant="outline" className={TIER_BADGE_STYLES[result.tier.label]}>
                    {result.tier.label}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-warning border-warning/40">
                    Offline estimate
                  </Badge>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Detail label="Sqft" value={input.sqft.toLocaleString()} />
                  <Detail label="Beds / Baths" value={`${input.bedrooms} / ${input.bathrooms}`} />
                  {(input.grade !== undefined || input.view !== undefined) && (
                    <Detail label="Grade / View" value={`${input.grade ?? "—"} / ${input.view ?? "—"}`} />
                  )}
                  <Detail label="$/sqft" value={`$${result.pricePerSqft.toLocaleString()}`} />
                  {result.source === "model" && (
                    <div className="col-span-2">
                      <Detail
                        label={`${Math.round(result.interval.nominalCoverage * 100)}% interval`}
                        value={`${formatCurrency(result.interval.low)} – ${formatCurrency(result.interval.high)}`}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/40 border border-border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-medium">{value}</div>
    </div>
  );
}
