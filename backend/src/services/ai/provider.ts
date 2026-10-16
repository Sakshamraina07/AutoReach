import type { AppConfig } from '../../config.js';
import { fetchWithTimeout, readJson, type FetchLike } from '../../lib/http.js';

/**
 * Provider abstraction. Every provider takes the same request and returns
 * plain text; JSON parsing/validation happens in the caller so switching
 * providers never changes application code. Keys live only on the server.
 */
export interface AiCompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /** Ask the provider for a JSON object when it supports a JSON mode. */
  json: boolean;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(req: AiCompletionRequest): Promise<string>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchImpl, url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), timeoutMs });
  } catch (err) {
    throw new AiProviderError(`AI provider unreachable: ${(err as Error).message}`, 0, true);
  }
  const json = await readJson<Record<string, unknown>>(res);
  if (!res.ok) {
    const msg =
      ((json?.error as { message?: string } | undefined)?.message ?? (typeof json?.error === 'string' ? (json.error as string) : undefined)) ??
      `HTTP ${res.status}`;
    throw new AiProviderError(`AI provider error: ${String(msg).slice(0, 300)}`, res.status, res.status === 429 || res.status >= 500);
  }
  return json ?? {};
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  constructor(
    private readonly fetchImpl: FetchLike,
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.anthropic.com',
    private readonly timeoutMs = 45_000,
  ) {}

  async complete(req: AiCompletionRequest): Promise<string> {
    const json = await post(
      this.fetchImpl,
      `${this.baseUrl}/v1/messages`,
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      },
      this.timeoutMs,
    );
    const content = (json.content as { type: string; text?: string }[] | undefined) ?? [];
    return content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly fetchImpl: FetchLike,
    readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly baseUrl: string,
    private readonly opts: { jsonMode: boolean; maxTokensField: 'max_tokens' | 'max_completion_tokens' },
    private readonly timeoutMs = 45_000,
  ) {}

  async complete(req: AiCompletionRequest): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: req.temperature,
      [this.opts.maxTokensField]: req.maxTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    };
    if (req.json && this.opts.jsonMode) body.response_format = { type: 'json_object' };
    const json = await post(this.fetchImpl, `${this.baseUrl}/chat/completions`, this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}, body, this.timeoutMs);
    const choices = json.choices as { message?: { content?: string } }[] | undefined;
    return choices?.[0]?.message?.content ?? '';
  }
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  constructor(
    private readonly fetchImpl: FetchLike,
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
    private readonly timeoutMs = 45_000,
  ) {}

  async complete(req: AiCompletionRequest): Promise<string> {
    const json = await post(
      this.fetchImpl,
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens, ...(req.json ? { responseMimeType: 'application/json' } : {}) },
      },
      this.timeoutMs,
    );
    const candidates = json.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
    return (candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  }
}

export function createAiProvider(cfg: AppConfig['ai'], fetchImpl: FetchLike): AiProvider | null {
  if (!cfg.provider || !cfg.model) return null;
  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicProvider(fetchImpl, cfg.model, cfg.apiKey!, cfg.baseUrl ?? 'https://api.anthropic.com', cfg.timeoutMs);
    case 'openai':
      return new OpenAiCompatibleProvider('openai', fetchImpl, cfg.model, cfg.apiKey, cfg.baseUrl ?? 'https://api.openai.com/v1', { jsonMode: true, maxTokensField: 'max_completion_tokens' }, cfg.timeoutMs);
    case 'groq':
      return new OpenAiCompatibleProvider('groq', fetchImpl, cfg.model, cfg.apiKey, cfg.baseUrl ?? 'https://api.groq.com/openai/v1', { jsonMode: true, maxTokensField: 'max_tokens' }, cfg.timeoutMs);
    case 'openai_compatible':
      return new OpenAiCompatibleProvider('openai_compatible', fetchImpl, cfg.model, cfg.apiKey, cfg.baseUrl!, { jsonMode: false, maxTokensField: 'max_tokens' }, cfg.timeoutMs);
    case 'gemini':
      return new GeminiProvider(fetchImpl, cfg.model, cfg.apiKey!, cfg.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta', cfg.timeoutMs);
  }
}

/** Extract the first JSON object from model output (tolerates ```json fences and prose). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    /* fall through */
  }
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(trimmed.slice(start, i + 1));
          return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
