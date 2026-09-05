import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PredictionForm } from "@/components/dashboard/PredictionForm";
import { PredictionResultCard } from "@/components/dashboard/PredictionResultCard";
import { CompareView, type SavedItem } from "@/components/dashboard/CompareView";
import { ModelInsights } from "@/components/dashboard/ModelInsights";
import {
  predictPrice,
  type PredictionInput,
  type PredictionResult,
} from "@/lib/predictionEngine";
import { Building2, BarChart3, GitCompareArrows, Brain } from "lucide-react";
import { toast } from "sonner";

const Index = () => {
  const [tab, setTab] = useState("predict");
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<{
    input: PredictionInput;
    result: PredictionResult;
  } | null>(null);
  const [saved, setSaved] = useState<SavedItem[]>([]);

  const handlePredict = async (input: PredictionInput) => {
    setLoading(true);
    try {
      const result = await predictPrice(input);
      setCurrent({ input, result });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = (label: string) => {
    if (!current) return;
    if (saved.length >= 3) {
      toast.error("You can compare up to 3 properties at once");
      return;
    }
    if (saved.some((s) => s.result.price === current.result.price && s.input.city === current.input.city)) {
      toast.error("This property is already saved");
      return;
    }
    const item: SavedItem = {
      id: crypto.randomUUID(),
      label,
      input: current.input,
      result: current.result,
    };
    setSaved([...saved, item]);
    toast.success("Saved to comparison");
  };

  const isSaved =
    !!current &&
    saved.some(
      (s) => s.result.price === current.result.price && s.input.city === current.input.city,
    );

  return (
    <div className="min-h-screen relative">
      {/* Top nav */}
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

      {/* Hero */}
      <section className="container mx-auto px-6 pt-12 pb-8 relative">
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-semibold mb-4">
            Random Forest Regressor · trained on real King County home sales
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight text-foreground">
            Property price estimates, with the model's reasoning shown.
          </h1>
          <p className="text-muted-foreground mt-4 text-lg max-w-2xl">
            Enter a property's details to get a price estimate, a confidence range, and which
            features actually drove the number — all computed from a Random Forest trained on
            real home-sale data, not a canned formula.
          </p>
        </div>
      </section>

      {/* Tabs */}
      <main className="container mx-auto px-6 pb-16">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="bg-secondary/50 border border-border p-1 h-auto">
            <TabsTrigger value="predict" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
              <BarChart3 className="h-4 w-4" /> Prediction
            </TabsTrigger>
            <TabsTrigger value="compare" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
              <GitCompareArrows className="h-4 w-4" /> Compare
              {saved.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-background/30 text-[10px] font-mono">
                  {saved.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="model" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
              <Brain className="h-4 w-4" /> Model Insights
            </TabsTrigger>
          </TabsList>

          <TabsContent value="predict" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
              <PredictionForm onPredict={handlePredict} loading={loading} />
              <div>
                {current ? (
                  <PredictionResultCard
                    result={current.result}
                    input={current.input}
                    onSave={handleSave}
                    isSaved={isSaved}
                  />
                ) : (
                  <div className="bg-card border border-border rounded-2xl p-12 text-center shadow-card h-full flex flex-col items-center justify-center min-h-[400px]">
                    <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                      <BarChart3 className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Ready to predict</h3>
                    <p className="text-muted-foreground text-sm max-w-md">
                      Configure property details on the left and run the model to see
                      a full price breakdown, market positioning, and explainability.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="compare" className="mt-6">
            <CompareView
              saved={saved}
              onRemove={(id) => setSaved(saved.filter((s) => s.id !== id))}
              onClear={() => setSaved([])}
            />
          </TabsContent>

          <TabsContent value="model" className="mt-6">
            <ModelInsights />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        EstateMind — a Random Forest price model served by FastAPI, rendered with React
      </footer>
    </div>
  );
};

export default Index;
