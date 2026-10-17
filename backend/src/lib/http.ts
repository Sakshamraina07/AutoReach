/**
 * Thin wrapper around fetch with a timeout and a classification of failures
 * that matters for non-idempotent calls (sending email):
 *
 *   - `NetworkBeforeRequestError`: the request was never written (DNS failure,
 *     connection refused). Safe to treat as "not sent".
 *   - `AmbiguousNetworkError`: the connection dropped or timed out after the
 *     request may have been received. The outcome is unknown.
 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class NetworkBeforeRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkBeforeRequestError';
  }
}

export class AmbiguousNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AmbiguousNetworkError';
  }
}

const PRE_REQUEST_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UND_ERR_CONNECT_TIMEOUT']);

function causeCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const code = (e as { code?: string }).code;
    if (code) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 20_000, ...rest } = init;
  try {
    return await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const code = causeCode(err);
    if (code && PRE_REQUEST_CODES.has(code)) throw new NetworkBeforeRequestError(`Could not connect (${code})`, { cause: err });
    if ((err as Error)?.name === 'TimeoutError') throw new AmbiguousNetworkError(`Timed out after ${timeoutMs} ms`, { cause: err });
    throw new AmbiguousNetworkError((err as Error)?.message ?? 'Network error', { cause: err });
  }
}

export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry an IDEMPOTENT operation with exponential backoff and jitter. */
export async function retryIdempotent<T>(op: () => Promise<T>, shouldRetry: (err: unknown) => boolean, attempts = 3, baseMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err)) break;
      await sleep(baseMs * 2 ** i + Math.floor(Math.random() * baseMs));
    }
  }
  throw lastErr;
}
