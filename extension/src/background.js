// ✅ Background service worker for AutoReach

// ----------------------------------------
// 🔁 Keep-Alive (prevents MV3 service worker from dying mid-flow)
// ----------------------------------------
const keepAlive = () => setInterval(() => chrome.runtime.getPlatformInfo(() => { }), 20000);
chrome.runtime.onStartup.addListener(keepAlive);
keepAlive();

// ----------------------------------------
// 🚀 On Install
// ----------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoReach] Extension Installed');

  // ✅ Open side panel on install so user sees it immediately
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[AutoReach] sidePanel error:', error));
});

// ----------------------------------------
// 🔐 OAuth Message Handler
// ----------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- Google OAuth Flow ---
  if (message.type === 'SIGN_IN_WITH_GOOGLE') {
    console.log('[Background] Starting OAuth flow...');

    // ✅ Validate URL before launching
    if (!message.url) {
      console.error('[Background] No OAuth URL provided');
      sendResponse({ error: 'No OAuth URL provided' });
      return true;
    }

    chrome.identity.launchWebAuthFlow(
      {
        url: message.url,
        interactive: true,
      },
      (responseUrl) => {
        // ✅ Handle Chrome runtime errors
        if (chrome.runtime.lastError) {
          console.error('[Background] launchWebAuthFlow error:', chrome.runtime.lastError.message);
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }

        // ✅ Handle empty/undefined responseUrl
        if (!responseUrl) {
          console.error('[Background] No response URL returned — user may have cancelled');
          sendResponse({ error: 'OAuth cancelled or no response URL' });
          return;
        }

        console.log('[Background] Response URL received ✅');

        try {
          // Tokens are in the HASH fragment:
          // https://xxx.chromiumapp.org/#access_token=...&refresh_token=...
          const hashFragment = responseUrl.split('#')[1];

          if (!hashFragment) {
            console.error('[Background] No hash fragment in response URL');
            sendResponse({ error: 'No hash fragment in response URL' });
            return;
          }

          const params = new URLSearchParams(hashFragment);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          const expires_in = params.get('expires_in');
          const token_type = params.get('token_type');

          console.log('[Background] access_token exists:', !!access_token);
          console.log('[Background] refresh_token exists:', !!refresh_token);

          if (!access_token) {
            console.error('[Background] Missing access_token in hash fragment');
            sendResponse({ error: 'Missing access_token in redirect URL' });
            return;
          }

          // ✅ Send all token data back to AuthContext
          sendResponse({
            access_token,
            refresh_token: refresh_token ?? null,
            expires_in: expires_in ? parseInt(expires_in) : null,
            token_type: token_type ?? 'bearer',
          });

        } catch (err) {
          console.error('[Background] Token parsing error:', err);
          sendResponse({ error: err.message });
        }
      }
    );

    return true; // ✅ Keep message channel open for async sendResponse
  }

  // --- Sign Out Handler (clear chrome storage) ---
  if (message.type === 'SIGN_OUT') {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Sign out clear error:', chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        console.log('[Background] Storage cleared on sign out ✅');
        sendResponse({ success: true });
      }
    });
    return true;
  }
});