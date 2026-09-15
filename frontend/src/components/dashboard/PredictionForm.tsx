import { useState, type ReactNode } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Home, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ApiValidationError, VALIDATION_MESSAGE } from "@/lib/api";
import { describePredictionError, type PredictionInput } from "@/lib/predictionEngine";
import {
  buildPredictionSchema,
  defaultFormValues,
  type PredictionFormValues,
} from "@/lib/predictionSchema";
import { isValidated, type RegionEntry, type ValidatedRegion } from "@/lib/regions";

interface PredictionFormProps {
  regions: RegionEntry[];
  onPredict: (input: PredictionInput) => Promise<unknown>;
}

type FieldName = keyof PredictionFormValues;
const FIELD_NAMES: FieldName[] = ["region", "zipcode", "sqft", "bedrooms", "bathrooms", "ageYears", "grade", "view", "waterfront"];

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && (
        <p className="text-xs text-destructive" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

const invalidClass = (error?: string) => (error ? "border-destructive focus-visible:ring-destructive" : undefined);

export function PredictionForm({ regions, onPredict }: PredictionFormProps) {
  const validated = regions.filter(isValidated);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The schema depends on the selected region's domain, so it is rebuilt
  // from the values being validated rather than captured once.
  const resolver: Resolver<PredictionFormValues, unknown, PredictionInput> = (values, context, options) => {
    const region = validated.find((r) => r.key === values.region);
    if (!region) {
      return { values: {}, errors: { region: { type: "validate", message: "Select a region with a validated model" } } };
    }
    // zodResolver's types don't carry the schema's transformed output type.
    return zodResolver(buildPredictionSchema(region))(values, context, options) as ReturnType<
      Resolver<PredictionFormValues, unknown, PredictionInput>
    >;
  };

  const form = useForm<PredictionFormValues, unknown, PredictionInput>({
    mode: "onTouched",
    defaultValues: validated[0] ? defaultFormValues(validated[0]) : undefined,
    resolver,
  });
  const { errors, isSubmitting } = form.formState;
  const regionKey = form.watch("region");
  const region: ValidatedRegion | undefined = validated.find((r) => r.key === regionKey) ?? validated[0];

  if (!region) {
    return (
      <Card className="shadow-card border-border">
        <CardContent className="p-6 text-sm text-muted-foreground">
          No region currently has a validated model, so no prediction can be made.
        </CardContent>
      </Card>
    );
  }
  const domain = region.inputDomain;

  const onValid = async (input: PredictionInput) => {
    setSubmitError(null);
    try {
      await onPredict(input);
    } catch (error) {
      if (error instanceof ApiValidationError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if ((FIELD_NAMES as string[]).includes(field)) {
            form.setError(field as FieldName, { type: "server", message });
          } else {
            error.formErrors.push(`${field}: ${message}`);
          }
        }
      }
      setSubmitError(describePredictionError(error).message);
    }
  };

  const onRegionChange = (key: string) => {
    const next = validated.find((r) => r.key === key);
    if (!next) return;
    const defaults = defaultFormValues(next);
    form.setValue("region", key);
    form.setValue("zipcode", defaults.zipcode);
    form.setValue("grade", defaults.grade);
    form.setValue("view", defaults.view);
    form.setValue("waterfront", defaults.waterfront);
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
        <form onSubmit={form.handleSubmit(onValid, () => setSubmitError(VALIDATION_MESSAGE))} noValidate className="space-y-5">
          <Field id="region" label="Region" error={errors.region?.message}>
            <Controller
              name="region"
              control={form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={onRegionChange}>
                  <SelectTrigger id="region" aria-invalid={!!errors.region} className={invalidClass(errors.region?.message)}>
                    <SelectValue placeholder="Select a region" />
                  </SelectTrigger>
                  <SelectContent>
                    {regions.map((r) => (
                      <SelectItem key={r.key} value={r.key} disabled={!isValidated(r)}>
                        {r.label}
                        {!isValidated(r) && <span className="text-muted-foreground"> · Not validated</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-[11px] text-muted-foreground">
              Only regions with their own validated training data can be priced.
            </p>
          </Field>

          <Field id="zipcode" label="Zip code" hint={`${domain.zipcodes.length} supported`} error={errors.zipcode?.message}>
            <Input
              id="zipcode"
              inputMode="numeric"
              maxLength={5}
              list="zipcode-options"
              aria-invalid={!!errors.zipcode}
              className={invalidClass(errors.zipcode?.message)}
              {...form.register("zipcode")}
            />
            <datalist id="zipcode-options">
              {domain.zipcodes.map((zip) => (
                <option key={zip} value={zip} />
              ))}
            </datalist>
          </Field>

          <Field
            id="sqft"
            label="Square footage"
            hint={`${domain.sqft.min.toLocaleString()} – ${domain.sqft.max.toLocaleString()} sq ft`}
            error={errors.sqft?.message}
          >
            <Input id="sqft" inputMode="numeric" aria-invalid={!!errors.sqft} className={invalidClass(errors.sqft?.message)} {...form.register("sqft")} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field id="bedrooms" label="Bedrooms" hint={`${domain.bedrooms.min} – ${domain.bedrooms.max}`} error={errors.bedrooms?.message}>
              <Input id="bedrooms" inputMode="numeric" aria-invalid={!!errors.bedrooms} className={invalidClass(errors.bedrooms?.message)} {...form.register("bedrooms")} />
            </Field>
            <Field id="bathrooms" label="Bathrooms" hint={`${domain.bathrooms.min} – ${domain.bathrooms.max}`} error={errors.bathrooms?.message}>
              <Input id="bathrooms" inputMode="numeric" aria-invalid={!!errors.bathrooms} className={invalidClass(errors.bathrooms?.message)} {...form.register("bathrooms")} />
            </Field>
          </div>

          <Controller
            name="ageYears"
            control={form.control}
            render={({ field }) => (
              <Field id="age" label="Age at sale" hint={`${field.value} yrs`} error={errors.ageYears?.message}>
                <Slider
                  id="age"
                  min={domain.ageYears.min}
                  max={domain.ageYears.max}
                  step={1}
                  value={[field.value]}
                  onValueChange={([value]) => field.onChange(value)}
                />
              </Field>
            )}
          />

          {domain.grade && (
            <Controller
              name="grade"
              control={form.control}
              render={({ field }) => (
                <Field id="grade" label="Construction grade" hint={`${domain.grade!.min} – ${domain.grade!.max}`} error={errors.grade?.message}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="grade" aria-invalid={!!errors.grade} className={invalidClass(errors.grade?.message)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(domain.grade.labels).map(([level, label]) => (
                        <SelectItem key={level} value={level}>
                          {level} — {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Assessor building grade from the {region.model.dataset.name} records. The scale is specific to this
                    region's assessments and does not transfer to other markets.
                  </p>
                </Field>
              )}
            />
          )}

          {(domain.view || domain.waterfront) && (
            <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
              {domain.view && (
                <Controller
                  name="view"
                  control={form.control}
                  render={({ field }) => (
                    <Field id="view" label="View quality" error={errors.view?.message}>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="view" aria-invalid={!!errors.view} className={invalidClass(errors.view?.message)}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(domain.view.labels).map(([level, label]) => (
                            <SelectItem key={level} value={level}>
                              {level} — {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
              )}
              {domain.waterfront && (
                <Controller
                  name="waterfront"
                  control={form.control}
                  render={({ field }) => (
                    <Field id="waterfront" label="Waterfront" error={errors.waterfront?.message}>
                      <div className="h-10 flex items-center">
                        <Switch id="waterfront" checked={field.value} onCheckedChange={field.onChange} />
                      </div>
                    </Field>
                  )}
                />
              )}
            </div>
          )}
          {!domain.grade && !domain.view && !domain.waterfront && (
            <p className="text-[11px] text-muted-foreground">
              {region.label}'s dataset doesn't record a construction grade, view rating or waterfront flag, so this
              model doesn't use them.
            </p>
          )}

          {submitError && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full" size="lg">
            {isSubmitting ? (
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
