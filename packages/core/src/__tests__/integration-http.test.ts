import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationFetch, IntegrationError } from "../integrations/http";

afterEach(() => vi.unstubAllGlobals());

function response(status: number, retryAfter?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null) },
  } as unknown as Response;
}

describe("integrationFetch", () => {
  it("retries transient responses and returns the successful attempt", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetch);

    const result = await integrationFetch(
      "https://provider.test/data",
      {},
      {
        provider: "Provider",
        operation: "list data",
        maxRetries: 1,
        retryBaseMs: 0,
      },
    );

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("does not retry permanent client errors", async () => {
    const fetch = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal("fetch", fetch);

    const result = await integrationFetch(
      "https://provider.test/data",
      {},
      {
        provider: "Provider",
        operation: "list data",
        maxRetries: 3,
        retryBaseMs: 0,
      },
    );

    expect(result.status).toBe(401);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("raises a typed retryable error after exhausting attempts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(429, "0")));

    await expect(
      integrationFetch(
        "https://provider.test/data",
        {},
        {
          provider: "Provider",
          operation: "list data",
          maxRetries: 1,
          retryBaseMs: 0,
        },
      ),
    ).rejects.toMatchObject({
      name: "IntegrationError",
      provider: "Provider",
      operation: "list data",
      status: 429,
      retryable: true,
      retryAfterMs: 0,
    } satisfies Partial<IntegrationError>);
  });

  it("retries network failures and retains the final cause", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connection reset"));
    vi.stubGlobal("fetch", fetch);

    await expect(
      integrationFetch(
        "https://provider.test/data",
        {},
        {
          provider: "Provider",
          operation: "list data",
          maxRetries: 1,
          retryBaseMs: 0,
        },
      ),
    ).rejects.toMatchObject({ retryable: true, cause: expect.objectContaining({ message: "connection reset" }) });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
