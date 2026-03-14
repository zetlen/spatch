# Path-Based Routing for spatch

## Problem

1. **Hash-based URLs prevent proper linking.** Different spatches are
   distinguished only by the hash fragment (`/#base64data`). Browsers reuse the
   same tab when navigating to the same origin with a different hash, making it
   hard to share distinct links that open reliably.

2. **Nginx 404s on arbitrary paths.** The nginx container serves static files
   with no SPA fallback, so any path other than `/` or `/embed.html` returns a
   404. This prevents using real path segments for URLs.

3. **No browser history.** The app uses `history.replaceState` exclusively, so
   editing a shared spatch silently overwrites the original URL. Back/forward
   navigation does nothing useful.

## Design

### URL Structure

| Route                        | Serves        | Behavior                           |
|------------------------------|---------------|------------------------------------|
| `/`                          | `index.html`  | Empty canvas (random scene)        |
| `/p/<base64data>`            | `index.html`  | Editor with deserialized state     |
| `/embed/<base64data>`        | `embed.html`  | Read-only press-to-play viewer     |

The `<base64data>` segment is the same bespoke Base64-encoded bitfield string
currently stored in the hash fragment. The `/p/` prefix namespaces spatch data
URLs away from other routes.

### Nginx Configuration

A new `nginx.conf` file is added to the repository root and deployed alongside
the static assets. This file is placed at `/etc/nginx/conf.d/default.conf` in
the container, which is an include loaded by the main `nginx.conf`. It only
overrides location routing; the base nginx config (MIME types, gzip, etc.)
remains from the default image.

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Embed viewer: /embed/ and /embed/<data> → embed.html
    location ~ ^/embed/ {
        try_files /embed.html =404;
    }

    # Everything else: /p/<data>, /, etc. → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

The `~ ^/embed/.+` regex ensures only sub-paths of `/embed/` are matched (not
bare `/embed/` or static assets that happen to start with `/embed/`). The
catch-all `location /` includes `$uri` and `$uri/` so real static assets
(JS, CSS, images) are still served directly.

The deploy workflow is updated to copy this config into the container and reload
nginx:

```yaml
- name: Build and deploy
  run: |
    bun run build
    docker cp dist/. spatch:/usr/share/nginx/html/
    docker cp nginx.conf spatch:/etc/nginx/conf.d/default.conf
    docker exec spatch nginx -s reload
```

### Vite Dev Server

The Vite dev server needs equivalent SPA fallback for local development and
integration tests. A custom middleware is added to `vite.config.ts` via the
`configureServer` hook:

- Requests matching `/embed/<anything>` are rewritten to `/embed.html`.
- All other requests that don't match a file are rewritten to `/index.html`.

This ensures `bun run dev` and Playwright tests work with the new path-based
URLs without needing nginx locally.

### Serialization Changes (`serialize.ts`)

**Reading the URL (`loadFromURL`):**

1. Check `location.hash`. If non-empty, parse the hash, `replaceState` to the
   equivalent `/p/<data>` path, and return the parsed state. This is a one-time
   migration for old hash-based URLs.
2. Otherwise, read `location.pathname`. If it starts with `/p/`, strip the
   prefix and deserialize.
3. If the path is `/` or does not start with `/p/` (e.g. `/vibecheck` debug
   route), return `null` (triggers random scene, no voices — existing behavior).
   Non-`/p/` paths are not treated as state data.

**Writing the URL (`saveToURL`):**

- Constructs the path `/p/<base64data>` (or `/` if no voices).
- Uses a module-level `dirty` flag (starts `false` on page load and on each
  `popstate` event):
  - **First save after arrival** (`dirty === false`): calls
    `history.pushState()` to preserve the arrival URL in browser history. Sets
    `dirty = true`.
  - **Subsequent saves** (`dirty === true`): calls `history.replaceState()` to
    update in-place without piling up history entries.

The existing debounce (1000ms) is preserved.

**`debouncedSave` in `app.ts`:** The empty-canvas case currently clears the hash
via `replaceState`. This must be updated to write `/` as the path instead. The
`debouncedSave` function also needs two new behaviors:

1. **Navigation guard:** A module-level `navigating` flag is set `true` before
   `store.loadState()` in the popstate handler. `debouncedSave` checks this flag
   and skips the save if true. The flag is cleared synchronously after
   `loadState()` returns (the signal effect fires synchronously during
   `loadState`, so the guard covers the debounce trigger).
2. **Cancel on popstate:** The popstate handler cancels any pending debounced
   save timeout (via `clearTimeout`) before loading state, preventing a stale
   save from firing after navigation and causing an unwanted `pushState`.

### History Navigation (`app.ts`)

A new `popstate` event listener:

1. Reads the new `location.pathname`.
2. Strips `/p/` prefix and deserializes.
3. Loads the deserialized state into the store via `store.loadState()`.
4. Resets the `dirty` flag to `false` (so the next edit pushes state again).
5. Updates the scene and canvas as needed.

The popstate handler must avoid triggering `saveToURL` in response to the state
load (since the URL is already correct). The existing debounced save subscribes
to `store.data` changes, so the handler should set a guard flag that the save
function checks.

### Share Links (`share.ts`)

- **App link:** `${location.origin}/p/${serializeState(store.data)}`
- **Embed link:** `${location.origin}/embed/${serializeState(store.data)}`
- **Embed snippet:** `<iframe src="${embedLink}" ...>`

### Embed Entry (`embed-entry.ts`)

Reads state from `location.pathname` instead of `location.hash`:

1. Check `location.hash`. If non-empty, parse the hash, `replaceState` to the
   equivalent `/embed/<data>` path. (Hash migration for old embed URLs.)
2. Strip `/embed/` prefix from pathname and deserialize.
3. Proceed with existing render and playback logic.

### Splash Screen

No changes needed. The splash controller uses `localStorage` with a key derived
from the current URL. Since the URL changes from hash-based to path-based, the
splash will show once for the new URL format. This is acceptable — it's a
one-time occurrence per spatch and the "no backwards compat" policy applies.

### Edge Cases

**Empty canvas navigation:** When the user clears all voices, `saveToURL`
writes `/` (strips the `/p/` prefix). Navigating back restores the previous
spatch.

**Direct `/p/` visit with invalid data:** `deserializeState` already handles
malformed input by returning `null`. The app falls back to random scene with no
voices, same as visiting `/`.

**Hash migration:** The one-time hash-to-path redirect in `loadFromURL` means
existing shared links (bookmarks, messages) continue to work. The hash is
consumed and replaced with the path form on first visit.

### Asset Paths

Vite's production build uses absolute paths (`/assets/...`) by default, and the
`base` config defaults to `/`. This means assets resolve correctly regardless of
the URL path depth (e.g. `/p/ABC123` won't cause relative path resolution
issues). No `<base>` tag or Vite `base` config change is needed.

## Files Changed

| File                                    | Change                                      |
|-----------------------------------------|----------------------------------------------|
| `nginx.conf` (new)                      | SPA fallback config for nginx                |
| `.gitea/workflows/deploy.yml`           | Copy nginx.conf + reload nginx               |
| `vite.config.ts`                        | Add dev server middleware for SPA fallback    |
| `js/serialize.ts`                       | Path-based read/write, hash migration, dirty flag |
| `js/app.ts`                             | Add `popstate` listener, navigation guard, cancel debounce |
| `js/share.ts`                           | Path-based link generation (update `appBaseUrl`/`embedBaseUrl`) |
| `js/embed-entry.ts`                     | Read from pathname + hash migration          |
| `js/splash.ts`                          | No changes (localStorage key adapts naturally) |
| `tests/integration/serialization.test.js` | Update hash assertions → path assertions   |
| `tests/integration/share.test.js`       | Update URL format assertions                 |
| `tests/integration/embed.test.js`       | Update embed URL format                      |
| `tests/integration/splash.test.js`      | Update localStorage keys and navigation URLs |

## Non-Goals

- Backwards-compatible hash URLs beyond the one-time redirect.
- Server-side rendering or prerendering.
- Short URLs or URL shortening service.
- Dockerfile or image build changes.
