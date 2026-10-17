/**
 * In-memory stand-in for Google's OAuth and Gmail REST endpoints, injected as
 * the `fetch` implementation. It records every request so tests can assert on
 * exactly what would have been sent to Gmail.
 */

export type SendBehaviour =
  | { kind: 'ok' }
  | { kind: 'http'; status: number; reason?: string; message?: string }
  | { kind: 'network-before' }
  | { kind: 'network-ambiguous' };

export interface FakeMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate: string;
  headers: Record<string, string>;
}

export interface SentRecord {
  raw: string;
  threadId: string | null;
  accessToken: string;
}

export class FakeGoogle {
  sendQueue: SendBehaviour[] = [];
  sent: SentRecord[] = [];
  messages = new Map<string, FakeMessage>();
  historyId = 1000;
  historyRecords: { id: string; messagesAdded: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[] = [];
  historyExpired = false;
  /** Other hosts' answers by exact URL (job boards in the career-ops tests). */
  external = new Map<string, { status: number; body: unknown }>();
  tokenResponses: Array<Record<string, unknown> | { error: string; status: number }> = [];
  requests: { method: string; url: string }[] = [];
  revoked: string[] = [];
  accountEmail = 'student@gmail.com';
  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq.toString(16).padStart(6, '0')}`;
  }

  /** Simulate an inbound message arriving in Gmail (adds a history record). */
  deliverInbound(m: Omit<FakeMessage, 'id' | 'internalDate'> & { at?: Date }): FakeMessage {
    const msg: FakeMessage = { id: this.nextId('in'), threadId: m.threadId, labelIds: m.labelIds ?? ['INBOX'], internalDate: String((m.at ?? new Date()).getTime()), headers: m.headers };
    this.messages.set(msg.id, msg);
    this.historyId += 1;
    this.historyRecords.push({ id: String(this.historyId), messagesAdded: [{ message: { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds } }] });
    return msg;
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  private metadata(m: FakeMessage, only?: string[]) {
    const names = only?.length ? only.map((h) => h.toLowerCase()) : null;
    return {
      id: m.id,
      threadId: m.threadId,
      labelIds: m.labelIds,
      internalDate: m.internalDate,
      historyId: String(this.historyId),
      payload: {
        headers: Object.entries(m.headers)
          .filter(([k]) => !names || names.includes(k.toLowerCase()))
          .map(([name, value]) => ({ name, value })),
      },
    };
  }

  fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    this.requests.push({ method, url: url.toString() });
    const auth = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '');

    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const next = this.tokenResponses.shift();
      if (next && 'error' in next && typeof next.status === 'number') return this.json(next.status, { error: next.error, error_description: `fake ${String(next.error)}` });
      return this.json(200, next ?? { access_token: `at-${this.nextId('')}`, expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata openid email', token_type: 'Bearer' });
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      this.revoked.push(new URLSearchParams(String(init.body)).get('token') ?? '');
      return this.json(200, {});
    }
    if (url.host === 'openidconnect.googleapis.com') return this.json(200, { email: this.accountEmail, email_verified: true });

    if (url.host === 'gmail.googleapis.com') {
      const p = url.pathname.replace('/gmail/v1/users/me', '');
      if (p === '/messages/send' && method === 'POST') {
        const behaviour = this.sendQueue.shift() ?? { kind: 'ok' };
        if (behaviour.kind === 'network-before') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        if (behaviour.kind === 'network-ambiguous') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        const body = JSON.parse(String(init.body)) as { raw: string; threadId?: string };
        this.sent.push({ raw: Buffer.from(body.raw, 'base64url').toString('utf8'), threadId: body.threadId ?? null, accessToken: auth.replace('Bearer ', '') });
        if (behaviour.kind === 'http') {
          return this.json(behaviour.status, { error: { code: behaviour.status, message: behaviour.message ?? `fake error ${behaviour.status}`, errors: [{ reason: behaviour.reason ?? 'fake' }] } });
        }
        const threadId = body.threadId ?? this.nextId('th');
        const id = this.nextId('sent');
        this.messages.set(id, {
          id,
          threadId,
          labelIds: ['SENT'],
          internalDate: String(Date.now()),
          headers: { From: this.accountEmail, 'Message-ID': `<CAF${id}@mail.gmail.com>`, Subject: 'sent' },
        });
        return this.json(200, { id, threadId, labelIds: ['SENT'] });
      }
      if (p.startsWith('/messages/') && method === 'GET') {
        const m = this.messages.get(decodeURIComponent(p.slice('/messages/'.length)));
        if (!m) return this.json(404, { error: { code: 404, message: 'Not Found' } });
        return this.json(200, this.metadata(m, url.searchParams.getAll('metadataHeaders')));
      }
      if (p.startsWith('/threads/') && method === 'GET') {
        const threadId = decodeURIComponent(p.slice('/threads/'.length));
        const msgs = [...this.messages.values()].filter((m) => m.threadId === threadId).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
        if (!msgs.length) return this.json(404, { error: { code: 404, message: 'Not Found' } });
        return this.json(200, { id: threadId, historyId: String(this.historyId), messages: msgs.map((m) => this.metadata(m)) });
      }
      if (p === '/history') {
        if (this.historyExpired) return this.json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
        const start = Number(url.searchParams.get('startHistoryId'));
        const history = this.historyRecords.filter((h) => Number(h.id) > start);
        return this.json(200, { history, historyId: String(this.historyId) });
      }
      if (p === '/profile') return this.json(200, { emailAddress: this.accountEmail, historyId: String(this.historyId) });
    }
    const external = this.external.get(url.toString());
    if (external) return this.json(external.status, external.body);
    throw new Error(`FakeGoogle: unexpected request ${method} ${url}`);
  };
}

/** Parse a raw MIME message just enough for assertions. */
export function parseMime(raw: string) {
  const [head = '', ...rest] = raw.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r\n[ \t]/g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  const body = rest.join('\r\n\r\n');
  const parts: { headers: string; content: Buffer }[] = [];
  const re = /Content-Type: ([^\r\n]+)(?:\r\n[^\r\n]+)*\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g;
  for (const m of body.matchAll(re)) {
    const block = m[0];
    const hdrs = block.slice(0, block.indexOf('\r\n\r\n'));
    if (/multipart\//.test(m[1] ?? '')) continue;
    parts.push({ headers: hdrs, content: Buffer.from((m[2] ?? '').replace(/\r\n/g, ''), 'base64') });
  }
  const text = parts.find((p) => /text\/plain/.test(p.headers))?.content.toString('utf8') ?? '';
  const html = parts.find((p) => /text\/html/.test(p.headers))?.content.toString('utf8') ?? '';
  const attachments = parts.filter((p) => /Content-Disposition: attachment/i.test(p.headers));
  return { headers, text, html, attachments };
}
