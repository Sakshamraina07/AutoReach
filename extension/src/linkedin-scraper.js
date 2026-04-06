// ============================================================
// AutoReach — LinkedIn Content Script (linkedin-scraper.js)
// Injected on linkedin.com/in/* pages
// ============================================================

const scrapeAndStore = () => {
  // --- Helper: Find the profile card container ---
  // LinkedIn now uses <h2> for the name. We find it, then walk up
  // to the profile card and extract sibling <p> elements.
  const findProfileCard = () => {
    const allH2 = document.querySelectorAll('h2');
    for (const h2 of allH2) {
      const text = h2.innerText.trim();
      if (!text) continue;
      // Skip section headings like "About", "Experience", "Education", etc.
      const sectionHeadings = [
        'about', 'experience', 'education', 'skills', 'activity',
        'featured', 'recommendations', 'languages', 'interests',
        'licenses & certifications', 'more profiles for you',
        'people you may know', 'you might like', 'explore premium profiles',
        'ad options', "don't want to see this", 'people also viewed'
      ];
      if (sectionHeadings.includes(text.toLowerCase())) continue;
      // Skip notification counts like "0 notifications"
      if (/^\d+\s*notification/i.test(text)) continue;
      // This h2 is likely the person's name
      // Walk up to find a container large enough to hold headline/location
      let container = h2;
      for (let i = 0; i < 8; i++) {
        if (container.parentElement) container = container.parentElement;
      }
      return { nameEl: h2, container };
    }
    return null;
  };

  // --- Legacy selectors as fallback ---
  const getText = (...selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText.trim();
    }
    return '';
  };

  let name = '';
  let headline = '';
  let location = '';
  let company = '';

  const card = findProfileCard();

  if (card) {
    // --- 1. Name from the h2 ---
    name = card.nameEl.innerText.trim().split('\n')[0].trim();

    // --- 2. Extract all <p> texts near the name ---
    // LinkedIn layout: name(h2) → pronouns(p) → headline(p) → company(p) → location(p) → "Contact info"(p)
    const pElements = [];
    card.container.querySelectorAll('h2, p').forEach((el) => {
      const t = el.innerText.trim();
      if (t && t.length > 0) {
        pElements.push({ tag: el.tagName, text: t, el });
      }
    });

    // Find the name h2 index, then collect p elements after it
    let nameIdx = -1;
    for (let i = 0; i < pElements.length; i++) {
      if (pElements[i].tag === 'H2' && pElements[i].text === name) {
        nameIdx = i;
        break;
      }
    }

    if (nameIdx >= 0) {
      const afterName = pElements.slice(nameIdx + 1).filter(e => e.tag === 'P');
      // Filter out noise
      const meaningful = afterName.filter(e => {
        const t = e.text;
        if (t === 'Contact info') return false;
        if (/^\d[\d,]+\s*(followers|connections)/i.test(t)) return false;
        if (t.length < 2) return false;
        return true;
      });

      // Identify each field by content patterns
      for (const item of meaningful) {
        const t = item.text;
        // Pronouns — skip
        if (/^(he\/him|she\/her|they\/them|ze\/zir)/i.test(t)) continue;
        // Headline — usually longest, contains "|", "at", role keywords
        if (!headline && (t.includes('|') || t.includes(' at ') || t.includes('@') || t.length > 30)) {
          headline = t;
          continue;
        }
        // Location — contains comma + region pattern
        if (!location && /,\s*\w/.test(t) && (
          /india|states|kingdom|canada|australia|germany|france|singapore|dubai/i.test(t) ||
          /\b[A-Z][a-z]+,\s*[A-Z]/i.test(t)
        )) {
          location = t;
          continue;
        }
        // Company — short text, not a headline, not location
        if (!company && !headline && t.length < 40 && !t.includes(',')) {
          company = t;
          continue;
        }
      }

      // If we didn't get a headline but got something assigned to company that looks like a headline
      if (!headline && company && (company.includes('|') || company.length > 40)) {
        headline = company;
        company = '';
      }

      // Second pass: if we still don't have some fields, try remaining items
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

  // --- Fallback: legacy selectors ---
  if (!name) {
    name = getText(
      'h1.text-heading-xlarge', 'h1.inline.t-24.v-align-middle.break-words',
      '.pv-text-details__left-panel h1', '[data-anonymize="person-name"]', 'h1'
    );
  }
  if (!headline) {
    headline = getText(
      '.text-body-medium.break-words', '[data-anonymize="headline"]',
      '.pv-text-details__left-panel .text-body-medium'
    );
  }
  if (!location) {
    location = getText(
      '.text-body-small.inline.t-black--light.break-words',
      '[data-anonymize="location"]'
    );
  }

  // --- Company extraction: multi-source ---

  // Source A: Already found from profile card <p> tag
  // (company may already be set from above)

  // Source B: Company links in experience / right panel
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
        break;
      }
    }
  }

  // Source C: First company link on the page (excluding nav/sidebar)
  if (!company) {
    const allCompanyLinks = document.querySelectorAll('a[href*="/company/"]');
    for (const link of allCompanyLinks) {
      const t = link.innerText.trim().split('\n')[0].trim();
      if (t && t.length > 1 && t.length < 60 && !/university|college|school|institute|follow/i.test(t)) {
        company = t;
        break;
      }
    }
  }

  // Source D: Experience section with "Present"
  if (!company) {
    const experienceSection = document.querySelector('#experience');
    if (experienceSection) {
      const container = experienceSection.closest('section') || experienceSection.parentElement;
      if (container) {
        const items = container.querySelectorAll('li');
        for (const item of items) {
          const text = item.innerText || '';
          if (!/present/i.test(text)) continue;
          const cLink = item.querySelector('a[href*="/company/"]');
          if (cLink) {
            const lt = cLink.innerText.trim().split('\n')[0].trim();
            if (lt && lt.length > 1) { company = lt; break; }
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
        if (candidate.length > 1) { company = candidate; break; }
      }
    }
  }

  // Blacklist cleanup
  const blacklist = ['about', 'activity', 'experience', 'education', 'skills', 'posts', 'comments', 'show all'];
  if (blacklist.includes((company || '').toLowerCase().trim())) company = '';
  company = (company || '').split('||')[0].trim();

  // Clean name
  if (name.includes('| LinkedIn')) name = name.split('|')[0].trim();
  name = name.split('\n')[0].trim();

  // --- About ---
  let about = '';
  const aboutSection = document.querySelector('#about');
  if (aboutSection) {
    const container = aboutSection.closest('section') || aboutSection.parentElement;
    if (container) {
      const spans = container.querySelectorAll('span[aria-hidden="true"]');
      for (const s of spans) {
        const t = s.innerText.trim();
        if (t.length > 30) { about = t; break; }
      }
    }
  }

  // --- Recent Post ---
  const recentPostEls = document.querySelectorAll(
    '.feed-shared-update-v2__description span[dir="ltr"], .feed-shared-text span[dir="ltr"]'
  );
  const recentPost = recentPostEls.length > 0
    ? recentPostEls[0].innerText.trim().slice(0, 300)
    : '';

  const profileUrl = window.location.href.split('?')[0];

  const data = {
    name,
    headline,
    company,
    location,
    about: about.slice(0, 500),
    recentPost,
    profileUrl
  };

  chrome.storage.local.set({ linkedinProfile: data }, () => {
    console.log('[AutoReach] Profile stored:', data);
  });
};

// Auto-scrape on page load with retry
const attemptScrape = (retries = 3, delay = 2000) => {
  setTimeout(() => {
    const hasName = document.querySelector('h1, h2');
    if (hasName && hasName.innerText.trim()) {
      scrapeAndStore();
    } else if (retries > 0) {
      console.log(`[AutoReach] Page not ready, retrying... (${retries} left)`);
      attemptScrape(retries - 1, delay + 1000);
    }
  }, delay);
};

window.addEventListener('load', () => attemptScrape());

// SPA navigation detection
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('linkedin.com/in/')) {
      attemptScrape();
    }
  }
}).observe(document, { subtree: true, childList: true });