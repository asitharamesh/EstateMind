import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PredictionForm } from "@/components/dashboard/PredictionForm";
import { PredictionResultCard } from "@/components/dashboard/PredictionResultCard";
import { ApiServerError, ApiValidationError, SERVER_ERROR_MESSAGE, VALIDATION_MESSAGE } from "@/lib/api";
import { OFFLINE_MESSAGE, offlineEstimate, type PredictionInput } from "@/lib/predictionEngine";
import { modelPrediction, regions, validatedRegion } from "./fixtures";

const input: PredictionInput = {
  region: "seattle",
  zipcode: "98103",
  sqft: 1800,
  bedrooms: 3,
  bathrooms: 2,
  ageYears: 30,
  grade: 7,
  view: 0,
  waterfront: false,
};

const submit = () => fireEvent.click(screen.getByRole("button", { name: /predict price/i }));

describe("PredictionForm", () => {
  it("blocks invalid input client-side and highlights the field", async () => {
    const onPredict = vi.fn();
    render(<PredictionForm regions={regions} onPredict={onPredict} />);
    fireEvent.change(screen.getByLabelText("Square footage"), { target: { value: "abc" } });
    submit();
    expect(await screen.findByText("Enter a valid number")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(VALIDATION_MESSAGE);
    expect(screen.getByLabelText("Square footage")).toHaveAttribute("aria-invalid", "true");
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("maps an API 422 onto the highlighted field", async () => {
    const onPredict = vi.fn().mockRejectedValue(new ApiValidationError({ zipcode: "98001 is not supported" }, []));
    render(<PredictionForm regions={regions} onPredict={onPredict} />);
    submit();
    expect(await screen.findByText("98001 is not supported")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(VALIDATION_MESSAGE);
    expect(screen.getByLabelText("Zip code")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a server error as a server error", async () => {
    render(<PredictionForm regions={regions} onPredict={vi.fn().mockRejectedValue(new ApiServerError(500))} />);
    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(SERVER_ERROR_MESSAGE));
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it("submits the typed API payload", async () => {
    const onPredict = vi.fn().mockResolvedValue(undefined);
    render(<PredictionForm regions={regions} onPredict={onPredict} />);
    fireEvent.change(screen.getByLabelText("Bathrooms"), { target: { value: "3" } });
    submit();
    await waitFor(() => expect(onPredict).toHaveBeenCalledTimes(1));
    expect(onPredict.mock.calls[0][0]).toEqual({
      region: "seattle",
      zipcode: "98001",
      sqft: 1800,
      bedrooms: 3,
      bathrooms: 3,
      ageYears: 30,
      grade: 8,
      view: 0,
      waterfront: false,
    });
  });
});

describe("PredictionResultCard", () => {
  const renderCard = (result: Parameters<typeof PredictionResultCard>[0]["result"]) =>
    render(<PredictionResultCard result={result} input={input} onSave={vi.fn()} isSaved={false} />);

  it.each([
    ["Budget", 12],
    ["Mid-Range", 50],
    ["Luxury", 91],
  ] as const)("renders the %s tier from the API percentile", (label, percentile) => {
    renderCard(modelPrediction({ tier: { ...modelPrediction().tier, label, percentile } }));
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`Priced above ${percentile}% of 17,260 training sales`))).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE_MESSAGE, { exact: false })).not.toBeInTheDocument();
  });

  it("reports measured interval coverage, not a confidence score", () => {
    renderCard(modelPrediction());
    expect(screen.getByText("80.2%")).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it("labels an offline estimate and shows no tier", () => {
    renderCard(offlineEstimate(input, validatedRegion));
    expect(screen.getByRole("status")).toHaveTextContent(OFFLINE_MESSAGE);
    expect(screen.queryByText("Mid-Range")).not.toBeInTheDocument();
    expect(screen.queryByText(/percentile/i)).not.toBeInTheDocument();
  });
});
