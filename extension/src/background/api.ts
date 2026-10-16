import type { ApiErrorShape, ApiRequest, ApiResult } from '../lib/protocol';

export interface ApiDeps {
  apiUrl: string;
  fetch: typeof fetch;
  getToken: () => Promise<string | null>;
  refreshToken: () => Promise<string | null>;
}

const fail = (error: ApiErrorShape): ApiResult<never> => ({ ok: false, error });

/**
 * Calls the AutoReach API with the signed-in user's token. A 401 triggers one
 * token refresh and one retry. Requests that change state carry an
 * Idempotency-Key from the caller, so retrying them is safe on the server.
 */
export async function callApi<T = unknown>(req: ApiRequest, deps: ApiDeps): Promise<ApiResult<T>> {
  let token = await deps.getToken();
  if (!token) return fail({ status: 401, code: 'SIGNED_OUT', message: 'Sign in to AutoReach first.' });

  const doFetch = async (t: string): Promise<Response | ApiErrorShape> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${t}` };
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
    try {
      return await deps.fetch(`${deps.apiUrl}${req.path}`, {
        method: req.method ?? 'GET',
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
    } catch {
      return {
        status: 0,
        code: 'NETWORK_ERROR',
        message: `Can't reach AutoReach (${deps.apiUrl}). Check your connection.${req.method && req.method !== 'GET' ? ' If you were sending an email, check Outreach before trying again.' : ''}`,
      };
    }
  };

  let res = await doFetch(token);
  if (!(res instanceof Response)) return fail(res);
  if (res.status === 401) {
    token = await deps.refreshToken();
    if (!token) return fail({ status: 401, code: 'SESSION_EXPIRED', message: 'Your AutoReach session expired. Sign in again.' });
    res = await doFetch(token);
    if (!(res instanceof Response)) return fail(res);
    if (res.status === 401) return fail({ status: 401, code: 'SESSION_EXPIRED', message: 'Your AutoReach session expired. Sign in again.' });
  }
  if (res.status === 204) return { ok: true, status: 204, data: null as T };
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: unknown; request_id?: string } } | null)?.error;
    return fail({
      status: res.status,
      code: e?.code ?? `HTTP_${res.status}`,
      message: e?.message ?? `AutoReach returned an unexpected error (${res.status}).`,
      details: e?.details,
      requestId: e?.request_id,
    });
  }
  return { ok: true, status: res.status, data: body as T };
}
