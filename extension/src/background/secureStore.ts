/**
 * Where the sign-in session is kept. chrome.storage.local survives browser restarts but is
 * readable by content scripts unless restricted; storage.session is closed to content
 * scripts by default but is cleared when the browser closes. Use local only once
 * restricting it has succeeded (verified on Chrome 141); otherwise keep the session in
 * storage.session and ask the user to sign in again after a browser restart.
 */
let area: Promise<chrome.storage.StorageArea> | undefined;

export function sessionStorageArea(storage: Pick<typeof chrome.storage, 'local' | 'session'> = chrome.storage): Promise<chrome.storage.StorageArea> {
  area ??= (async () => {
    try {
      await storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      return storage.local;
    } catch {
      return storage.session;
    }
  })();
  return area;
}

/** Tests only. */
export function resetSessionStorageArea(): void {
  area = undefined;
}
