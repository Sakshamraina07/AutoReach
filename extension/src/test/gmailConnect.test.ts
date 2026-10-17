import { describe, expect, it, vi } from 'vitest';
import { connectGmail, type GmailConnectDeps } from '../background/gmailConnect';
import type { ApiRequest } from '../lib/protocol';

const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/gmail';
const CONSENT = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=st-1';

function deps(launchResult: string | Error | undefined, completeOk = true) {
  const requests: ApiRequest[] = [];
  const d: GmailConnectDeps = {
    redirectUrl: REDIRECT,
    api: vi.fn(async (req: ApiRequest) => {
      requests.push(req);
      if (req.path.endsWith('/authorize')) return { ok: true as const, status: 200, data: { url: CONSENT } };
      return completeOk
        ? { ok: true as const, status: 200, data: { email: 'me@student-mail.dev', return_to: 'extension' } }
        : { ok: false as const, error: { status: 400, code: 'OAUTH_STATE_INVALID', message: 'expired' } };
    }) as GmailConnectDeps['api'],
    launch: vi.fn(async () => {
      if (launchResult instanceof Error) throw launchResult;
      return launchResult;
    }),
  };
  return { d, requests };
}

describe('Gmail connection from the extension', () => {
  it('starts with the chromiumapp.org redirect and completes with the returned code', async () => {
    const { d, requests } = deps(`${REDIRECT}?gmail_code=c-1&state=st-1`);
    expect(await connectGmail(d)).toEqual({ ok: true, email: 'me@student-mail.dev' });
    expect(requests[0]).toEqual({ method: 'POST', path: '/api/integrations/gmail/authorize', body: { return_to: 'extension', extension_redirect: REDIRECT } });
    expect(d.launch).toHaveBeenCalledWith(CONSENT);
    expect(requests[1]).toEqual({ method: 'POST', path: '/api/integrations/gmail/complete', body: { code: 'c-1', state: 'st-1' } });
  });

  it('rejects a response for a different connection attempt', async () => {
    const { d, requests } = deps(`${REDIRECT}?gmail_code=c-1&state=someone-elses`);
    const r = await connectGmail(d);
    expect(r.ok).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('reports a declined consent and a closed window without completing', async () => {
    const declined = deps(`${REDIRECT}?gmail_error=access_denied&state=st-1`);
    expect(await connectGmail(declined.d)).toMatchObject({ ok: false, error: { code: 'GMAIL_CONNECT_DECLINED' } });
    const closed = deps(new Error('The user did not approve access.'));
    expect(await connectGmail(closed.d)).toMatchObject({ ok: false, error: { code: 'GMAIL_CONNECT_CANCELLED' } });
    expect(declined.requests).toHaveLength(1);
    expect(closed.requests).toHaveLength(1);
  });

  it('passes the API error through when completion fails', async () => {
    const { d } = deps(`${REDIRECT}?gmail_code=c-1&state=st-1`, false);
    expect(await connectGmail(d)).toMatchObject({ ok: false, error: { code: 'OAUTH_STATE_INVALID' } });
  });
});

describe('dashboard fallback link', () => {
  it('carries an unsaved address from the Gmail card so the dashboard can offer to add it', async () => {
    const { dashboardComposeLink } = await import('../lib/config');
    const known = new URL(dashboardComposeLink({ recruiterId: 'r-1', recruiterEmail: 'ignored@x.dev' }));
    expect(known.pathname).toBe('/outreach/new');
    expect(known.searchParams.get('recruiter')).toBe('r-1');
    expect(known.searchParams.get('email')).toBeNull();
    const unknown = new URL(dashboardComposeLink({ recruiterEmail: 'new.person@contoso.dev', recruiterName: 'New Person' }));
    expect(unknown.searchParams.get('email')).toBe('new.person@contoso.dev');
    expect(unknown.searchParams.get('name')).toBe('New Person');
    expect(new URL(dashboardComposeLink({ draftId: 'd-1', recruiterEmail: 'a@b.dev' })).search).toBe('?draft=d-1');
  });
});
