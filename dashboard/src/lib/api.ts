import { config } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenSource = { getToken: () => Promise<string | null>; refresh: () => Promise<string | null>; onUnauthenticated: () => void };
let tokens: TokenSource | null = null;

export function configureApi(source: TokenSource) {
  tokens = source;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  raw?: boolean;
}

async function doFetch(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(`${config.apiUrl}${path}`, { method: opts.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', `Can't reach the AutoReach API at ${config.apiUrl}. Check your connection or that the server is running.`);
  }
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let token = (await tokens?.getToken()) ?? null;
  let res = await doFetch(path, opts, token);
  if (res.status === 401 && tokens) {
    token = await tokens.refresh();
    if (token) res = await doFetch(path, opts, token);
    if (res.status === 401) {
      tokens.onUnauthenticated();
    }
  }
  if (opts.raw) {
    if (!res.ok) throw await toError(res);
    return res as unknown as T;
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code: string; message: string; details?: unknown; request_id?: string } };
    if (body.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details, body.error.request_id);
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, `HTTP_${res.status}`, `The server returned an unexpected error (${res.status}).`);
}

/** Download a file from an authenticated endpoint. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
