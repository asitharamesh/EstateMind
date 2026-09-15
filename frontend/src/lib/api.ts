/**
 * HTTP client for the EstateMind API. Every failure is classified, because the
 * UI must react differently to each one:
 *
 *  - ApiValidationError  (422)        the user can fix an input
 *  - ApiClientError      (other 4xx)  show the API's own message
 *  - ApiServerError      (5xx)        the service failed; never disguised as "offline"
 *  - ApiUnreachableError              no API response at all: network failure, timeout,
 *                                     or a gateway/proxy 502/503/504 without an API error
 *                                     body. The ONLY case that may use the offline estimate.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 15_000;
const GATEWAY_STATUSES = new Set([502, 503, 504]);

export const VALIDATION_MESSAGE = "Please correct the highlighted inputs.";
export const SERVER_ERROR_MESSAGE = "The prediction service encountered an error. Please try again.";

export class ApiValidationError extends Error {
  readonly status = 422;
  constructor(
    readonly fieldErrors: Record<string, string>,
    readonly formErrors: string[],
  ) {
    super(VALIDATION_MESSAGE);
    this.name = "ApiValidationError";
  }
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export class ApiServerError extends Error {
  constructor(readonly status: number) {
    super(SERVER_ERROR_MESSAGE);
    this.name = "ApiServerError";
  }
}

export class ApiUnreachableError extends Error {
  constructor(
    message: string,
    readonly underlying?: unknown,
  ) {
    super(message);
    this.name = "ApiUnreachableError";
  }
}

interface ErrorDetail {
  loc?: (string | number)[];
  msg?: string;
}

/** FastAPI 422 detail -> messages per request field (plus non-field messages). */
export function parseValidationDetail(detail: ErrorDetail[]) {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  for (const item of detail) {
    const message = (item.msg ?? "Invalid value").replace(/^Value error, /, "");
    const loc = item.loc ?? [];
    const field = loc.length === 2 && loc[0] === "body" && typeof loc[1] === "string" ? loc[1] : null;
    if (field && !(field in fieldErrors)) fieldErrors[field] = message;
    else if (!field) formErrors.push(message);
  }
  return { fieldErrors, formErrors };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ApiUnreachableError(`Could not reach the EstateMind API (${path})`, error);
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return (await response.json()) as T;

  const body: unknown = await response.json().catch(() => null);
  const detail = body !== null && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;

  if (detail === undefined && GATEWAY_STATUSES.has(response.status)) {
    throw new ApiUnreachableError(`Gateway returned ${response.status}: the API is not reachable`);
  }
  if (response.status === 422 && Array.isArray(detail)) {
    const { fieldErrors, formErrors } = parseValidationDetail(detail as ErrorDetail[]);
    throw new ApiValidationError(fieldErrors, formErrors);
  }
  if (response.status >= 500) throw new ApiServerError(response.status);
  throw new ApiClientError(
    response.status,
    typeof detail === "string" ? detail : `Request failed with status ${response.status}`,
  );
}
