import type { Message } from '../lib/protocol';

/** What the Gmail content script may ask for. Everything else is for extension pages only. */
const CONTENT_SCRIPT_TYPES = new Set<Message['type']>(['gmail:lookup', 'gmail:selfView', 'compose:open']);

/**
 * Extension pages (popup, side panel, or either opened in a tab) have the
 * extension's own origin. Content scripts report the page's URL; only the
 * Gmail script exists, and it may use only the read-only Gmail helpers.
 */
export function isAllowedSender(type: Message['type'], sender: chrome.runtime.MessageSender, runtimeId: string): boolean {
  if (sender.id !== runtimeId) return false;
  const url = sender.url ?? '';
  if (url.startsWith(`chrome-extension://${runtimeId}/`)) return true;
  return !!sender.tab && url.startsWith('https://mail.google.com/') && CONTENT_SCRIPT_TYPES.has(type);
}
