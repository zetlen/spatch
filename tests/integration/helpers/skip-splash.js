// Skip the first-load splash by marking the current URL as seen.
// Use via: await page.addInitScript({ path: '...helpers/skip-splash.js' });
// Writes the current pathname into the spatch-seen sessionStorage array.
{
  const key = 'spatch-seen';
  const pathname = location.pathname;
  let list = [];
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) list = JSON.parse(raw);
  } catch {}
  if (!list.includes(pathname)) {
    list.push(pathname);
    sessionStorage.setItem(key, JSON.stringify(list));
  }
}
