import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  ApiServerError,
  ApiUnreachableError,
  ApiValidationError,
  apiRequest,
} from "@/lib/api";

function respond(status: number, body?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(body === undefined ? "Bad Gateway" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": body === undefined ? "text/plain" : "application/json" },
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest error classification", () => {
  it("returns JSON on success", async () => {
    respond(200, { ok: true });
    await expect(apiRequest("/x")).resolves.toEqual({ ok: true });
  });

  it("turns a FastAPI 422 into per-field validation errors", async () => {
    respond(422, {
      detail: [
        { loc: ["body", "zipcode"], msg: "99999 is not a supported zipcode for this region" },
        { loc: ["body", "region"], msg: "Value error, Unknown region 'atlantis'" },
        { loc: ["body", 1], msg: "JSON decode error" },
      ],
    });
    const error = (await apiRequest("/x").catch((e: unknown) => e)) as ApiValidationError;
    expect(error).toBeInstanceOf(ApiValidationError);
    expect(error.fieldErrors).toEqual({
      zipcode: "99999 is not a supported zipcode for this region",
      region: "Unknown region 'atlantis'",
    });
    expect(error.formErrors).toEqual(["JSON decode error"]);
  });

  it("surfaces other 4xx messages from the API", async () => {
    respond(404, { detail: "Unknown region 'atlantis'" });
    const error = (await apiRequest("/x").catch((e: unknown) => e)) as ApiClientError;
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.message).toBe("Unknown region 'atlantis'");
  });

  it("treats an API 500 as a server error, not as offline", async () => {
    respond(500, { detail: "The prediction service encountered an error. Please try again." });
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiServerError);
  });

  it("treats an API-generated 503 (JSON detail) as a server error", async () => {
    respond(503, { detail: "overloaded" });
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiServerError);
  });

  it("treats a gateway 502 without an API body as unreachable", async () => {
    respond(502);
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiUnreachableError);
  });

  it("treats a non-JSON 500 as a server error", async () => {
    respond(500);
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiServerError);
  });

  it("treats a network failure as unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiUnreachableError);
  });
});
