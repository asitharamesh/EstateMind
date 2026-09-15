import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PredictionForm } from "@/components/dashboard/PredictionForm";
import { PredictionResultCard } from "@/components/dashboard/PredictionResultCard";
import { CompareView, type SavedItem } from "@/components/dashboard/CompareView";
import { ModelInsights } from "@/components/dashboard/ModelInsights";
import { ApiClientError } from "@/lib/api";
import { predictPrice, type PredictionInput, type PredictionResult } from "@/lib/predictionEngine";
import { fetchRegionCatalog, isValidated } from "@/lib/regions";
import { AlertTriangle, BarChart3, Brain, Building2, GitCompareArrows } from "lucide-react";
import { toast } from "sonner";

const Index = () => {
  const [tab, setTab] = useState("predict");
  const [current, setCurrent] = useState<{ input: PredictionInput; result: PredictionResult } | null>(null);
  const [saved, setSaved] = useState<SavedItem[]>([]);

  const regionsQuery = useQuery({ queryKey: ["regions"], queryFn: fetchRegionCatalog, retry: 1, staleTime: Infinity });
  const catalog = regionsQuery.data?.catalog;

  const predictMutation = useMutation({
    mutationFn: (input: PredictionInput) => {
      const region = catalog?.regions.filter(isValidated).find((r) => r.key === input.region);
      if (!region) throw new ApiClientError(0, "Select a region with a validated model.");
      return predictPrice(input, region);
    },
    onSuccess: (result, input) => setCurrent({ input, result }),
    onError: () => setCurrent(null),
  });

  const sameProperty = (item: SavedItem) =>
    !!current &&
    item.result.price === current.result.price &&
    item.input.zipcode === current.input.zipcode &&
    item.result.region === current.result.region;

  const handleSave = (label: string) => {
    if (!current) return;
    if (saved.length >= 3) {
      toast.error("You can compare up to 3 properties at once");
      return;
    }
    if (saved.some(sameProperty)) {
      toast.error("This property is already saved");
      return;
    }
    setSaved([...saved, { id: crypto.randomUUID(), label, input: current.input, result: current.result }]);
    toast.success("Saved to comparison");
  };

  const trainingNote = catalog?.regions
    .filter(isValidated)
    .map((r) => `${r.label}: ${r.model.dataset.timeSpan}`)
    .join("; ");

  return (
    <div className="min-h-screen relative">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="container mx-auto px-6 h-16 flex items-center">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="font-bold text-lg leading-none">
              Estate<span className="text-primary">Mind</span>
            </div>
          </div>
        </div>
      </header>

      <section className="container mx-auto px-6 pt-12 pb-8 relative">
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-semibold mb-4">
            Region-specific Random Forest models · trained on recorded home sales
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight text-foreground">
            Property price estimates, with the model's reasoning shown.
          </h1>
          <p className="text-muted-foreground mt-4 text-lg max-w-2xl">
            Each region is priced only by a model trained and tested on that region's own sales, in that dataset's
            price basis. Regions without validated data are shown as unavailable rather than guessed.
          </p>
          {trainingNote && <p className="text-xs text-muted-foreground mt-2">Training data — {trainingNote}.</p>}
        </div>
      </section>

      <main className="container mx-auto px-6 pb-16">
        {regionsQuery.data?.source === "snapshot" && (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            API unreachable — region details come from the last training run's snapshot.
          </div>
        )}

        {regionsQuery.isPending ? (
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
            <Skeleton className="h-[640px] rounded-2xl" />
            <Skeleton className="h-[400px] rounded-2xl" />
          </div>
        ) : regionsQuery.isError || !catalog ? (
          <div className="bg-card border border-border rounded-2xl p-12 text-center shadow-card flex flex-col items-center">
            <AlertTriangle className="h-8 w-8 text-warning mb-3" />
            <h3 className="text-xl font-semibold mb-2">Could not load supported regions</h3>
            <p className="text-muted-foreground text-sm mb-4">{regionsQuery.error?.message}</p>
            <Button variant="outline" onClick={() => regionsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="bg-secondary/50 border border-border p-1 h-auto">
              <TabsTrigger value="predict" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
                <BarChart3 className="h-4 w-4" /> Prediction
              </TabsTrigger>
              <TabsTrigger value="compare" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
                <GitCompareArrows className="h-4 w-4" /> Compare
                {saved.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-md bg-background/30 text-[10px] font-mono">{saved.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="model" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
                <Brain className="h-4 w-4" /> Model Insights
              </TabsTrigger>
            </TabsList>

            <TabsContent value="predict" className="mt-6">
              <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
                <PredictionForm regions={catalog.regions} onPredict={(input) => predictMutation.mutateAsync(input)} />
                <div>
                  {current ? (
                    <PredictionResultCard
                      result={current.result}
                      input={current.input}
                      onSave={handleSave}
                      isSaved={saved.some(sameProperty)}
                    />
                  ) : (
                    <div className="bg-card border border-border rounded-2xl p-12 text-center shadow-card h-full flex flex-col items-center justify-center min-h-[400px]">
                      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                        <BarChart3 className="h-8 w-8 text-primary" />
                      </div>
                      <h3 className="text-xl font-semibold mb-2">Ready to predict</h3>
                      <p className="text-muted-foreground text-sm max-w-md">
                        Enter property details on the left to see the estimate, its measured prediction interval, the
                        regional market tier, and which features drove the number.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="compare" className="mt-6">
              <CompareView saved={saved} onRemove={(id) => setSaved(saved.filter((s) => s.id !== id))} onClear={() => setSaved([])} />
            </TabsContent>

            <TabsContent value="model" className="mt-6">
              <ModelInsights catalog={catalog} />
            </TabsContent>
          </Tabs>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        EstateMind — region-specific Random Forest models served by FastAPI, rendered with React
      </footer>
    </div>
  );
};

export default Index;
