import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import type { Deps } from '../src/context.js';
import { decryptSecret, encryptSecret, pkceChallenge } from '../src/lib/crypto.js';
import { AiProviderError, GeminiProvider, geminiThinkingConfig, parseJsonObject } from '../src/services/ai/provider.js';
import { buildMime, encodeHeaderWords, formatAddress, textToHtml } from '../src/services/gmail/mime.js';
import { GmailApiError, GmailClient } from '../src/services/gmail/client.js';
import { fetchJobFromBoard, htmlToText, jobBoardTarget } from '../src/services/jobFetch.js';
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

describe('Gemini provider', () => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('asks Gemini 3 models to think at "low" and leaves room for thinking in the output limit', async () => {
    let sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      sent = { url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
      return reply({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"ok":true}' }] }, finishReason: 'STOP' }] });
    };
    const out = await new GeminiProvider(fetchImpl, 'gemini-3.8-flash', 'test-key').complete({ system: 'sys', user: 'hi', maxTokens: 1200, temperature: 0.4, json: true });
    expect(out).toBe('{"ok":true}'); // thought parts are never returned as the answer
    expect(sent!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(sent!.headers['x-goog-api-key']).toBe('test-key');
    expect(sent!.body.generationConfig).toEqual({
      temperature: 0.4,
      maxOutputTokens: 1200 + 4096,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect(sent!.body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
  });

  it('uses a thinking budget for Gemini 2.5 and nothing for older models', () => {
    expect(geminiThinkingConfig('gemini-3.5-flash-lite')).toEqual({ thinkingConfig: { thinkingLevel: 'low' } });
    expect(geminiThinkingConfig('gemini-2.5-flash')).toEqual({ thinkingConfig: { thinkingBudget: 512 } });
    expect(geminiThinkingConfig('gemini-2.5-pro')).toEqual({ thinkingConfig: { thinkingBudget: 1024 } });
    expect(geminiThinkingConfig('gemini-1.5-flash')).toEqual({});
  });

  it('reports an empty answer (e.g. the limit was spent thinking) as a provider error', async () => {
    const fetchImpl = async () => reply({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] });
    const err = await new GeminiProvider(fetchImpl, 'gemini-3.8-flash', 'k').complete({ system: 's', user: 'u', maxTokens: 10, temperature: 0, json: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).message).toMatch(/MAX_TOKENS/);
  });

  it('passes on rate limiting as a 429', async () => {
    const fetchImpl = async () => reply({ error: { message: 'Resource has been exhausted' } }, 429);
    const err = await new GeminiProvider(fetchImpl, 'gemini-3.8-flash', 'k').complete({ system: 's', user: 'u', maxTokens: 10, temperature: 0, json: false }).catch((e: unknown) => e);
    expect((err as AiProviderError).status).toBe(429);
  });
});

describe('reading a posting from its job board', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const LONG = 'Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards. Work with PostgreSQL.';

  it('only knows the three boards, and only their posting links', () => {
    expect(jobBoardTarget('https://boards.greenhouse.io/northwind/jobs/4012345')).toEqual({ board: 'greenhouse', api: 'https://boards-api.greenhouse.io/v1/boards/northwind/jobs/4012345' });
    expect(jobBoardTarget('https://job-boards.greenhouse.io/northwind/jobs/4012345')?.board).toBe('greenhouse');
    expect(jobBoardTarget('https://jobs.lever.co/northwind/5f1c2a3b-aaaa-bbbb-cccc-1234567890ab')).toEqual({ board: 'lever', api: 'https://api.lever.co/v0/postings/northwind/5f1c2a3b-aaaa-bbbb-cccc-1234567890ab' });
    expect(jobBoardTarget('https://jobs.eu.lever.co/northwind/abc-123/apply')?.api).toBe('https://api.eu.lever.co/v0/postings/northwind/abc-123');
    expect(jobBoardTarget('https://jobs.ashbyhq.com/northwind/0a1b2c3d-1111-2222-3333-444455556666/application')).toMatchObject({ board: 'ashby', api: 'https://api.ashbyhq.com/posting-api/job-board/northwind', jobId: '0a1b2c3d-1111-2222-3333-444455556666' });
    // Anything else, or anything that tries to steer the request, is refused.
    expect(jobBoardTarget('https://www.linkedin.com/jobs/view/123')).toBeNull();
    expect(jobBoardTarget('https://boards.greenhouse.io/northwind/jobs/12ab')).toBeNull();
    expect(jobBoardTarget('https://boards.greenhouse.io/north%2F..%2Fwind/jobs/1')).toBeNull();
    expect(jobBoardTarget('https://evil.example/boards.greenhouse.io/x/jobs/1')).toBeNull();
    expect(jobBoardTarget('javascript:alert(1)')).toBeNull();
  });

  it("turns board HTML (Greenhouse's arrives entity-encoded) into readable text", () => {
    expect(htmlToText('&lt;p&gt;You will build &amp;amp; ship APIs.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Node.js&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;')).toBe('You will build & ship APIs.\n\n- Node.js\n- SQL');
    expect(htmlToText('<p>Café&nbsp;team<br>Remote</p>')).toBe('Café team\nRemote');
  });

  it('reads Greenhouse, Lever and Ashby postings', async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL) => {
      const u = String(input);
      calls.push(u);
      if (u.startsWith('https://boards-api.greenhouse.io/')) return json({ title: 'Backend Intern', location: { name: 'Bengaluru' }, content: `&lt;p&gt;${LONG}&lt;/p&gt;` });
      if (u.startsWith('https://api.lever.co/')) return json({ text: 'Backend Intern', categories: { location: 'Pune' }, descriptionPlain: LONG, lists: [{ text: 'Requirements', content: '<li>Git</li>' }], additionalPlain: '' });
      if (u.startsWith('https://api.ashbyhq.com/')) {
        return json({ jobs: [
          { title: 'Other role', jobUrl: 'https://jobs.ashbyhq.com/northwind/other-id', descriptionPlain: 'x'.repeat(200) },
          { title: 'Backend Intern', location: 'Remote', jobUrl: 'https://jobs.ashbyhq.com/northwind/job-42', descriptionPlain: LONG },
        ] });
      }
      return json({}, 404);
    };
    const gh = await fetchJobFromBoard(fetchImpl, 'https://boards.greenhouse.io/northwind/jobs/4012345');
    expect(gh).toMatchObject({ board: 'greenhouse', title: 'Backend Intern', location: 'Bengaluru' });
    expect(gh!.text).toContain('REST APIs in Node.js');
    const lv = await fetchJobFromBoard(fetchImpl, 'https://jobs.lever.co/northwind/abc-123');
    expect(lv!.text).toMatch(/Requirements\n- Git/);
    const ab = await fetchJobFromBoard(fetchImpl, 'https://jobs.ashbyhq.com/northwind/job-42');
    expect(ab).toMatchObject({ board: 'ashby', title: 'Backend Intern', location: 'Remote' });
    expect(await fetchJobFromBoard(fetchImpl, 'https://jobs.ashbyhq.com/northwind/closed-job')).toBeNull();
    expect(await fetchJobFromBoard(fetchImpl, 'https://example.org/careers/1')).toBeNull();
    // Only the boards' own API hosts were contacted.
    expect(calls.every((u) => /^https:\/\/(boards-api\.greenhouse\.io|api\.lever\.co|api\.ashbyhq\.com)\//.test(u))).toBe(true);
  });

  it('reports a closed or empty posting as not found', async () => {
    expect(await fetchJobFromBoard(async () => json({}, 404), 'https://boards.greenhouse.io/n/jobs/1')).toBeNull();
    expect(await fetchJobFromBoard(async () => json({ title: 'x', content: '&lt;p&gt;short&lt;/p&gt;' }), 'https://boards.greenhouse.io/n/jobs/1')).toBeNull();
    expect(await fetchJobFromBoard(async () => { throw new TypeError('fetch failed'); }, 'https://boards.greenhouse.io/n/jobs/1')).toBeNull();
  });
});

describe('résumé heuristics', () => {
  it('extracts only what is present', () => {
    const r = heuristicExtract('Asha Verma\nasha.v@mail.dev\nEducation\nB.E. Information Technology, Example College of Engineering, 2025\nProjects\nPayTrack\n- Expense tracker in Flutter and Firebase serving 300 users');
    expect(r.full_name).toBe('Asha Verma');
    expect(r.degree).toMatch(/^B\.E\. Information Technology/);
    expect(r.university).toBe('Example College of Engineering');
    expect(r.graduation_year).toBe(2025);
    expect(r.projects?.[0]).toMatchObject({ name: 'PayTrack', technologies: ['Flutter', 'Firebase'] });
    expect(r.projects?.[0]?.achievements[0]).toContain('300 users');
    expect(r.links?.github).toBeNull();
  });

  it('separates the college from the degree and dates', () => {
    expect(heuristicExtract('Ravi Shah\nEducation\nIndian Institute of Technology, Bombay | 2021 - 2025').university).toBe('Indian Institute of Technology, Bombay');
    expect(heuristicExtract('Ravi Shah\nEducation: B.Tech Computer Science, Example University, 2026').university).toBe('Example University');
    expect(heuristicExtract('Ravi Shah\nEducation\nExample Institute of Technology (2022-2026)').university).toBe('Example Institute of Technology');
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
    // A career-ops folder on a hosted server must name its owner.
    const prod = { ...base, NODE_ENV: 'production', STORAGE_DRIVER: 'supabase', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect(() => loadConfig({ ...prod, CAREER_OPS_DIR: '/srv/career-ops' })).toThrow(/CAREER_OPS_OWNER_EMAIL/);
    expect(loadConfig({ ...prod, CAREER_OPS_DIR: '/srv/career-ops', CAREER_OPS_OWNER_EMAIL: 'Me@Example.dev' }).careerOps).toEqual({ dir: '/srv/career-ops', ownerEmail: 'me@example.dev' });
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

describe('contact discovery suggestions', () => {
  const baseDeps = (over: Record<string, unknown> = {}) =>
    ({
      config: { hunterApiKey: undefined },
      logger: { warn: () => undefined },
      fetch: async () => {
        throw new Error('network not expected');
      },
      ...over,
    }) as unknown as Deps;

  it('labels every pattern guess unverified and never claims verification', async () => {
    const { suggestEmails } = await import('../src/services/discovery.js');
    const r = await suggestEmails(baseDeps(), { full_name: 'Meera Iyer', domain: 'Contoso.example' });
    expect(r.suggestions.map((s) => s.email)).toEqual(['meera.iyer@contoso.example', 'meeraiyer@contoso.example', 'miyer@contoso.example', 'meera@contoso.example']);
    expect(r.suggestions.every((s) => s.verification === 'unverified_guess' && s.source === 'Common address pattern')).toBe(true);
    expect(r.disclaimer).toMatch(/not verified/);
  });

  it('uses Hunter.io when configured, keeps its source and still marks it unverified', async () => {
    const { suggestEmails } = await import('../src/services/discovery.js');
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const deps = baseDeps({
      config: { hunterApiKey: 'hk_test' },
      fetch: async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return new Response(JSON.stringify({ data: { email: 'Meera.Iyer@contoso.example', score: 91, sources: [{ uri: 'https://contoso.example/team' }] } }), { status: 200 });
      },
    });
    const r = await suggestEmails(deps, { full_name: 'Meera Iyer', domain: 'contoso.example' });
    expect(calls[0]!.url).toContain('https://api.hunter.io/v2/email-finder?first_name=Meera&last_name=Iyer&domain=contoso.example');
    expect(calls[0]!.headers['X-API-KEY']).toBe('hk_test');
    expect(r.suggestions[0]).toMatchObject({ email: 'meera.iyer@contoso.example', source: 'Hunter.io email finder', confidence: 91, source_url: 'https://contoso.example/team', verification: 'unverified_guess' });
    expect(r.suggestions.filter((s) => s.email === 'meera.iyer@contoso.example')).toHaveLength(1); // no duplicate pattern
  });

  it('degrades to patterns when the lookup service fails', async () => {
    const { suggestEmails } = await import('../src/services/discovery.js');
    const deps = baseDeps({ config: { hunterApiKey: 'hk_test' }, fetch: async () => new Response('{"errors":[]}', { status: 429 }) });
    const r = await suggestEmails(deps, { full_name: 'Meera Iyer', domain: 'contoso.example' });
    expect(r.suggestions.every((s) => s.source === 'Common address pattern')).toBe(true);
  });
});

describe('résumé storage ownership', () => {
  it('accepts only the user’s own 2.0 and v1 object keys', async () => {
    const { ownsStoragePath } = await import('../src/services/resumes.js');
    const me = '6f1c2a5e-0000-4000-8000-000000000001';
    const them = '6f1c2a5e-0000-4000-8000-000000000002';
    expect(ownsStoragePath(me, `${me}/0b6c.pdf`)).toBe(true);
    expect(ownsStoragePath(me, `${me}-1700000000000.pdf`)).toBe(true);
    expect(ownsStoragePath(me, `${them}-1700000000000.pdf`)).toBe(false);
    expect(ownsStoragePath(me, `${them}/0b6c.pdf`)).toBe(false);
    expect(ownsStoragePath(me, `${me}/../${them}/0b6c.pdf`)).toBe(false);
    expect(ownsStoragePath(me, `${me}/nested/0b6c.pdf`)).toBe(false);
    expect(ownsStoragePath(me, `${me}-x/../../etc/passwd`)).toBe(false);
  });
});

describe('EXTENSION_IDS', () => {
  it('accepts Chrome extension IDs and rejects anything else', () => {
    const base = { DATABASE_URL: 'postgres://u@localhost/db', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
    expect(loadConfig({ ...base, EXTENSION_IDS: 'abcdefghijklmnopabcdefghijklmnop, bcdefghijklmnopabcdefghijklmnopa' }).gmail.extensionIds).toHaveLength(2);
    expect(loadConfig(base).gmail.extensionIds).toEqual([]);
    expect(() => loadConfig({ ...base, EXTENSION_IDS: 'not-an-id' })).toThrow(ConfigError);
  });
});

describe('blank .env lines', () => {
  it('treat KEY= as "not set" and fall back to the defaults', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgres://u@db.example.com/db',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      DATABASE_SSL: '',
      STORAGE_DRIVER: '',
      AI_PROVIDER: '',
      PORT: '',
      DB_RLS_ROLE: '  ',
      LOG_LEVEL: '',
    });
    expect(c.database.ssl).toBe('no-verify');
    expect(c.port).toBe(3001);
    expect(c.ai.provider).toBeNull();
    expect(c.database.rlsRole).toBe('autoreach_app');
  });
});
