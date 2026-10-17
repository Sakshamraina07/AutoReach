import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal data loader for the popup and side panel (no cache needed at this size).
 * Reloads when `deps` change; while a reload runs, the previous data stays visible.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  const seq = useRef(0);
  useEffect(() => {
    loadRef.current = load;
  });

  const run = useCallback(() => {
    const id = ++seq.current;
    return loadRef.current().then(
      (v) => {
        if (id !== seq.current) return;
        setData(v);
        setError(null);
      },
      (e: unknown) => {
        if (id === seq.current) setError(e);
      },
    );
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the values the loader depends on
  }, deps);

  /** Manual refresh (after a change, or "Try again"). */
  const reload = useCallback(async () => {
    setError(null);
    await run();
  }, [run]);

  return { data, error, loading: data === undefined && !error, reload };
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
