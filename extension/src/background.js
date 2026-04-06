// ============================================================
// AutoReach — Background Service Worker (background.js)
// ============================================================

const keepAlive = () => setInterval(() => chrome.runtime.getPlatformInfo(() => { }), 20000);
chrome.runtime.onStartup.addListener(keepAlive);
keepAlive();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoReach] Extension Installed');
  console.log('[AutoReach] Redirect URI:', chrome.identity.getRedirectURL());
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[AutoReach] sidePanel error:', error));
});

// ── Helper: Find the LinkedIn profile tab ──
async function findLinkedInTab() {
  const tabs = await chrome.tabs.query({});
  const active = tabs.find(t => t.active && t.url && t.url.includes('linkedin.com/in/'));
  if (active) return active;
  return tabs.find(t => t.url && t.url.includes('linkedin.com/in/'));
}

// ── The scraper function injected into the LinkedIn page ──
function injectedScraper() {
  try {
    const debug = (step, msg) => console.log(`[AutoReach Scraper] ${step}:`, msg);

    // --- Helper: find profile card via h2 ---
    const sectionHeadings = [
      'about', 'experience', 'education', 'skills', 'activity',
      'featured', 'recommendations', 'languages', 'interests',
      'licenses & certifications', 'more profiles for you',
      'people you may know', 'you might like', 'explore premium profiles',
      'ad options', "don't want to see this", 'people also viewed'
    ];

    let nameEl = null;
    let container = null;

    // Try h2 first (new LinkedIn layout)
    const allH2 = document.querySelectorAll('h2');
    for (const h2 of allH2) {
      const text = h2.innerText.trim();
      if (!text) continue;
      if (sectionHeadings.includes(text.toLowerCase())) continue;
      if (/^\d+\s*notification/i.test(text)) continue;
      nameEl = h2;
      container = h2;
      for (let i = 0; i < 8; i++) {
        if (container.parentElement) container = container.parentElement;
      }
      break;
    }

    // Fallback: try h1 (old LinkedIn layout)
    if (!nameEl) {
      const h1Selectors = [
        'h1.text-heading-xlarge',
        'h1.inline.t-24.v-align-middle.break-words',
        '.pv-text-details__left-panel h1',
        '[data-anonymize="person-name"]',
        'h1'
      ];
      for (const sel of h1Selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim()) {
          nameEl = el;
          container = el;
          for (let i = 0; i < 8; i++) {
            if (container.parentElement) container = container.parentElement;
          }
          break;
        }
      }
    }

    // --- 1. Extract name ---
    let fullName = nameEl ? nameEl.innerText.trim().split('\n')[0].trim() : '';
    if (fullName.includes('| LinkedIn')) fullName = fullName.split('|')[0].trim();

    const cleanName = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, ' ').trim();
    const nameTokens = cleanName.toLowerCase().split(' ').filter(t => t.length > 0);
    const firstName = nameTokens[0] || '';
    const lastName = nameTokens.length > 1 ? nameTokens[nameTokens.length - 1] : '';
    debug('Name', `${fullName} → first: ${firstName}, last: ${lastName}`);

    // --- 2. Extract headline, company, location from <p> siblings ---
    let headline = '';
    let company = '';
    let location = '';
    let confidence = 'low';

    if (container && nameEl) {
      const pElements = [];
      container.querySelectorAll('h2, p').forEach((el) => {
        const t = el.innerText.trim();
        if (t && t.length > 0) {
          pElements.push({ tag: el.tagName, text: t });
        }
      });

      let nameIdx = -1;
      for (let i = 0; i < pElements.length; i++) {
        if (pElements[i].tag === nameEl.tagName && pElements[i].text === fullName) {
          nameIdx = i;
          break;
        }
      }

      if (nameIdx >= 0) {
        const afterName = pElements.slice(nameIdx + 1).filter(e => e.tag === 'P');
        const meaningful = afterName.filter(e => {
          const t = e.text;
          if (t === 'Contact info') return false;
          if (/^\d[\d,]+\s*(followers|connections)/i.test(t)) return false;
          if (t.length < 2) return false;
          return true;
        });

        for (const item of meaningful) {
          const t = item.text;
          if (/^(he\/him|she\/her|they\/them|ze\/zir)/i.test(t)) continue;
          if (!headline && (t.includes('|') || t.includes(' at ') || t.includes('@') || t.length > 30)) {
            headline = t;
            continue;
          }
          if (!location && /,\s*\w/.test(t) && (
            /india|states|kingdom|canada|australia|germany|france|singapore|dubai|china|japan|korea|brazil|mexico|netherlands|spain|italy|ireland|israel|sweden|norway|finland|denmark|switzerland|austria|belgium|poland|portugal|czech|romania|turkey|philippines|indonesia|malaysia|thailand|vietnam|pakistan|bangladesh|sri lanka|nigeria|kenya|south africa|egypt|uae|qatar|saudi|bahrain|kuwait|oman/i.test(t) ||
            /\b[A-Z][a-z]+,\s*[A-Z]/i.test(t)
          )) {
            location = t;
            continue;
          }
          if (!company && !headline && t.length < 40 && !t.includes(',')) {
            company = t;
            continue;
          }
        }

        // Fix misassignment
        if (!headline && company && (company.includes('|') || company.length > 40)) {
          headline = company;
          company = '';
        }

        // Second pass
        if (!headline || !location || !company) {
          for (const item of meaningful) {
            const t = item.text;
            if (t === headline || t === location || t === company) continue;
            if (/^(he\/him|she\/her|they\/them)/i.test(t)) continue;
            if (!headline && t.length > 20) { headline = t; continue; }
            if (!company && t.length < 40 && !t.includes(',')) { company = t; continue; }
            if (!location && t.includes(',')) { location = t; continue; }
          }
        }
      }
    }

    debug('Headline', headline);
    debug('Company (from card)', company);
    debug('Location', location);

    // --- Fallback: legacy selectors ---
    if (!headline) {
      const el = document.querySelector('.text-body-medium.break-words, [data-anonymize="headline"]');
      if (el) headline = el.innerText.trim();
    }
    if (!location) {
      const el = document.querySelector('.text-body-small.inline.t-black--light.break-words, [data-anonymize="location"]');
      if (el) location = el.innerText.trim();
    }

    // --- Company: additional sources ---

    // Source B: Company links
    if (!company) {
      const companyLinks = document.querySelectorAll(
        '.pv-top-card--experience-list a[href*="/company/"], ' +
        '.pv-text-details__right-panel a[href*="/company/"], ' +
        'a[data-field="experience_company_logo"]'
      );
      for (const link of companyLinks) {
        const t = link.innerText.trim().split('\n')[0].trim();
        if (t && t.length > 1 && !/university|college|school|institute/i.test(t)) {
          company = t;
          confidence = 'high';
          break;
        }
      }
    }

    // Source C: First company link on page
    if (!company) {
      const allCompanyLinks = document.querySelectorAll('a[href*="/company/"]');
      for (const link of allCompanyLinks) {
        const t = link.innerText.trim().split('\n')[0].trim();
        if (t && t.length > 1 && t.length < 60 && !/university|college|school|institute|follow/i.test(t)) {
          company = t;
          confidence = 'medium';
          break;
        }
      }
    }

    // Source D: Experience section with "Present"
    if (!company) {
      const experienceSection = document.querySelector('#experience');
      if (experienceSection) {
        const sec = experienceSection.closest('section') || experienceSection.parentElement;
        if (sec) {
          const items = sec.querySelectorAll('li');
          for (const item of items) {
            if (!/present/i.test(item.innerText || '')) continue;
            const cLink = item.querySelector('a[href*="/company/"]');
            if (cLink) {
              const lt = cLink.innerText.trim().split('\n')[0].trim();
              if (lt && lt.length > 1) { company = lt; confidence = 'high'; break; }
            }
          }
        }
      }
    }

    // Source E: Headline parsing
    if (!company && headline) {
      const patterns = [
        { re: /@\s*(.+)/i, idx: 1 },
        { re: /\bat\s+([A-Z][^\|,\n]+)/i, idx: 1 },
        { re: /\bfor\s+([A-Z][^\|,\n]+)/i, idx: 1 },
        { re: /[-–]\s*([^-–\|]+)$/, idx: 1 },
        { re: /\|\s*([^|]+)$/, idx: 1 },
      ];
      for (const { re, idx } of patterns) {
        const m = headline.match(re);
        if (m && m[idx]) {
          const candidate = m[idx].split(/\s*[\|]\s*/)[0].split('||')[0].trim();
          if (candidate.length > 1) { company = candidate; confidence = 'medium'; break; }
        }
      }
    }

    // Blacklist
    const blacklist = ['about', 'activity', 'experience', 'education', 'skills', 'posts', 'comments', 'show all'];
    if (blacklist.includes((company || '').toLowerCase().trim())) company = '';
    company = (company || '').split('||')[0].trim();

    if (company && confidence === 'low') confidence = 'medium';
    debug('Company (final)', `${company} (${confidence})`);

    // --- 5. Domain mapping ---
    const domainMap = {
      'google': 'google.com', 'microsoft': 'microsoft.com', 'amazon': 'amazon.com',
      'meta': 'meta.com', 'apple': 'apple.com', 'netflix': 'netflix.com',
      'adobe': 'adobe.com', 'salesforce': 'salesforce.com', 'oracle': 'oracle.com',
      'ibm': 'ibm.com', 'intel': 'intel.com', 'uber': 'uber.com',
      'airbnb': 'airbnb.com', 'stripe': 'stripe.com', 'spotify': 'spotify.com',
      'twitter': 'x.com', 'tata consultancy services': 'tcs.com', 'tcs': 'tcs.com',
      'infosys': 'infosys.com', 'wipro': 'wipro.com', 'korn ferry': 'kornferry.com',
      'randstad': 'randstad.com', 'deloitte': 'deloitte.com', 'accenture': 'accenture.com',
      'cognizant': 'cognizant.com', 'capgemini': 'capgemini.com', 'hcl': 'hcl.com',
      'tech mahindra': 'techmahindra.com', 'linkedin': 'linkedin.com',
    };

    let domain = '';
    const companyLower = company.toLowerCase();
    const normKey = Object.keys(domainMap).find(key => companyLower.includes(key));
    if (normKey) {
      domain = domainMap[normKey];
    } else if (company) {
      domain = company.toLowerCase()
        .replace(/\s+(india|pvt|ltd|limited|inc|corp|technologies|tech|solutions|services|consulting|group|global|international|software|systems)\b.*/g, '')
        .replace(/[^a-z0-9]/g, '') + '.com';
      if (confidence === 'high') confidence = 'medium';
    }

    // --- 6. Generate email ---
    let email = '';
    if (firstName && lastName && domain) {
      email = `${firstName}.${lastName}@${domain}`;
    }
    debug('Email', email);

    const profileUrl = window.location.href.split('?')[0];

    return {
      success: true,
      data: {
        name: fullName,
        fullName,
        firstName,
        lastName,
        headline,
        company,
        domain,
        email,
        confidence,
        location,
        profileUrl
      }
    };
  } catch (e) {
    return { success: false, error: e.message, stack: e.stack };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // 1. Supabase Auth OAuth
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

  // 3. Find LinkedIn tab ID
  if (message.type === 'GET_LINKEDIN_TAB') {
    findLinkedInTab().then(tab => {
      sendResponse(tab ? { success: true, tabId: tab.id } : { success: false });
    });
    return true;
  }

  // 4. On-demand scrape
  if (message.type === 'SCRAPE_LINKEDIN_NOW') {
    (async () => {
      try {
        const linkedInTab = await findLinkedInTab();

        if (!linkedInTab) {
          sendResponse({
            success: false,
            error: 'No LinkedIn profile tab found. Please open a profile (linkedin.com/in/...) and try again.'
          });
          return;
        }

        if (linkedInTab.status !== 'complete') {
          await new Promise(r => setTimeout(r, 2000));
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: linkedInTab.id },
          func: injectedScraper,
        });

        const payload = results?.[0]?.result;

        if (!payload) {
          sendResponse({ success: false, error: 'Could not execute script on the page. Try refreshing LinkedIn.' });
          return;
        }

        if (!payload.success) {
          sendResponse({ success: false, error: `Script error: ${payload.error}` });
          return;
        }

        const data = payload.data;
        chrome.storage.local.set({ linkedinProfile: data }, () => {
          sendResponse({ success: true, data });
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
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