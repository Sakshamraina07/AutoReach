import type { ApiErrorShape, ApiRequest, ApiResult, AuthState, Message } from './protocol';

/** Thrown by `api()`; carries the API's error code (e.g. GMAIL_NOT_CONNECTED). */
export class ExtensionApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  constructor(e: ApiErrorShape) {
    super(e.message);
    this.name = 'ExtensionApiError';
    this.status = e.status;
    this.code = e.code;
    this.details = e.details;
    this.requestId = e.requestId;
  }
}

export async function send<T>(message: Message): Promise<T> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch (err) {
    // The service worker restarts on demand; a failure here means the extension was reloaded or updated.
    throw new ExtensionApiError({
      status: 0,
      code: 'EXTENSION_UNAVAILABLE',
      message: `AutoReach's background service is not responding (${err instanceof Error ? err.message : 'unknown error'}). Close and reopen this panel.`,
    });
  }
}

/** Call the AutoReach API through the service worker. */
export async function api<T = unknown>(path: string, opts: Omit<ApiRequest, 'path'> = {}): Promise<T> {
  const res = await send<ApiResult<T>>({ type: 'api', request: { ...opts, path } });
  if (!res) throw new ExtensionApiError({ status: 0, code: 'NO_RESPONSE', message: 'No response from the AutoReach service worker.' });
  if (!res.ok) throw new ExtensionApiError(res.error);
  return res.data;
}

type AuthResponse = { ok: true; auth: AuthState } | { ok: false; error: ApiErrorShape };

export async function authCall(message: Extract<Message, { type: `auth:${string}` }>): Promise<AuthState> {
  const res = await send<AuthResponse>(message);
  if (!res.ok) throw new ExtensionApiError(res.error);
  return res.auth;
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}
