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

  // 2. Gmail OAuth
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

  // 3. ✅ Find LinkedIn tab ID
  if (message.type === 'GET_LINKEDIN_TAB') {
    chrome.tabs.query({}, (tabs) => {
      const linkedInTab = tabs.find(t => t.url && t.url.includes('linkedin.com/in/'));
      if (linkedInTab) {
        sendResponse({ success: true, tabId: linkedInTab.id });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }

  // 4. ✅ On-demand scrape — inject scraper into active LinkedIn tab
  if (message.type === 'SCRAPE_LINKEDIN_NOW') {
    chrome.tabs.query({}, (tabs) => {
      const linkedInTab = tabs.find(t => t.url && t.url.includes('linkedin.com/in/'));
      if (!linkedInTab) {
        sendResponse({ success: false, error: 'No LinkedIn profile tab found. Please open a linkedin.com/in/ page.' });
        return;
      }

      chrome.scripting.executeScript({
        target: { tabId: linkedInTab.id },
        func: () => {
          const getText = (selector) => {
            const el = document.querySelector(selector);
            return el ? el.innerText.trim() : '';
          };

          const name = getText('h1.text-heading-xlarge') || getText('h1');
          const headline = getText('.text-body-medium.break-words') || '';
          const location = getText('.text-body-small.inline.t-black--light.break-words') || '';

          let company = '';
          const expLinks = document.querySelectorAll('.pv-top-card--experience-list a');
          for (const link of expLinks) {
            const text = link.innerText.trim();
            if (!text) continue;
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const unique = [...new Set(lines)];
            if (unique.length >= 2) {
              const candidate = unique[1];
              if (
                !/^\d+\s*(yr|yrs|mos|month|year)/i.test(candidate) &&
                !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(candidate) &&
                !/^\d{4}/i.test(candidate) &&
                candidate.length > 1
              ) {
                company = candidate;
                break;
              }
            }
          }

          if (!company) {
            const experienceSection = document.querySelector('#experience');
            if (experienceSection) {
              let el = experienceSection.nextElementSibling;
              while (el) {
                const allSpans = el.querySelectorAll('.pvs-list__item--line-separated span[aria-hidden="true"]');
                for (const span of allSpans) {
                  const text = span.innerText.trim();
                  if (!text || text.length < 2) continue;
                  if (/^\d+\s*(yr|yrs|mos|month|year)/i.test(text)) continue;
                  if (/^(full-time|part-time|contract|internship|freelance|self-employed)/i.test(text)) continue;
                  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}/i.test(text)) continue;
                  if (/^\d{4}\s*[-–]\s*(present|\d{4})/i.test(text)) continue;
                  if (/^(present|on-site|remote|hybrid|experience)/i.test(text)) continue;
                  const isBold = span.closest('.t-bold');
                  if (isBold) continue;
                  company = text.split('·')[0].trim();
                  if (company.length > 1) break;
                }
                if (company) break;
                el = el.nextElementSibling;
                if (!el || el.id === 'education') break;
              }
            }
          }

          if (!company && headline) {
            if (headline.includes('@')) {
              company = headline.split('@')[1].split(/\s*[\|]\s*|\s+supporting\s+/i)[0].trim();
            } else if (headline.includes(' - ')) {
              company = headline.split(' - ')[1].split(/\s*[\|]\s*|\s+supporting\s+/i)[0].split('||')[0].trim();
            } else if (headline.toLowerCase().includes(' at ')) {
              company = headline.split(/ at /i)[1].split(/\s*[\|]\s*|\s+supporting\s+/i)[0].split('||')[0].trim();
            }
          }

          const blacklist = ['about', 'activity', 'experience', 'education', 'skills', 'posts', 'comments'];
          if (blacklist.includes((company || '').toLowerCase())) company = '';

          const aboutSpans = document.querySelectorAll('#about ~ .pvs-list__outer-container span[aria-hidden="true"]');
          const about = aboutSpans.length > 0 ? aboutSpans[0].innerText.trim() : '';

          const recentPostEls = document.querySelectorAll('.feed-shared-update-v2__description span[dir="ltr"], .feed-shared-text span[dir="ltr"]');
          const recentPost = recentPostEls.length > 0 ? recentPostEls[0].innerText.trim().slice(0, 300) : '';

          const profileUrl = window.location.href.split('?')[0];

          return { name, headline, company, location, about: about.slice(0, 500), recentPost, profileUrl };
        },
      }, (results) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        const data = results?.[0]?.result;
        if (!data || !data.name) {
          sendResponse({ success: false, error: 'Could not extract profile data. Make sure the LinkedIn profile page is fully loaded.' });
          return;
        }
        chrome.storage.local.set({ linkedinProfile: data }, () => {
          sendResponse({ success: true, data });
        });
      });
    });
    return true;
  }

  // 5. Sign Out
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