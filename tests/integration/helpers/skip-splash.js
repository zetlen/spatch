// Skip the first-load splash by marking the current URL as seen.
// Use via: await page.addInitScript({ path: '...helpers/skip-splash.js' });
// Sets the key for whatever URL the page loads at, so it works for hash URLs too.
localStorage.setItem(`spatch-seen:${location.pathname}${location.hash}`, '1');
