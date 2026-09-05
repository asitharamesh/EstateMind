from pydantic import BaseModel, Field


class PredictionRequest(BaseModel):
    # Bounds mirror the frontend's input limits (PredictionForm.tsx) so a
    # value the UI wouldn't let a user submit is rejected here too, with a
    # clear message, rather than silently clamped.
    sqft: int = Field(ge=500, le=8000)
    bedrooms: int = Field(ge=0, le=10)
    # Whole bathrooms only (natural numbers) - a UI/product decision, not a
    # dataset limitation: the training data does include fractional (half/
    # three-quarter) bathroom counts, but the product only collects whole
    # counts from users. That's still a valid input to the model, just a
    # restricted subset of what it saw in training.
    bathrooms: int = Field(ge=1, le=8)
    city: str
    ageYears: int = Field(ge=0, le=115)
    propertyType: str
