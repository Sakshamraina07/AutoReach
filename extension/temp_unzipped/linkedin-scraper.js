const scrapeLinkedInProfile = () => {
  const getText = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.innerText.trim() : '';
  };

  const getMultiple = (selector) => {
    return Array.from(document.querySelectorAll(selector))
      .map(el => el.innerText.trim())
      .filter(Boolean);
  };

  const name =
    getText('h1.text-heading-xlarge') ||
    getText('.pv-text-details__left-panel h1') ||
    getText('h1');

  const headline =
    getText('.text-body-medium.break-words') ||
    getText('.pv-text-details__left-panel .text-body-medium') ||
    '';

  const experienceItems = getMultiple(
    '#experience ~ .pvs-list__outer-container .pvs-entity__path-node'
  );
  const company =
    experienceItems[0] ||
    (headline.includes(' at ') ? headline.split(' at ').pop() : '') ||
    '';

  const location =
    getText('.text-body-small.inline.t-black--light.break-words') ||
    getText('.pv-text-details__left-panel span.text-body-small') ||
    '';

  const about =
    getText('#about ~ .pvs-list__outer-container .pvs-list__item--no-padding-in-columns span[aria-hidden="true"]') ||
    getText('.pv-shared-text-with-see-more span[aria-hidden="true"]') ||
    getText('#about + div span') ||
    '';

  const recentPostEls = document.querySelectorAll(
    '.feed-shared-update-v2__description span[dir="ltr"], .feed-shared-text span'
  );
  const recentPost = recentPostEls.length > 0
    ? recentPostEls[0].innerText.trim().slice(0, 300)
    : '';

  const roleTitles = getMultiple(
    '#experience ~ .pvs-list__outer-container .t-bold span[aria-hidden="true"]'
  );
  const currentRole = roleTitles[0] || '';

  const profileUrl = window.location.href.split('?')[0];

  return { name, headline, company, currentRole, location, about: about.slice(0, 500), recentPost, profileUrl };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE_LINKEDIN_PROFILE') {
    try {
      const profileData = scrapeLinkedInProfile();
      sendResponse({ success: true, data: profileData });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});

window.addEventListener('load', () => {
  setTimeout(() => {
    const profileData = scrapeLinkedInProfile();
    if (profileData.name) {
      chrome.runtime.sendMessage({
        type: 'LINKEDIN_PROFILE_LOADED',
        data: profileData,
      });
    }
  }, 2000);
});
