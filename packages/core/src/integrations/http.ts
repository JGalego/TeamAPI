export interface IntegrationHttpOptions {
  /** Per-attempt timeout. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** Retries after the first attempt for network, rate-limit and transient server failures. Defaults to 2. */
  maxRetries?: number;
  /** Initial exponential-backoff delay. Defaults to 250ms; set to zero in deterministic tests. */
  retryBaseMs?: number;
  /** Hard stop for provider pagination, protecting against cyclic or malformed cursors. Defaults to 1000. */
  maxPages?: number;
}

export interface IntegrationRequestOptions extends IntegrationHttpOptions {
  provider: string;
  operation: string;
}

export class IntegrationError extends Error {
  readonly provider: string;
  readonly operation: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(options: {
    provider: string;
    operation: string;
    message: string;
    status?: number;
    retryable?: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "IntegrationError";
    this.provider = options.provider;
    this.operation = options.operation;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function retryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Fetches with bounded retries and a timeout on every attempt.
 *
 * Authentication and other permanent 4xx responses are returned to the provider client so it can
 * preserve provider-specific handling. Transient responses are retried, then raised as a typed
 * error carrying enough information for `doctor` and callers to explain whether retrying helps.
 */
export async function integrationFetch(
  url: string,
  init: RequestInit,
  options: IntegrationRequestOptions,
): Promise<Response> {
  const attempts = (options.maxRetries ?? 2) + 1;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const base = options.retryBaseMs ?? 250;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!RETRYABLE_STATUS.has(response.status)) return response;

      const wait = retryAfter(response.headers.get("retry-after")) ?? base * 2 ** attempt;
      if (attempt + 1 < attempts) {
        await delay(wait);
        continue;
      }
      throw new IntegrationError({
        provider: options.provider,
        operation: options.operation,
        status: response.status,
        retryable: true,
        retryAfterMs: wait,
        message: `${options.provider} ${options.operation} failed after ${attempts} attempt(s): ${response.status} ${response.statusText}`,
      });
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      if (attempt + 1 < attempts) {
        await delay(base * 2 ** attempt);
        continue;
      }
      throw new IntegrationError({
        provider: options.provider,
        operation: options.operation,
        retryable: true,
        cause: error,
        message: `${options.provider} ${options.operation} failed after ${attempts} attempt(s): ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  throw new Error("unreachable");
}

export function isIntegrationStatus(error: unknown, status: number): boolean {
  return error instanceof IntegrationError && error.status === status;
}

/** Keeps credentials and provider-specific fields out of the retained transport options object. */
export function integrationHttpOptions(options: IntegrationHttpOptions): IntegrationHttpOptions {
  return {
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    retryBaseMs: options.retryBaseMs,
    maxPages: options.maxPages,
  };
}
