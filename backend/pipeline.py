"""Request admission: the single gate between a client payload and the
feature builder. The API admits one request; training and evaluation admit
every dataset row the same way, so the reported metrics describe exactly what
the API does.
"""
from typing import Any

import pandas as pd
from pydantic import ValidationError

from backend.features import FeatureSpec
from backend.schemas import REQUEST_FIELD_FOR, PredictionRequest, payload_from_record


class InputRejected(ValueError):
    """Region-domain rejection, reported per API field name."""

    def __init__(self, errors: list[dict[str, str]]):
        self.errors = [{"field": REQUEST_FIELD_FOR.get(e["field"], e["field"]), "message": e["message"]} for e in errors]
        super().__init__("; ".join(f"{e['field']}: {e['message']}" for e in self.errors))


def admit_request(spec: FeatureSpec, request: PredictionRequest) -> dict[str, Any]:
    record = request.to_record()
    errors = spec.validate_record(record)
    if errors:
        raise InputRejected(errors)
    return record


def admit_records(spec: FeatureSpec, records: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    """Push dataset rows through the public request contract, then the region
    domain. Returns the records rebuilt from the validated requests (original
    index kept) and a count of rejections keyed by the first failing field."""
    admitted_rows: list[dict[str, Any]] = []
    admitted_index = []
    rejected: dict[str, int] = {}
    for index, record in zip(records.index, records[list(spec.fields)].to_dict("records")):
        try:
            request = PredictionRequest.model_validate(payload_from_record(spec.region, record))
            admitted_rows.append(admit_request(spec, request))
        except ValidationError as exc:
            field = str(exc.errors()[0]["loc"][0])
            rejected[field] = rejected.get(field, 0) + 1
            continue
        except InputRejected as exc:
            field = exc.errors[0]["field"]
            rejected[field] = rejected.get(field, 0) + 1
            continue
        admitted_index.append(index)
    admitted = pd.DataFrame(admitted_rows, index=admitted_index, columns=list(spec.fields))
    return admitted, dict(sorted(rejected.items()))
