import { AmbiguousNetworkError, fetchWithTimeout, NetworkBeforeRequestError, readJson, retryIdempotent, type FetchLike } from '../../lib/http.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Outcome semantics for non-idempotent sends:
 *  - 'rejected': Gmail definitely did not accept the message (safe to retry later)
 *  - 'unknown' : Gmail may have accepted it (never retry automatically)
 */
export class GmailApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: 'auth' | 'scope' | 'rate_limit' | 'quota' | 'invalid' | 'not_found' | 'server' | 'network',
    public readonly outcome: 'rejected' | 'unknown',
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'network';
  }
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string }[] };
}

function classify(status: number, body: GoogleErrorBody | null): GmailApiError {
  const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
  const msg = body?.error?.message ?? `Gmail API returned HTTP ${status}`;
  if (status === 401) return new GmailApiError('Gmail authorization expired or was revoked.', status, 'auth', 'rejected', reason);
  if (status === 403 && /insufficient|SCOPE/i.test(`${reason} ${msg}`))
    return new GmailApiError('AutoReach does not have the Gmail permission needed for this action.', status, 'scope', 'rejected', reason);
  if (status === 429 || (status === 403 && /rateLimit|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(`${reason}`)))
    return new GmailApiError('Gmail rate limit reached. Try again in a few minutes.', status, 'rate_limit', 'rejected', reason);
  if (status === 403 && /dailyLimit|quota/i.test(`${reason} ${msg}`))
    return new GmailApiError('Gmail sending quota reached for today.', status, 'quota', 'rejected', reason);
  if (status === 404) return new GmailApiError(msg, status, 'not_found', 'rejected', reason);
  if (status >= 500) return new GmailApiError(`Gmail had a temporary error (HTTP ${status}).`, status, 'server', 'unknown', reason);
  return new GmailApiError(msg, status, 'invalid', 'rejected', reason);
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  historyId?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[]; mimeType?: string };
}

export function header(m: GmailMessageMeta, name: string): string | null {
  const h = m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

export const SYNC_HEADERS = [
  'From',
  'To',
  'Subject',
  'Date',
  'Message-ID',
  'In-Reply-To',
  'References',
  'Auto-Submitted',
  'X-Autoreply',
  'X-Autorespond',
  'X-Auto-Response-Suppress',
  'Precedence',
  'Content-Type',
  'Return-Path',
];

export class GmailClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly accessToken: string,
  ) {}

  private async getJson<T>(path: string, params: Record<string, string | string[] | undefined> = {}): Promise<T> {
    const url = new URL(`${GMAIL}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    // GETs are idempotent: retry transient failures.
    return retryIdempotent(
      async () => {
        let res: Response;
        try {
          res = await fetchWithTimeout(this.fetchImpl, url.toString(), { headers: { Authorization: `Bearer ${this.accessToken}` }, timeoutMs: 20_000 });
        } catch (err) {
          throw new GmailApiError((err as Error).message, 0, 'network', 'rejected');
        }
        if (!res.ok) throw classify(res.status, await readJson<GoogleErrorBody>(res));
        return (await res.json()) as T;
      },
      (err) => err instanceof GmailApiError && (err.kind === 'server' || err.kind === 'network' || err.kind === 'rate_limit'),
    );
  }

  /** NOT retried: a retry after an ambiguous failure could send the email twice. */
  async send(rawBase64Url: string, threadId?: string | null): Promise<{ id: string; threadId: string }> {
    let res: Response;
    try {
      res = await fetchWithTimeout(this.fetchImpl, `${GMAIL}/messages/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(threadId ? { raw: rawBase64Url, threadId } : { raw: rawBase64Url }),
        timeoutMs: 60_000,
      });
    } catch (err) {
      if (err instanceof NetworkBeforeRequestError) throw new GmailApiError(`Could not reach Gmail: ${err.message}`, 0, 'network', 'rejected');
      if (err instanceof AmbiguousNetworkError) throw new GmailApiError(`Connection to Gmail was interrupted: ${err.message}`, 0, 'network', 'unknown');
      throw err;
    }
    if (!res.ok) throw classify(res.status, await readJson<GoogleErrorBody>(res));
    const body = (await readJson<{ id?: string; threadId?: string }>(res)) ?? {};
    if (!body.id || !body.threadId) throw new GmailApiError('Gmail accepted the request but returned no message id.', res.status, 'server', 'unknown');
    return { id: body.id, threadId: body.threadId };
  }

  getMessageMetadata(id: string, headers: string[] = SYNC_HEADERS): Promise<GmailMessageMeta> {
    return this.getJson<GmailMessageMeta>(`/messages/${encodeURIComponent(id)}`, { format: 'metadata', metadataHeaders: headers });
  }

  getThreadMetadata(threadId: string, headers: string[] = SYNC_HEADERS): Promise<{ id: string; historyId?: string; messages?: GmailMessageMeta[] }> {
    return this.getJson(`/threads/${encodeURIComponent(threadId)}`, { format: 'metadata', metadataHeaders: headers });
  }

  listHistory(startHistoryId: string, pageToken?: string): Promise<{
    history?: { id: string; messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
    nextPageToken?: string;
    historyId: string;
  }> {
    return this.getJson('/history', { startHistoryId, historyTypes: 'messageAdded', pageToken, maxResults: '500' });
  }

  getProfile(): Promise<{ emailAddress: string; historyId: string }> {
    return this.getJson('/profile');
  }
}
