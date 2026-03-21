const scrapeAndStore = () => {
  const getText = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.innerText.trim() : '';
  };

  const getMultiple = (selector) => {
    return Array.from(document.querySelectorAll(selector))
      .map(el => el.innerText.trim())
      .filter(Boolean);
  };

  const name = getText('h1.text-heading-xlarge') || getText('h1');
  const headline = getText('.text-body-medium.break-words') || '';
  const location = getText('.text-body-small.inline.t-black--light.break-words') || '';

  // ✅ Get company from Experience section
  let company = '';
  const experienceSection = document.querySelector('#experience');

  if (experienceSection) {
    let el = experienceSection.nextElementSibling;
    while (el) {
      // Get all spans with aria-hidden from experience items
      const allSpans = el.querySelectorAll(
        '.pvs-list__item--line-separated span[aria-hidden="true"]'
      );

      for (const span of allSpans) {
        const text = span.innerText.trim();

        // Skip empty, too short, duration patterns, employment types
        if (!text || text.length < 2) continue;
        if (/^\d+\s*(yr|yrs|mos|month|year)/i.test(text)) continue;
        if (/^(full-time|part-time|contract|internship|freelance|self-employed)/i.test(text)) continue;
        if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}/i.test(text)) continue;
        if (/^\d{4}\s*[-–]\s*(present|\d{4})/i.test(text)) continue;
        if (/^(present|on-site|remote|hybrid)/i.test(text)) continue;

        // First valid non-job-title span is likely the company
        // Skip the first bold span (job title) — look for non-bold company name
        const isBold = span.closest('.t-bold');
        if (isBold) continue;

        // This should be the company name
        company = text.split('·')[0].trim();
        if (company.length > 1) break;
      }

      if (company) break;

      el = el.nextElementSibling;
      if (!el || el.id === 'education') break;
    }
  }

  // Fallback — try simpler selector if still empty
  if (!company) {
    const companyEl = document.querySelector(
      '#experience ~ .pvs-list__outer-container li:first-child .t-14.t-normal.t-black--light span[aria-hidden="true"]'
    );
    if (companyEl) {
      const raw = companyEl.innerText.trim();
      if (raw && !/\d+\s*(yr|mos)/i.test(raw)) {
        company = raw.split('·')[0].trim();
      }
    }
  }

  // ✅ Better about selector
  const aboutSpans = document.querySelectorAll(
    '#about ~ .pvs-list__outer-container span[aria-hidden="true"]'
  );
  const about = aboutSpans.length > 0 ? aboutSpans[0].innerText.trim() : '';

  // ✅ Recent post
  const recentPostEls = document.querySelectorAll(
    '.feed-shared-update-v2__description span[dir="ltr"], .feed-shared-text span[dir="ltr"]'
  );
  const recentPost = recentPostEls.length > 0
    ? recentPostEls[0].innerText.trim().slice(0, 300)
    : '';

  // ✅ Current role from experience
  const roleTitles = getMultiple(
    '#experience ~ .pvs-list__outer-container .t-bold span[aria-hidden="true"]'
  );
  const currentRole = roleTitles[0] || '';

  const profileUrl = window.location.href.split('?')[0];

  const data = {
    name,
    headline,
    company,
    currentRole,
    location,
    about: about.slice(0, 500),
    recentPost,
    profileUrl
  };

  chrome.storage.local.set({ linkedinProfile: data }, () => {
    console.log('[AutoReach] Profile stored:', data);
  });

  return data;
};

// Auto-scrape on page load
window.addEventListener('load', () => {
  setTimeout(scrapeAndStore, 2000);
});

// Also scrape on URL changes (LinkedIn is SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('linkedin.com/in/')) {
      setTimeout(scrapeAndStore, 2000);
    }
  }
}).observe(document, { subtree: true, childList: true });