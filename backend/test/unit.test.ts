import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { decryptSecret, encryptSecret, pkceChallenge } from '../src/lib/crypto.js';
import { parseJsonObject } from '../src/services/ai/provider.js';
import { buildMime, encodeHeaderWords, formatAddress, textToHtml } from '../src/services/gmail/mime.js';
import { GmailApiError, GmailClient } from '../src/services/gmail/client.js';
import { heuristicExtract } from '../src/services/resumeParser.js';
import { classifyOpen, uaFamily } from '../src/services/tracking.js';
import { parseMime } from './helpers/fakeGoogle.js';

describe('crypto', () => {
  it('round-trips with AES-256-GCM and detects tampering', () => {
    const key = randomBytes(32);
    const env = encryptSecret('1//refresh-token', key);
    expect(env).toMatch(/^v1:/);
    expect(env).not.toContain('refresh');
    expect(decryptSecret(env, key)).toBe('1//refresh-token');
    const tampered = env.slice(0, -2) + (env.endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(env, randomBytes(32))).toThrow();
  });

  it('computes RFC 7636 S256 challenges', () => {
    // Test vector from RFC 7636 Appendix B
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('MIME builder', () => {
  it('encodes non-ASCII headers, blocks header injection and threads replies', () => {
    expect(encodeHeaderWords('Plain subject')).toBe('Plain subject');
    expect(encodeHeaderWords('Intern — Café')).toMatch(/^=\?UTF-8\?B\?/);
    expect(formatAddress({ email: 'a@b.io', name: 'Sam "SK" Kumar' })).toBe('"Sam \\"SK\\" Kumar" <a@b.io>');
    expect(() => formatAddress({ email: 'a@b.io\r\nBcc: evil@x.io' })).toThrow();
    const raw = buildMime({
      from: { email: 'sam@gmail.com', name: 'Sam' },
      to: { email: 'meera@northwind.dev', name: 'Meera' },
      subject: 'Hello\r\nBcc: evil@x.io',
      text: 'Line 1\n\nLine 2 https://example.dev/x?a=1&b=2',
      html: textToHtml('Line 1\n\nLine 2 <script>alert(1)</script> https://example.dev/x?a=1&b=2', 'https://api.test/t/tok.gif'),
      attachments: [{ filename: 'Résumé Sam.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4 test') }],
      inReplyTo: '<orig@mail.gmail.com>',
      references: ['<orig@mail.gmail.com>'],
    });
    const m = parseMime(raw);
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(m.headers.subject).toBe('Hello Bcc: evil@x.io');
    expect(m.headers['in-reply-to']).toBe('<orig@mail.gmail.com>');
    expect(m.text).toContain('Line 2');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('<a href="https://example.dev/x?a=1&amp;b=2">');
    expect(m.html).toContain('src="https://api.test/t/tok.gif"');
    expect(m.attachments[0]!.headers).toContain(`filename*=UTF-8''R%C3%A9sum%C3%A9%20Sam.pdf`);
    expect(m.attachments[0]!.content.toString()).toBe('%PDF-1.4 test');
    expect(raw.split('\r\n').every((l) => l.length <= 998)).toBe(true);
  });
});

describe('tracking classification', () => {
  it('keeps only coarse user-agent families and is conservative', () => {
    expect(uaFamily('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)')).toBe('gmail_proxy');
    expect(uaFamily('python-requests/2.31')).toBe('scanner');
    expect(uaFamily('Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.1)')).toBe('outlook');
    expect(uaFamily(undefined)).toBe('unknown');
    expect(classifyOpen({ secondsSinceSent: 5, family: 'gmail_proxy', senderViewing: false })).toBe('suspected_self');
    expect(classifyOpen({ secondsSinceSent: 5000, family: 'gmail_proxy', senderViewing: true })).toBe('suspected_self');
    expect(classifyOpen({ secondsSinceSent: 5000, family: 'scanner', senderViewing: false })).toBe('suspected_automated');
    expect(classifyOpen({ secondsSinceSent: 5000, family: 'gmail_proxy', senderViewing: false })).toBe('proxy');
    expect(classifyOpen({ secondsSinceSent: 5000, family: 'browser_or_mail_app', senderViewing: false })).toBe('open_detected');
  });
});

describe('Gmail client error mapping', () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
  it('maps statuses to outcomes that decide whether a retry could duplicate an email', async () => {
    const send = (status: number, reason = 'x') => new GmailClient(respond(status, { error: { code: status, message: 'm', errors: [{ reason }] } }), 't').send('raw');
    await expect(send(401)).rejects.toMatchObject({ kind: 'auth', outcome: 'rejected' });
    await expect(send(403, 'insufficientPermissions')).rejects.toMatchObject({ kind: 'scope', outcome: 'rejected' });
    await expect(send(429, 'rateLimitExceeded')).rejects.toMatchObject({ kind: 'rate_limit', outcome: 'rejected' });
    await expect(send(403, 'userRateLimitExceeded')).rejects.toMatchObject({ kind: 'rate_limit', outcome: 'rejected' });
    await expect(send(500, 'backendError')).rejects.toMatchObject({ kind: 'server', outcome: 'unknown' });
    await expect(send(400, 'invalidArgument')).rejects.toMatchObject({ kind: 'invalid', outcome: 'rejected' });
    const noId = new GmailClient(respond(200, {}), 't');
    await expect(noId.send('raw')).rejects.toBeInstanceOf(GmailApiError);
  });

  it('retries idempotent reads on transient errors', async () => {
    let n = 0;
    const flaky = async () => {
      n += 1;
      return n < 2 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ emailAddress: 'a@b.io', historyId: '5' }), { status: 200 });
    };
    const p = await new GmailClient(flaky, 't').getProfile();
    expect(p.historyId).toBe('5');
    expect(n).toBe(2);
  });
});

describe('AI JSON parsing', () => {
  it('tolerates fences and prose but rejects arrays', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Sure! {"subject":"x","body":"he said \\"}\\" ok"} trailing')).toEqual({ subject: 'x', body: 'he said "}" ok' });
    expect(parseJsonObject('[1,2]')).toBeNull();
    expect(parseJsonObject('nothing')).toBeNull();
  });
});

describe('résumé heuristics', () => {
  it('extracts only what is present', () => {
    const r = heuristicExtract('Asha Verma\nasha.v@mail.dev\nEducation\nB.E. Information Technology, Example College of Engineering, 2025\nProjects\nPayTrack\n- Expense tracker in Flutter and Firebase serving 300 users');
    expect(r.full_name).toBe('Asha Verma');
    expect(r.degree).toMatch(/^B\.E\. Information Technology/);
    expect(r.university).toBe('B.E. Information Technology, Example College of Engineering');
    expect(r.graduation_year).toBe(2025);
    expect(r.projects?.[0]).toMatchObject({ name: 'PayTrack', technologies: ['Flutter', 'Firebase'] });
    expect(r.projects?.[0]?.achievements[0]).toContain('300 users');
    expect(r.links?.github).toBeNull();
  });
});

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgres://u@localhost/db', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
  it('fails fast with actionable messages', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ENABLE_DEV_LOGIN: 'true' })).toThrow(/ENABLE_DEV_LOGIN must not be set in production/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/STORAGE_DRIVER=local is for development only/);
    expect(() => loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: 'short' })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...base, ENABLE_DEV_LOGIN: 'true', DEV_JWT_SECRET: 's', DATABASE_URL: 'postgres://u@db.example.com/x' })).toThrow(/only allowed with a local database/);
  });
  it('disables optional integrations with an explicit reason', () => {
    const c = loadConfig(base);
    expect(c.gmail.configured).toBe(false);
    expect(c.gmail.reason).toMatch(/GOOGLE_CLIENT_ID/);
    expect(c.ai.provider).toBeNull();
    expect(c.tracking.configured).toBe(false);
    expect(c.storage.driver).toBe('local');
    const c2 = loadConfig({ ...base, AI_PROVIDER: 'groq', AI_MODEL: 'llama-3.3-70b-versatile' });
    expect(c2.ai.provider).toBeNull();
    expect(c2.ai.reason).toMatch(/AI_API_KEY is required/);
    const c3 = loadConfig({ ...base, AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-sonnet-5-5', AI_API_KEY: 'k', API_PUBLIC_URL: 'https://api.example.dev/' });
    expect(c3.ai.provider).toBe('anthropic');
    expect(c3.tracking.configured).toBe(true);
    expect(c3.apiPublicUrl).toBe('https://api.example.dev');
  });
});
