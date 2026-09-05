from pydantic import BaseModel


class PredictionRequest(BaseModel):
    sqft: int
    bedrooms: int
    bathrooms: float
    city: str
    ageYears: int
    propertyType: str
