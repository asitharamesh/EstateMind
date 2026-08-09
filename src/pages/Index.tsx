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

  const handleSave = () => {
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
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="font-bold text-lg leading-none">
                Estate<span className="text-gradient">Mind</span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
                AI Property Intelligence
              </div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
              Model live · v2.4
            </span>
            <span className="font-mono">Live model metrics</span>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-6 pt-12 pb-8 relative">
        <div className="absolute inset-0 grid-pattern opacity-[0.07] pointer-events-none" />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs text-primary font-semibold mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Random Forest Ensemble · 250 Trees
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            Predict real estate prices with{" "}
            <span className="text-gradient">data-driven</span> precision.
          </h1>
          <p className="text-muted-foreground mt-4 text-lg max-w-2xl">
            EstateMind blends location intelligence, feature engineering, and a tuned
            Random Forest model trained on a public housing dataset to deliver explainable price estimates in real time.
          </p>
        </div>
      </section>

      {/* Tabs */}
      <main className="container mx-auto px-6 pb-16">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="bg-secondary/50 border border-border p-1 h-auto">
            <TabsTrigger value="predict" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
              <BarChart3 className="h-4 w-4" /> Prediction
            </TabsTrigger>
            <TabsTrigger value="compare" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
              <GitCompareArrows className="h-4 w-4" /> Compare
              {saved.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-background/30 text-[10px] font-mono">
                  {saved.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="model" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2 px-4 py-2">
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
                  <div className="glass rounded-2xl p-12 text-center shadow-card h-full flex flex-col items-center justify-center min-h-[400px]">
                    <div className="h-16 w-16 rounded-2xl bg-gradient-primary/20 border border-primary/30 flex items-center justify-center mb-4">
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
        EstateMind · Real Random Forest inference with Python and React
      </footer>
    </div>
  );
};

export default Index;
