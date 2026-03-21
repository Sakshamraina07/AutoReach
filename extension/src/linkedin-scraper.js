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

  // ✅ Get company from Experience section — most reliable
  const experienceSection = document.querySelector('#experience');
  let company = '';

  if (experienceSection) {
    // Try multiple selectors for company name in experience
    const companySelectors = [
      '#experience ~ .pvs-list__outer-container .t-14.t-normal.t-black--light span[aria-hidden="true"]',
      '#experience ~ .pvs-list__outer-container .pv-entity__secondary-title span[aria-hidden="true"]',
      '#experience + * .pvs-list__item--line-separated .t-14 span[aria-hidden="true"]',
      '#experience ~ * li:first-child .t-14.t-normal span[aria-hidden="true"]',
    ];

    for (const selector of companySelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim() && el.innerText.trim().length > 1) {
        company = el.innerText.trim();
        // Clean up — remove employment type like "Full-time", "Part-time"
        company = company.split('·')[0].trim();
        break;
      }
    }

    // If still empty — try getting all text nodes from first experience item
    if (!company) {
      const firstExpItem = document.querySelector(
        '#experience ~ .pvs-list__outer-container li:first-child'
      );
      if (firstExpItem) {
        const allSpans = firstExpItem.querySelectorAll('span[aria-hidden="true"]');
        // Second span is usually company name (first is job title)
        if (allSpans.length >= 2) {
          company = allSpans[1].innerText.trim().split('·')[0].trim();
        }
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