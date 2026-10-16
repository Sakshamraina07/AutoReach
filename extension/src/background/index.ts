/**
 * AutoReach service worker: owns the session, makes every API call, keeps the
 * follow-ups badge current, and runs the one-shot page reader on request.
 */
import { parseCapturedPage, readPage } from '../lib/capture';
import { config, dashboardComposeLink } from '../lib/config';
import { GMAIL_ASSIST_KEY, PREFILL_KEY, type ApiErrorShape, type ApiResult, type Message } from '../lib/protocol';
import { callApi } from './api';
import { connectGmail } from './gmailConnect';
import { isAllowedSender } from './senders';
import { AuthError, authState, devSignIn, getToken, refreshToken, signIn, signOut } from './auth';

// The session (Supabase tokens) lives in chrome.storage.local. Content scripts can read
// local storage by default; restrict it to the extension's own pages and this worker.
// Called on every start of the worker, before anything else runs.
try {
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
} catch {
  /* not available in this Chrome version */
}

const api = <T>(req: Parameters<typeof callApi>[0]) => callApi<T>(req, { apiUrl: config.apiUrl, fetch: (input, init) => fetch(input, init), getToken, refreshToken });

/* ---------------- Badge: follow-ups due ---------------- */

async function refreshBadge(): Promise<void> {
  const res = await api<{ total: number }>({ path: '/api/followups?view=due&page_size=1' });
  const n = res.ok ? res.data.total : 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#F2B05E' });
  await chrome.action.setBadgeText({ text: n > 0 ? (n > 99 ? '99+' : String(n)) : '' });
  await chrome.action.setTitle({ title: n > 0 ? `AutoReach: ${n} follow-up${n === 1 ? '' : 's'} due` : 'AutoReach' });
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('badge', { periodInMinutes: 15, delayInMinutes: 0.1 });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create('badge', { periodInMinutes: 15, delayInMinutes: 0.1 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'badge') void refreshBadge().catch(() => undefined);
});

/* ---------------- Messages ---------------- */

function toError(err: unknown): ApiErrorShape {
  if (err instanceof AuthError) return { status: 401, code: err.code, message: err.message };
  return { status: 0, code: 'EXTENSION_ERROR', message: err instanceof Error ? err.message : String(err) };
}

async function gmailAssistEnabled(): Promise<boolean> {
  const v = ((await chrome.storage.sync.get(GMAIL_ASSIST_KEY)) as Record<string, boolean | undefined>)[GMAIL_ASSIST_KEY];
  return v !== false;
}

async function handle(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!isAllowedSender(msg.type, sender, chrome.runtime.id)) {
    return { ok: false, error: { status: 403, code: 'FORBIDDEN', message: 'Not allowed from this context.' } };
  }

  switch (msg.type) {
    case 'auth:get':
      return { ok: true, auth: await authState() };
    case 'auth:signIn': {
      const auth = await signIn();
      void refreshBadge().catch(() => undefined);
      return { ok: true, auth };
    }
    case 'auth:devSignIn': {
      const auth = await devSignIn(msg.email);
      void refreshBadge().catch(() => undefined);
      return { ok: true, auth };
    }
    case 'auth:signOut': {
      const auth = await signOut();
      await chrome.action.setBadgeText({ text: '' });
      return { ok: true, auth };
    }
    case 'api': {
      const res = await api(msg.request);
      // Anything that can change what's due refreshes the badge.
      if (res.ok && msg.request.method && msg.request.method !== 'GET') void refreshBadge().catch(() => undefined);
      return res;
    }
    case 'badge:refresh':
      await refreshBadge();
      return { ok: true };
    case 'capture:page': {
      try {
        const [result] = await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, func: readPage });
        if (!result?.result) throw new Error('empty');
        return { ok: true, page: parseCapturedPage(result.result) };
      } catch {
        return {
          ok: false,
          error: { status: 0, code: 'CAPTURE_UNAVAILABLE', message: "This page can't be read (browser pages, the Chrome Web Store and some PDFs are off limits). You can still add the details by hand." },
        };
      }
    }
    case 'compose:open': {
      const tabId = sender.tab?.id;
      // Open first, while the click's user gesture is still valid, then hand over the prefill.
      const opening = tabId !== undefined ? chrome.sidePanel.open({ tabId }) : Promise.reject(new Error('no tab'));
      await chrome.storage.session.set({ [PREFILL_KEY]: { ...msg.prefill, at: Date.now() } });
      try {
        await opening;
      } catch {
        // Side panel not allowed here (no user gesture): fall back to the dashboard composer.
        await chrome.tabs.create({ url: dashboardComposeLink(msg.prefill) });
      }
      return { ok: true };
    }
    case 'gmail:lookup': {
      if (!(await gmailAssistEnabled())) return { ok: false, error: { status: 0, code: 'ASSIST_OFF', message: 'Gmail assist is turned off.' } } satisfies ApiResult;
      return api({ method: 'POST', path: '/api/recruiters/lookup', body: { emails: msg.emails.slice(0, 50) } });
    }
    case 'gmail:selfView': {
      if (!(await gmailAssistEnabled())) return { ok: true };
      const res = await api({ method: 'POST', path: '/api/recruiters/self-view', body: { emails: msg.emails.slice(0, 20) } });
      return res.ok ? { ok: true } : res;
    }
    case 'gmail:insert': {
      try {
        const ok = (await chrome.tabs.sendMessage(msg.tabId, { type: 'insert', subject: msg.subject, body: msg.body })) as { ok: boolean; reason?: string } | undefined;
        if (ok?.ok) return { ok: true };
        return { ok: false, error: { status: 0, code: 'NO_COMPOSE', message: ok?.reason ?? 'Open a new Gmail compose window in this tab, then try again.' } };
      } catch {
        return { ok: false, error: { status: 0, code: 'NOT_GMAIL', message: 'The current tab is not Gmail. Open Gmail and a compose window, then try again.' } };
      }
    }
    case 'gmail:connect':
      return connectGmail({ api, redirectUrl: chrome.identity.getRedirectURL('gmail'), launch: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }) });
    default:
      return { ok: false, error: { status: 400, code: 'UNKNOWN_MESSAGE', message: 'Unknown request.' } };
  }
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err: unknown) => sendResponse({ ok: false, error: toError(err) }));
  return true; // keep the channel open for the async response
});
