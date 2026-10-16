import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Loads a fresh copy of the Gmail content script against a stubbed extension API. */
async function loadAssist(sendMessage: (msg: { type: string }) => Promise<unknown>) {
  const removeListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: vi.fn(sendMessage), onMessage: { addListener: vi.fn() } },
    storage: { sync: { get: vi.fn(async () => ({})) }, onChanged: { addListener: vi.fn(), removeListener } },
  });
  vi.resetModules();
  await import('../content/gmail');
  return { send: (globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage, removeListener };
}

const lookups = (send: ReturnType<typeof vi.fn>) => send.mock.calls.filter(([m]) => (m as { type: string }).type === 'gmail:lookup').length;

/** Gmail re-renders constantly; simulate that for `ms` milliseconds. */
async function gmailChurn(ms: number) {
  for (let t = 0; t < ms; t += 250) {
    document.body.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(250);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  // A fresh <body> per test: copies of the script loaded by earlier tests keep observing the old one.
  document.querySelectorAll('autoreach-assist').forEach((e) => e.remove());
  document.documentElement.replaceChild(document.createElement('body'), document.body);
  document.body.innerHTML = `<div role="dialog"><span email="meera.iyer@contoso.example">Meera</span><input name="subjectbox" value=""></div>`;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Gmail assist', () => {
  it('backs off after a failed lookup instead of asking on every Gmail re-render', async () => {
    const { send } = await loadAssist(async () => ({ ok: false, error: { status: 0, code: 'NETWORK_ERROR', message: 'offline' } }));
    await vi.advanceTimersByTimeAsync(600);
    expect(lookups(send)).toBe(1);
    await gmailChurn(4000);
    expect(lookups(send)).toBe(1); // still inside the 5 s wait
    await gmailChurn(2000);
    expect(lookups(send)).toBe(2); // one retry after the wait, then 10 s
    await gmailChurn(8000);
    expect(lookups(send)).toBe(2);
  });

  it('waits minutes, not seconds, while signed out', async () => {
    const { send } = await loadAssist(async () => ({ ok: false, error: { status: 401, code: 'SIGNED_OUT', message: 'Sign in' } }));
    await vi.advanceTimersByTimeAsync(600);
    await gmailChurn(60_000);
    expect(lookups(send)).toBe(1);
  });

  it('shuts itself down when the extension behind it was updated or removed', async () => {
    const { send, removeListener } = await loadAssist(async () => {
      throw new Error('Extension context invalidated.');
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(lookups(send)).toBe(1);
    expect(removeListener).toHaveBeenCalled();
    await gmailChurn(10 * 60_000);
    expect(lookups(send)).toBe(1);
    expect(document.querySelector('autoreach-assist')).toBeNull();
  });

  it('shows the card once a lookup succeeds', async () => {
    const { send } = await loadAssist(async (m) =>
      m.type === 'gmail:lookup'
        ? { ok: true, status: 200, data: [{ email: 'meera.iyer@contoso.example', recruiter: null, messages: [], last_message: null, replied: false }] }
        : { ok: true },
    );
    await vi.advanceTimersByTimeAsync(600);
    expect(lookups(send)).toBe(1);
    expect(document.querySelector('autoreach-assist')).not.toBeNull();
  });
});
