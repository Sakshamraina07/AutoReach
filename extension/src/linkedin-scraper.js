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

  // ✅ Better company selectors
  const company =
    getText('.pv-text-details__right-panel .hoverable-link-text') ||
    getText('[aria-label="Current company"] .hoverable-link-text') ||
    getText('.pv-top-card--experience-list .pv-entity__secondary-title') ||
    getText('.inline-show-more-text--is-collapsed-with-line-clamp .hoverable-link-text') ||
    document.querySelector('.pv-top-card-v2-ctas__custom-action .pv-top-card-v2-ctas__job-title')?.innerText?.trim() ||
    // Try getting from experience section
    getText('#experience ~ .pvs-list__outer-container li:first-child .t-14.t-normal .visually-hidden') ||
    getText('.pv-top-card--experience-list-item') ||
    // Extract from about text if contains company name
    (getText('#about ~ * span[aria-hidden="true"]') || '') ||
    '';

  // ✅ Better about selector
  const aboutEl = document.querySelector('#about ~ .pvs-list__outer-container span[aria-hidden="true"]') ||
    document.querySelector('.pv-shared-text-with-see-more span[aria-hidden="true"]') ||
    document.querySelector('#about + div .visually-hidden');
  const about = aboutEl ? aboutEl.innerText.trim() : '';

  const location = getText('.text-body-small.inline.t-black--light.break-words') || '';

  const recentPostEls = document.querySelectorAll('.feed-shared-update-v2__description span[dir="ltr"], .feed-shared-text span[dir="ltr"]');
  const recentPost = recentPostEls.length > 0 ? recentPostEls[0].innerText.trim().slice(0, 300) : '';

  const roleTitles = getMultiple('#experience ~ .pvs-list__outer-container .t-bold span[aria-hidden="true"]');
  const currentRole = roleTitles[0] || '';

  // ✅ Try to get company from experience section
  const companyFromExp = getMultiple('#experience ~ .pvs-list__outer-container .t-14.t-normal.t-black--light span[aria-hidden="true"]')[0] || '';

  const finalCompany = company || companyFromExp || '';

  const profileUrl = window.location.href.split('?')[0];

  const data = {
    name,
    headline,
    company: finalCompany,
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

// Also scrape on URL changes
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