import { describe, expect, it, vi } from 'vitest';
import { callApi, type ApiDeps } from '../background/api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deps(responses: (Response | Error)[], tokens: { get?: string | null; refreshed?: string | null } = {}): ApiDeps & { calls: RequestInit[]; urls: string[] } {
  const calls: RequestInit[] = [];
  const urls: string[] = [];
  return {
    apiUrl: 'https://api.autoreach.example',
    calls,
    urls,
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      calls.push(init ?? {});
      const r = responses.shift();
      if (!r) throw new Error('no more responses');
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch,
    getToken: async () => ('get' in tokens ? tokens.get! : 'tok-1'),
    refreshToken: async () => ('refreshed' in tokens ? tokens.refreshed! : 'tok-2'),
  };
}

describe('service-worker API client', () => {
  it('sends the bearer token, JSON body and idempotency key', async () => {
    const d = deps([json(200, { ok: 1 })]);
    const r = await callApi({ method: 'POST', path: '/api/messages/1/send', body: { queue: false }, idempotencyKey: 'k-1' }, d);
    expect(r).toEqual({ ok: true, status: 200, data: { ok: 1 } });
    const h = d.calls[0]!.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok-1');
    expect(h['Idempotency-Key']).toBe('k-1');
    expect(d.calls[0]!.body).toBe('{"queue":false}');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const d = deps([json(401, { error: { code: 'SESSION_EXPIRED' } }), json(200, [1])]);
    const r = await callApi({ path: '/api/me' }, d);
    expect(r.ok).toBe(true);
    expect((d.calls[1]!.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('reports an expired session when refresh fails, without looping', async () => {
    const d = deps([json(401, {})], { refreshed: null });
    const r = await callApi({ path: '/api/me' }, d);
    expect(r).toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } });
    expect(d.calls).toHaveLength(1);
  });

  it('does not call the API when signed out', async () => {
    const d = deps([], { get: null });
    expect(await callApi({ path: '/api/me' }, d)).toMatchObject({ ok: false, error: { code: 'SIGNED_OUT' } });
    expect(d.calls).toHaveLength(0);
  });

  it('passes API error codes through and explains network failures', async () => {
    const d = deps([json(409, { error: { code: 'DUPLICATE_OUTREACH', message: 'Already emailed', request_id: 'req-1' } }), new TypeError('Failed to fetch')]);
    expect(await callApi({ method: 'POST', path: '/api/messages/1/send', body: {} }, d)).toMatchObject({ ok: false, error: { status: 409, code: 'DUPLICATE_OUTREACH', requestId: 'req-1' } });
    const net = await callApi({ method: 'POST', path: '/api/messages/1/send', body: {} }, d);
    expect(net).toMatchObject({ ok: false, error: { code: 'NETWORK_ERROR' } });
    expect(!net.ok && net.error.message).toMatch(/check Outreach before trying again/);
  });

  it('handles 204 and non-JSON errors', async () => {
    const d = deps([new Response(null, { status: 204 }), new Response('<html>Bad gateway</html>', { status: 502 })]);
    expect(await callApi({ method: 'DELETE', path: '/api/x' }, d)).toEqual({ ok: true, status: 204, data: null });
    expect(await callApi({ path: '/api/x' }, d)).toMatchObject({ ok: false, error: { status: 502, code: 'HTTP_502' } });
  });
});

describe('message senders', async () => {
  const { isAllowedSender } = await import('../background/senders');
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const tab = { id: 1 } as chrome.tabs.Tab;
  it('trusts extension pages, even when opened in a tab', () => {
    expect(isAllowedSender('api', { id, url: `chrome-extension://${id}/popup.html` }, id)).toBe(true);
    expect(isAllowedSender('auth:signOut', { id, tab, url: `chrome-extension://${id}/sidepanel.html` }, id)).toBe(true);
  });
  it('limits the Gmail content script to its read-only helpers', () => {
    const gmail = { id, tab, url: 'https://mail.google.com/mail/u/0/#inbox' };
    expect(isAllowedSender('gmail:lookup', gmail, id)).toBe(true);
    expect(isAllowedSender('compose:open', gmail, id)).toBe(true);
    expect(isAllowedSender('api', gmail, id)).toBe(false);
    expect(isAllowedSender('auth:signOut', gmail, id)).toBe(false);
  });
  it('rejects other extensions and other sites', () => {
    expect(isAllowedSender('gmail:lookup', { id: 'other', tab, url: 'https://mail.google.com/' }, id)).toBe(false);
    expect(isAllowedSender('gmail:lookup', { id, tab, url: 'https://evil.example/' }, id)).toBe(false);
    expect(isAllowedSender('api', { id, url: 'chrome-extension://other/popup.html' }, id)).toBe(false);
  });
});
