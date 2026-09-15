import type { Tier } from "@/lib/predictionEngine";

// Shared recharts styling so every chart in the app reads from the same
// theme tokens and dark-mode contrast fix in one place, instead of each
// component re-declaring (and risking drifting from) its own copy.

export const CHART_TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.5rem",
  fontSize: "12px",
  color: "hsl(var(--popover-foreground))",
};

// Recharts' default tooltip renders its label and item rows with their own
// inline color (defaulting to black) rather than inheriting contentStyle's
// `color` - without these, tooltip text is unreadable on a dark surface.
export const CHART_TOOLTIP_ITEM_STYLE = { color: "hsl(var(--popover-foreground))" };
export const CHART_TOOLTIP_LABEL_STYLE = { color: "hsl(var(--popover-foreground))", marginBottom: 4 };

export const CHART_GRID_STROKE = "hsl(var(--chart-grid))";
export const CHART_AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
export const CHART_CURSOR_FILL = "hsl(var(--secondary) / 0.6)";

// Fixed categorical order (see the dataviz palette convention) for charts
// with several same-kind series, e.g. the feature-contribution donut.
export const CHART_CATEGORICAL_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
];

export const TIER_CHART_COLOR: Record<Tier, string> = {
  Budget: "hsl(var(--tier-budget))",
  "Mid-Range": "hsl(var(--tier-mid))",
  Luxury: "hsl(var(--tier-luxury))",
};

export const TIER_BADGE_STYLES: Record<Tier, string> = {
  Budget: "bg-tier-budget/15 text-tier-budget border-tier-budget/40",
  "Mid-Range": "bg-tier-mid/15 text-tier-mid border-tier-mid/40",
  Luxury: "bg-tier-luxury/15 text-tier-luxury border-tier-luxury/40",
};
