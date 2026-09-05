import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowRight, Home, Loader2 } from "lucide-react";
import { CITIES, PROPERTY_TYPE_LABELS, type PredictionInput, type PropertyType } from "@/lib/predictionEngine";

interface PredictionFormProps {
  onPredict: (input: PredictionInput) => void | Promise<void>;
  loading: boolean;
}

const PROPERTY_TYPES = Object.entries(PROPERTY_TYPE_LABELS) as [PropertyType, string][];

// Mirrors the backend's clamp range (backend/valuation.py) so a value that
// can't be submitted here can't silently be clamped to something else
// server-side either - both layers agree on what's realistic. All three
// fields are whole numbers only (the backend schema types them as `int`),
// so bathrooms - like sqft and bedrooms - can't be a fraction such as 0.5.
const NUMERIC_FIELDS = {
  sqft: { min: 500, max: 8000, step: 50, label: "Square footage", unit: "sq ft" },
  bedrooms: { min: 0, max: 10, step: 1, label: "Bedrooms", unit: "bedrooms" },
  bathrooms: { min: 1, max: 8, step: 1, label: "Bathrooms", unit: "bathrooms" },
} as const;

type NumericField = keyof typeof NUMERIC_FIELDS;

// Strips anything that isn't a digit as the user types, so a decimal point,
// minus sign, or "e" (all valid in a native number input) can never end up
// in one of these whole-number fields in the first place.
function sanitizeIntegerInput(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

// Belt-and-suspenders: sanitizeIntegerInput already blocks non-digit
// characters on every keystroke, so this only matters for input methods
// that bypass onChange filtering (e.g. paste, spinner arrows).
function blockNonIntegerKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
}

function fieldError(field: NumericField, raw: string): string | null {
  const { min, max, label, unit } = NUMERIC_FIELDS[field];
  if (raw.trim() === "") return `${label} is required`;
  const value = Number(raw);
  if (Number.isNaN(value)) return `Enter a valid number`;
  if (!Number.isInteger(value)) return `${label} must be a whole number`;
  if (value < min) return `Must be at least ${min.toLocaleString()} ${unit}`;
  if (value > max) return `Must be ${max.toLocaleString()} ${unit} or less`;
  return null;
}

export function PredictionForm({ onPredict, loading }: PredictionFormProps) {
  const [sqftInput, setSqftInput] = useState("1800");
  const [bedroomsInput, setBedroomsInput] = useState("3");
  const [bathroomsInput, setBathroomsInput] = useState("2");
  const [city, setCity] = useState("seattle");
  const [ageYears, setAgeYears] = useState(10);
  const [propertyType, setPropertyType] = useState<PropertyType>("house");

  const values: Record<NumericField, string> = {
    sqft: sqftInput,
    bedrooms: bedroomsInput,
    bathrooms: bathroomsInput,
  };
  const setters: Record<NumericField, (v: string) => void> = {
    sqft: setSqftInput,
    bedrooms: setBedroomsInput,
    bathrooms: setBathroomsInput,
  };
  const errors: Record<NumericField, string | null> = {
    sqft: fieldError("sqft", sqftInput),
    bedrooms: fieldError("bedrooms", bedroomsInput),
    bathrooms: fieldError("bathrooms", bathroomsInput),
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const clampOnBlur = (field: NumericField) => {
    const { min, max } = NUMERIC_FIELDS[field];
    const raw = values[field];
    const value = Number(raw);
    if (raw.trim() === "" || Number.isNaN(value)) {
      setters[field](String(min));
      return;
    }
    setters[field](String(Math.max(min, Math.min(max, Math.round(value)))));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasErrors) return;
    onPredict({
      sqft: Number(sqftInput),
      bedrooms: Number(bedroomsInput),
      bathrooms: Number(bathroomsInput),
      city,
      ageYears,
      propertyType,
    });
  };

  return (
    <Card className="shadow-card border-border">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Home className="h-4 w-4 text-primary" />
          </div>
          Property Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sqft">Square Footage</Label>
              <span className="text-xs text-muted-foreground">500 - 8,000 sq ft</span>
            </div>
            <Input
              id="sqft"
              type="number"
              min={NUMERIC_FIELDS.sqft.min}
              max={NUMERIC_FIELDS.sqft.max}
              step={NUMERIC_FIELDS.sqft.step}
              value={sqftInput}
              aria-invalid={!!errors.sqft}
              className={errors.sqft ? "border-destructive focus-visible:ring-destructive" : undefined}
              onChange={(e) => setSqftInput(sanitizeIntegerInput(e.target.value))}
              onKeyDown={blockNonIntegerKeys}
              onBlur={() => clampOnBlur("sqft")}
            />
            {errors.sqft && <p className="text-xs text-destructive">{errors.sqft}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="bedrooms">Bedrooms</Label>
                <span className="text-xs text-muted-foreground">0 - 10</span>
              </div>
              <Input
                id="bedrooms"
                type="number"
                min={NUMERIC_FIELDS.bedrooms.min}
                max={NUMERIC_FIELDS.bedrooms.max}
                step={NUMERIC_FIELDS.bedrooms.step}
                value={bedroomsInput}
                aria-invalid={!!errors.bedrooms}
                className={errors.bedrooms ? "border-destructive focus-visible:ring-destructive" : undefined}
                onChange={(e) => setBedroomsInput(sanitizeIntegerInput(e.target.value))}
                onKeyDown={blockNonIntegerKeys}
                onBlur={() => clampOnBlur("bedrooms")}
              />
              {errors.bedrooms && <p className="text-xs text-destructive">{errors.bedrooms}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="bathrooms">Bathrooms</Label>
                <span className="text-xs text-muted-foreground">1 - 8</span>
              </div>
              <Input
                id="bathrooms"
                type="number"
                inputMode="numeric"
                min={NUMERIC_FIELDS.bathrooms.min}
                max={NUMERIC_FIELDS.bathrooms.max}
                step={NUMERIC_FIELDS.bathrooms.step}
                value={bathroomsInput}
                aria-invalid={!!errors.bathrooms}
                className={errors.bathrooms ? "border-destructive focus-visible:ring-destructive" : undefined}
                onChange={(e) => setBathroomsInput(sanitizeIntegerInput(e.target.value))}
                onKeyDown={blockNonIntegerKeys}
                onBlur={() => clampOnBlur("bathrooms")}
              />
              {errors.bathrooms && <p className="text-xs text-destructive">{errors.bathrooms}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger id="city">
                <SelectValue placeholder="Select a city" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CITIES).map(([key, meta]) => (
                  <SelectItem key={key} value={key}>
                    {meta.label}{" "}
                    <span className="text-muted-foreground">· {meta.region}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="age">Property Age</Label>
              <span className="text-sm font-mono text-muted-foreground">{ageYears} yrs</span>
            </div>
            <Slider
              id="age"
              min={0}
              max={115}
              step={1}
              value={[ageYears]}
              onValueChange={([v]) => setAgeYears(v)}
            />
          </div>

          <div className="space-y-2">
            <Label>Property Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {PROPERTY_TYPES.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setPropertyType(value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    propertyType === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/70"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading || hasErrors}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Running model...
              </>
            ) : (
              <>
                Predict Price <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
