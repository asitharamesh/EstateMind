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
import { Home, Loader2, Sparkles } from "lucide-react";
import { CITIES, type PredictionInput, type PropertyType } from "@/lib/predictionEngine";

interface PredictionFormProps {
  onPredict: (input: PredictionInput) => void | Promise<void>;
  loading: boolean;
}

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "studio", label: "Studio" },
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "villa", label: "Villa" },
];

export function PredictionForm({ onPredict, loading }: PredictionFormProps) {
  const [sqft, setSqft] = useState(1800);
  const [bedrooms, setBedrooms] = useState(3);
  const [bathrooms, setBathrooms] = useState(2);
  const [city, setCity] = useState("seattle");
  const [ageYears, setAgeYears] = useState(10);
  const [propertyType, setPropertyType] = useState<PropertyType>("house");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onPredict({ sqft, bedrooms, bathrooms, city, ageYears, propertyType });
  };

  return (
    <Card className="glass shadow-card border-border">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="h-8 w-8 rounded-lg bg-gradient-primary/20 border border-primary/30 flex items-center justify-center">
            <Home className="h-4 w-4 text-primary" />
          </div>
          Property Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="sqft">Square Footage</Label>
            <Input
              id="sqft"
              type="number"
              min={500}
              max={8000}
              step={50}
              value={sqft}
              onChange={(e) => setSqft(Number(e.target.value))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bedrooms">Bedrooms</Label>
              <Input
                id="bedrooms"
                type="number"
                min={0}
                max={10}
                step={1}
                value={bedrooms}
                onChange={(e) => setBedrooms(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bathrooms">Bathrooms</Label>
              <Input
                id="bathrooms"
                type="number"
                min={0.5}
                max={8}
                step={0.5}
                value={bathrooms}
                onChange={(e) => setBathrooms(Number(e.target.value))}
              />
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
              {PROPERTY_TYPES.map((type) => (
                <button
                  type="button"
                  key={type.value}
                  onClick={() => setPropertyType(type.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    propertyType === type.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/70"
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Running model...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Predict Price
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
