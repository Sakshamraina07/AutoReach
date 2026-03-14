// ✅ Background service worker for AutoReach

const keepAlive = () => setInterval(() => chrome.runtime.getPlatformInfo(() => { }), 20000);
chrome.runtime.onStartup.addListener(keepAlive);
keepAlive();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoReach] Extension Installed');
  console.log('[AutoReach] Redirect URI:', chrome.identity.getRedirectURL());
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[AutoReach] sidePanel error:', error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // 1. Supabase Auth OAuth (unchanged)
  if (message.type === 'SIGN_IN_WITH_GOOGLE') {
    if (!message.url) { sendResponse({ error: 'No OAuth URL provided' }); return true; }

    chrome.identity.launchWebAuthFlow({ url: message.url, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
      if (!responseUrl) { sendResponse({ error: 'OAuth cancelled' }); return; }

      try {
        const hashFragment = responseUrl.split('#')[1];
        if (!hashFragment) { sendResponse({ error: 'No hash fragment' }); return; }

        const params = new URLSearchParams(hashFragment);
        const access_token = params.get('access_token');
        if (!access_token) { sendResponse({ error: 'Missing access_token' }); return; }

        sendResponse({
          access_token,
          refresh_token: params.get('refresh_token') ?? null,
          expires_in: params.get('expires_in') ? parseInt(params.get('expires_in')) : null,
          token_type: params.get('token_type') ?? 'bearer',
        });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }

  // 2. Gmail OAuth (NEW — separate from Supabase login)
  if (message.type === 'CONNECT_GMAIL') {
    const GOOGLE_CLIENT_ID = '865030703352-08belajskesjt2fcqbi91tnfi4ld1bsu.apps.googleusercontent.com';
    const REDIRECT_URI = chrome.identity.getRedirectURL();

    console.log('[AutoReach] Gmail OAuth Redirect URI:', REDIRECT_URI);

    const scope = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' ');

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, async (responseUrl) => {
      if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
      if (!responseUrl) { sendResponse({ error: 'Gmail OAuth cancelled' }); return; }

      try {
        const url = new URL(responseUrl);
        const code = url.searchParams.get('code');
        if (!code) { sendResponse({ error: 'No authorization code returned' }); return; }

        const apiUrl = message.apiUrl || 'https://autoreach-production.up.railway.app';
        const tokenRes = await fetch(`${apiUrl}/settings/gmail/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${message.supabaseToken}`,
          },
          body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) { sendResponse({ error: tokenData.error || 'Token exchange failed' }); return; }

        sendResponse({ success: true, gmail_user: tokenData.gmail_user });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }

  // 3. Sign Out
  if (message.type === 'SIGN_OUT') {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }
});