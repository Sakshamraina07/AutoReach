/**
 * Builds the Manifest V3 manifest from build-time settings.
 *
 * Permissions are deliberately minimal:
 *  - storage      sign-in session and small preferences
 *  - identity     Google sign-in through chrome.identity.launchWebAuthFlow
 *  - activeTab    read the current page ONLY after the user clicks "Save this page"
 *  - scripting    run that one-shot page reader in the active tab
 *  - sidePanel    the composer
 *  - alarms       refresh the follow-ups badge
 * Host access: the AutoReach API and the Supabase project (both from settings),
 * plus a content script on mail.google.com for the Gmail assist. No <all_urls>,
 * no "tabs", no LinkedIn, no web_accessible_resources.
 *
 * @param {{ version: string, apiUrl: string, supabaseUrl?: string, name?: string }} opts
 */
export function buildManifest({ version, apiUrl, supabaseUrl, name = 'AutoReach' }) {
  const hosts = [originPattern(apiUrl)];
  if (supabaseUrl) hosts.push(originPattern(supabaseUrl));
  const icons = { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
  return {
    manifest_version: 3,
    name,
    version,
    description: 'Track recruiters, write role-specific outreach and follow up, sending from your own Gmail.',
    minimum_chrome_version: '116',
    icons,
    action: { default_title: 'AutoReach', default_popup: 'popup.html', default_icon: icons },
    background: { service_worker: 'background.js', type: 'module' },
    side_panel: { default_path: 'sidepanel.html' },
    permissions: ['storage', 'identity', 'activeTab', 'scripting', 'sidePanel', 'alarms'],
    host_permissions: [...new Set(hosts)],
    content_scripts: [
      {
        matches: ['https://mail.google.com/*'],
        js: ['content-gmail.js'],
        run_at: 'document_idle',
      },
    ],
  };
}

/** "https://api.example.com/v1" → "https://api.example.com/*" (ports kept, paths dropped). */
export function originPattern(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
    throw new Error(`${url} must use https (http is only allowed for localhost).`);
  }
  return `${u.protocol}//${u.host}/*`;
}
