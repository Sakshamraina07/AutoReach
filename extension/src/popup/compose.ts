import { dashboardComposeLink } from '../lib/config';
import { PREFILL_KEY, type ComposePrefill } from '../lib/protocol';

// Looked up once when the popup opens, so opening the side panel can happen
// synchronously inside a click (Chrome requires a user gesture for it).
let windowId: number | undefined;
void chrome.windows.getCurrent().then((w) => {
  windowId = w.id;
});

/** Opens the side-panel composer with an optional starting point. Call from a click handler. */
export function openComposer(prefill: ComposePrefill = {}) {
  void chrome.storage.session.set({ [PREFILL_KEY]: { ...prefill, from: 'popup', at: Date.now() } });
  if (windowId === undefined) {
    void chrome.tabs.create({ url: dashboardComposeLink(prefill) });
    return;
  }
  chrome.sidePanel.open({ windowId }).then(
    () => window.close(),
    () => void chrome.tabs.create({ url: dashboardComposeLink(prefill) }),
  );
}
