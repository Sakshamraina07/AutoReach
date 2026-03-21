const scrapeAndStore = () => {
  const getText = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.innerText.trim() : '';
  };
  const getMultiple = (selector) => {
    return Array.from(document.querySelectorAll(selector))
      .map(el => el.innerText.trim()).filter(Boolean);
  };

  const name = getText('h1.text-heading-xlarge') || getText('h1');
  const headline = getText('.text-body-medium.break-words') || '';
  const experienceItems = getMultiple('#experience ~ .pvs-list__outer-container .pvs-entity__path-node');
  const company = experienceItems[0] || (headline.includes(' at ') ? headline.split(' at ').pop() : '') || '';
  const location = getText('.text-body-small.inline.t-black--light.break-words') || '';
  const about = getText('#about ~ .pvs-list__outer-container .pvs-list__item--no-padding-in-columns span[aria-hidden="true"]') || getText('#about + div span') || '';
  const recentPostEls = document.querySelectorAll('.feed-shared-update-v2__description span[dir="ltr"], .feed-shared-text span');
  const recentPost = recentPostEls.length > 0 ? recentPostEls[0].innerText.trim().slice(0, 300) : '';
  const roleTitles = getMultiple('#experience ~ .pvs-list__outer-container .t-bold span[aria-hidden="true"]');
  const currentRole = roleTitles[0] || '';
  const profileUrl = window.location.href.split('?')[0];

  const data = { name, headline, company, currentRole, location, about: about.slice(0, 500), recentPost, profileUrl };

  // ✅ Store in chrome.storage so extension can read it
  chrome.storage.local.set({ linkedinProfile: data }, () => {
    console.log('[AutoReach] Profile stored:', data.name);
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
