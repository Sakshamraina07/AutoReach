/**
 * Gmail assist (content script on mail.google.com).
 *
 * Shows a small, dismissible AutoReach card when you write to — or read a
 * conversation with — someone in your AutoReach list: whether you have
 * emailed them before, whether they replied, and a do-not-contact warning.
 * It reads only the addresses Gmail shows in compose recipient chips and
 * conversation headers, sends them to your own AutoReach API through the
 * extension's service worker, and never changes or blocks Gmail's own
 * buttons. It can be turned off from the AutoReach popup.
 */
import type { RecruiterLookupResult } from '@autoreach/shared';
import { dashboardLink } from '../lib/config';
import { GMAIL_ASSIST_KEY, type ApiResult } from '../lib/protocol';
import { assistItems, composeDialogs, composeRecipients, threadParticipants, type AssistItem } from './gmailDom';

const CACHE_MS = 2 * 60_000;
const SELF_VIEW_EVERY_MS = 15_000;
/** Looked-up addresses, including ones the server returned nothing for (null), so they aren't asked about again. */
const cache = new Map<string, { at: number; result: RecruiterLookupResult | null }>();
let enabled = true;
let signedOut = false;
/** After a failed lookup, wait before asking again (Gmail changes its DOM constantly). */
let retryAt = 0;
let failures = 0;
let orphaned = false;
let currentKey = '';
let hiddenKey = '';
let selfViewTimer: ReturnType<typeof setInterval> | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;

async function lookup(emails: string[]): Promise<RecruiterLookupResult[] | null> {
  const now = Date.now();
  const missing = emails.filter((e) => {
    const hit = cache.get(e);
    return !hit || now - hit.at > CACHE_MS;
  });
  if (missing.length) {
    if (now < retryAt) return null;
    let res: ApiResult<RecruiterLookupResult[]> | undefined;
    try {
      res = (await chrome.runtime.sendMessage({ type: 'gmail:lookup', emails: missing })) as ApiResult<RecruiterLookupResult[]>;
    } catch {
      teardown(); // the extension was updated or removed; this copy of the script is orphaned
      return null;
    }
    if (!res?.ok) {
      signedOut = !!res && ['SIGNED_OUT', 'SESSION_EXPIRED'].includes(res.error.code);
      // Signed out or assist turned off: check again in a few minutes. Errors: 5 s, 10 s, … up to 5 minutes.
      failures++;
      retryAt = Date.now() + (signedOut || res?.error.code === 'ASSIST_OFF' ? 3 * 60_000 : Math.min(5 * 60_000, 5_000 * 2 ** (failures - 1)));
      return null;
    }
    signedOut = false;
    failures = 0;
    retryAt = 0;
    for (const e of missing) cache.set(e, { at: now, result: null });
    for (const r of res.data) cache.set(r.email.toLowerCase(), { at: now, result: r });
  }
  return emails.map((e) => cache.get(e)?.result).filter((r): r is RecruiterLookupResult => !!r);
}

/* ---------------- Rendering (shadow DOM, so Gmail's CSS can't leak in or out) ---------------- */

const STYLE = `
:host { all: initial; }
.card { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; width: 320px; max-height: 50vh; overflow: auto;
  font: 13px/1.45 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif; color: #E6EAF2; background: #151B25;
  border: 1px solid #263042; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #263042; }
.brand { font-weight: 600; flex: 1; display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #5FD3A0; }
button { font: inherit; cursor: pointer; border-radius: 6px; }
.x { background: none; border: 0; color: #9AA5B8; padding: 2px 6px; }
.x:hover { color: #E6EAF2; background: #1B2230; }
.item { padding: 8px 10px; border-bottom: 1px solid rgba(38,48,66,.6); }
.item:last-child { border-bottom: 0; }
.title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail { color: #9AA5B8; font-size: 12px; }
.warn { color: #F2B05E; font-size: 12px; margin-top: 2px; }
.danger { color: #F27474; }
.success { color: #5FD3A0; }
.info { color: #8FB3D9; }
.actions { display: flex; gap: 6px; margin-top: 6px; }
.btn { background: #1B2230; color: #E6EAF2; border: 1px solid #263042; padding: 3px 8px; font-size: 12px; }
.btn:hover { border-color: #6B7689; }
.btn.primary { background: #7C9CFF; color: #0C1222; border-color: #7C9CFF; }
a { color: #7C9CFF; font-size: 12px; text-decoration: none; align-self: center; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid #7C9CFF; outline-offset: 2px; }
`;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function ensureHost(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement('autoreach-assist');
  // Closed in production so Gmail's own scripts can't read the card; open in development builds for automated tests.
  root = host.attachShadow({ mode: import.meta.env.MODE === 'production' ? 'closed' : 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.append(style);
  document.documentElement.append(host);
  return root;
}

function hide() {
  host?.remove();
  host = null;
  root = null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function openComposer(item: AssistItem) {
  void chrome.runtime
    .sendMessage({ type: 'compose:open', prefill: item.known ? { recruiterId: item.recruiterId ?? undefined, from: 'gmail' } : { recruiterEmail: item.email, from: 'gmail' } })
    .catch(() => undefined);
}

function render(items: AssistItem[], composing: boolean) {
  // Nothing worth interrupting for: unknown people while reading mail.
  const notable = items.filter((i) => i.known || composing);
  if (!notable.length) return hide();
  const r = ensureHost();
  r.querySelector('.card')?.remove();
  const card = el('div', { class: 'card', role: 'complementary', 'aria-label': 'AutoReach' });
  const head = el('div', { class: 'head' });
  const brand = el('div', { class: 'brand' });
  brand.append(el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', {}, composing ? 'AutoReach: recipients' : 'AutoReach: in this conversation'));
  const close = el('button', { class: 'x', type: 'button', 'aria-label': 'Hide AutoReach card' }, '✕');
  close.addEventListener('click', () => {
    hiddenKey = currentKey;
    hide();
  });
  head.append(brand, close);
  card.append(head);

  for (const item of notable.slice(0, 5)) {
    const row = el('div', { class: 'item' });
    row.append(el('div', { class: 'title', title: item.email }, item.title));
    row.append(el('div', { class: `detail ${item.tone === 'neutral' ? '' : item.tone}` }, item.detail));
    if (item.doNotContact && composing) row.append(el('div', { class: 'warn danger' }, 'You marked this person do-not-contact.'));
    else if (item.duplicateWarning) row.append(el('div', { class: 'warn' }, item.duplicateWarning));
    const actions = el('div', { class: 'actions' });
    if (!item.doNotContact) {
      const b = el('button', { class: 'btn primary', type: 'button' }, item.known ? 'Write with AutoReach' : 'Add to AutoReach');
      b.addEventListener('click', () => openComposer(item));
      actions.append(b);
    }
    if (item.recruiterId) actions.append(el('a', { href: dashboardLink(`/recruiters?open=${item.recruiterId}`), target: '_blank', rel: 'noreferrer' }, 'History'));
    row.append(actions);
    card.append(row);
  }
  r.append(card);
}

/* ---------------- Watching Gmail ---------------- */

function stopSelfView() {
  if (selfViewTimer) clearInterval(selfViewTimer);
  selfViewTimer = undefined;
}

/** While you read your own thread with a recruiter, opens of your sent email are probably you. */
function startSelfView(emails: string[]) {
  stopSelfView();
  if (!emails.length) return;
  const ping = () => {
    if (document.visibilityState !== 'visible') return;
    try {
      void chrome.runtime.sendMessage({ type: 'gmail:selfView', emails }).catch(() => teardown());
    } catch {
      teardown(); // "Extension context invalidated" is thrown synchronously once the extension is gone
    }
  };
  ping();
  selfViewTimer = setInterval(ping, SELF_VIEW_EVERY_MS);
}

async function update() {
  scheduled = undefined;
  if (orphaned) return;
  if (!enabled) return hide();
  const recipients = composeRecipients(document);
  const composing = recipients.length > 0 || composeDialogs(document).length > 0;
  const emails = recipients.length ? recipients : composing ? [] : threadParticipants(document);
  const key = `${composing ? 'c' : 't'}:${emails.join(',')}`;
  if (!emails.length) {
    currentKey = key;
    stopSelfView();
    return hide();
  }
  // Same view as last time: nothing to do, unless the last lookup failed and its wait is over.
  if (key === currentKey && (host?.isConnected || Date.now() < retryAt)) return;
  currentKey = key;
  if (key === hiddenKey) return;
  const results = await lookup(emails);
  if (key !== currentKey) return; // the view changed while we waited
  if (!results || signedOut) {
    stopSelfView();
    return hide();
  }
  const items = assistItems(results, composing);
  render(items, composing);
  if (composing) stopSelfView();
  else startSelfView(items.filter((i) => i.known).map((i) => i.email));
}

function schedule() {
  if (scheduled || orphaned) return;
  scheduled = setTimeout(() => void update(), 500);
}

/* ---------------- Insert a draft into an open compose window ---------------- */

function insertDraft(subject: string, body: string): { ok: boolean; reason?: string } {
  const dialogs = composeDialogs(document);
  const target = dialogs.at(-1);
  if (!target) return { ok: false, reason: 'Open a compose window in Gmail first.' };
  const editor = target.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"], div[aria-label="Message Body"][contenteditable="true"], [g_editable="true"]');
  if (!editor) return { ok: false, reason: "Couldn't find the message body in the compose window." };
  if ((editor.innerText ?? '').trim().length > 0) return { ok: false, reason: 'The compose window already has text. Clear it (or open a new one) so nothing you wrote is overwritten.' };
  const subjectInput = target.querySelector<HTMLInputElement>('input[name="subjectbox"]');
  if (subjectInput && !subjectInput.value.trim() && subject) {
    subjectInput.focus();
    subjectInput.value = subject;
    subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  editor.focus();
  // insertText keeps Gmail's editor state (undo, formatting) consistent.
  const inserted = document.execCommand('insertText', false, body);
  if (!inserted) editor.innerText = body;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true };
}

/* ---------------- Start ---------------- */

chrome.runtime.onMessage.addListener((msg: { type?: string; subject?: string; body?: string }, _sender, sendResponse) => {
  if (msg?.type === 'insert') {
    sendResponse(insertDraft(String(msg.subject ?? ''), String(msg.body ?? '')));
  }
  return false;
});

const observer = new MutationObserver(schedule);

function onStorageChange(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area === 'sync' && GMAIL_ASSIST_KEY in changes) {
    enabled = changes[GMAIL_ASSIST_KEY]?.newValue !== false;
    currentKey = '';
    retryAt = 0;
    failures = 0;
    schedule();
  }
}

/** Stop everything once the extension behind this script is gone (updated, reloaded or removed). */
function teardown() {
  if (orphaned) return;
  orphaned = true;
  observer.disconnect();
  window.removeEventListener('hashchange', schedule);
  document.removeEventListener('visibilitychange', schedule);
  if (scheduled) clearTimeout(scheduled);
  stopSelfView();
  hide();
  try {
    chrome.storage.onChanged.removeListener(onStorageChange);
  } catch {
    /* extension context already invalidated */
  }
}

chrome.storage.sync
  .get(GMAIL_ASSIST_KEY)
  .then((v) => {
    enabled = (v as Record<string, boolean | undefined>)[GMAIL_ASSIST_KEY] !== false;
    schedule();
  })
  .catch(() => teardown());
chrome.storage.onChanged.addListener(onStorageChange);

observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['email', 'data-hovercard-id', 'value'] });
window.addEventListener('hashchange', schedule);
document.addEventListener('visibilitychange', schedule);
