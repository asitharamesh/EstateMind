import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  BadgeCheck,
  BookmarkCheck,
  BookmarkPlus,
  Gauge,
  MapPin,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CITIES,
  formatCurrency,
  formatCurrencyFull,
  getGaugeAngle,
  type PredictionInput,
  type PredictionResult,
} from "@/lib/predictionEngine";

interface PredictionResultCardProps {
  result: PredictionResult;
  input: PredictionInput;
  onSave: () => void;
  isSaved: boolean;
}

const TIER_STYLES: Record<PredictionResult["tier"], string> = {
  Budget: "bg-tier-budget/15 text-tier-budget border-tier-budget/40",
  "Mid-Range": "bg-tier-mid/15 text-tier-mid border-tier-mid/40",
  Luxury: "bg-tier-luxury/15 text-tier-luxury border-tier-luxury/40",
};

export function PredictionResultCard({ result, input, onSave, isSaved }: PredictionResultCardProps) {
  const cityLabel = CITIES[input.city]?.label ?? input.city;
  const gaugeAngle = getGaugeAngle(result.tierScore);
  const maxAbsContribution = Math.max(1, ...result.factors.map((f) => Math.abs(f.contribution)));

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

      <Card className="glass shadow-card border-border overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {cityLabel}
              </CardTitle>
              <div className="mt-1 text-4xl font-bold text-gradient">{formatCurrency(result.price)}</div>
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

          {/* Tier gauge */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Budget</span>
              <span>Mid-Range</span>
              <span>Luxury</span>
            </div>
            <div className="relative h-2 rounded-full bg-gradient-to-r from-tier-budget via-tier-mid to-tier-luxury overflow-visible">
              <div
                className="absolute -top-1.5 h-5 w-1.5 rounded-full bg-foreground shadow-glow"
                style={{ left: `calc(${((gaugeAngle + 90) / 180) * 100}% - 3px)` }}
              />
            </div>
            <div className="text-center text-xs text-muted-foreground">
              Tier score: <span className="font-mono text-foreground">{result.tierScore.toFixed(0)}</span>/100
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="text-sm font-medium">Estimated Range</div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-muted-foreground">
                {formatCurrency(result.range.low)}
              </span>
              <div className="relative flex-1 h-1.5 rounded-full bg-secondary">
                <div className="absolute inset-y-0 left-[10%] right-[10%] rounded-full bg-primary/60" />
              </div>
              <span className="font-mono text-sm text-muted-foreground">
                {formatCurrency(result.range.high)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              10th–90th percentile of the ensemble's tree predictions.
            </div>
          </div>

          {result.factors.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="text-sm font-medium">Feature Attribution</div>
                <div className="space-y-2.5">
                  {result.factors.map((factor) => {
                    const isPositive = factor.contribution >= 0;
                    const widthPct = (Math.abs(factor.contribution) / maxAbsContribution) * 100;
                    return (
                      <div key={factor.feature} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{factor.label}</span>
                          <span
                            className={`font-mono flex items-center gap-1 ${
                              isPositive ? "text-primary" : "text-destructive"
                            }`}
                          >
                            {isPositive ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {isPositive ? "+" : "-"}
                            {formatCurrency(Math.abs(factor.contribution))}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isPositive ? "bg-primary" : "bg-destructive"
                            }`}
                            style={{ width: `${Math.max(widthPct, 2)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {result.metro && (
            <div className="text-[11px] text-muted-foreground flex items-start gap-1.5 pt-1">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
              <span>
                Cross-metro adjustment ({result.metro.metro}, ×{result.metro.scaleVsTrainingMetro.toFixed(2)}):{" "}
                {result.metro.source}, as of {result.metro.asOf}.
              </span>
            </div>
          )}

          <Button
            variant={isSaved ? "secondary" : "outline"}
            className="w-full"
            onClick={onSave}
            disabled={isSaved}
          >
            {isSaved ? (
              <>
                <BookmarkCheck className="h-4 w-4" /> Saved to comparison
              </>
            ) : (
              <>
                <BookmarkPlus className="h-4 w-4" /> Save for comparison
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
