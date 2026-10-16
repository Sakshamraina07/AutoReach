import { useEffect, useState } from 'react';

/** Resolve a design token to a concrete colour (SVG attributes can't use CSS variables). */
export function tokenColor(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return raw ? `rgb(${raw} / ${alpha})` : 'currentColor';
}

/** Re-render when the theme attribute changes. */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setV((x) => x + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return v;
}
