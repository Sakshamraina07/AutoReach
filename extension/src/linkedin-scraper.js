const scrapeAndStore = () => {
  const getText = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.innerText.trim() : '';
  };

  const name = getText('h1.text-heading-xlarge') || getText('h1');
  const headline = getText('.text-body-medium.break-words') || '';
  const location = getText('.text-body-small.inline.t-black--light.break-words') || '';

  // ✅ Get company from experience links — proven working selector
  let company = '';
  const expLinks = document.querySelectorAll('.pv-top-card--experience-list a');

  for (const link of expLinks) {
    const text = link.innerText.trim();
    if (!text) continue;

    // Text format: "JobTitle\nJobTitle\nCompanyName\nCompanyName\nDuration..."
    // LinkedIn doubles each line — deduplicate first
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const unique = [...new Set(lines)];

    // unique[0] = job title, unique[1] = company name
    if (unique.length >= 2) {
      const candidate = unique[1];
      // Make sure it's not a duration or date
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

  // Fallback — extract from experience section DOM
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

  // Fallback — extract from headline
  if (!company && headline) {
    if (headline.includes('@')) {
      company = headline.split('@')[1].split(/\s*[\|]\s*|\s+supporting\s+/i)[0].trim();
    } else if (headline.includes(' - ')) {
      company = headline.split(' - ')[1].split(/\s*[\|]\s*|\s+supporting\s+/i)[0].split('||')[0].trim();
    } else if (headline.toLowerCase().includes(' at ')) {
      company = headline.split(/ at /i)[1].split(/\s*[\|]\s*|\s+supporting\s+/i)[0].split('||')[0].trim();
    }
  }

  // Blacklist false positives
  const blacklist = ['about', 'activity', 'experience', 'education', 'skills', 'posts', 'comments'];
  if (blacklist.includes((company || '').toLowerCase())) company = '';

  // About section
  const aboutSpans = document.querySelectorAll(
    '#about ~ .pvs-list__outer-container span[aria-hidden="true"]'
  );
  const about = aboutSpans.length > 0 ? aboutSpans[0].innerText.trim() : '';

  // Recent post
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

// Auto-scrape on page load
window.addEventListener('load', () => {
  setTimeout(scrapeAndStore, 3000);
});

// SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('linkedin.com/in/')) {
      setTimeout(scrapeAndStore, 3000);
    }
  }
}).observe(document, { subtree: true, childList: true });