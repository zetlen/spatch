# Button Ergonomics Design

Fixes issues #200, #221, #218, #217.

## #200 — Larger floating zone icons

The radial zone icon (lock/repeat that follows the pointer during play-button
drag) is too small on mobile, hidden under the thumb.

**Fix:** Make `.radial-zone-icon` 2x the play button size (universal, not
mobile-only). SVG stays at 60%, so the visible icon is ~1.2x button diameter.
Use filled tabler icons (`tabler-lock-filled`, filled repeat if available).

## #221 — Play button enlargement and icon rework

The play button is too small and the icons look awkward.

**Fix:**
- Increase `--play-btn-size` by ~40%: `clamp(62px, 13vmin, 84px)` →
  `clamp(86px, 18vmin, 118px)`.
- Replace tabler play icon with an inline `<path>` — a rounded-corner
  equilateral triangle matching the stop square's aesthetic.
- Use `tabler-player-stop-filled` for the stop icon.
- Mode icons (lock/repeat) move from bottom-right badge overlay to centered
  within the button, rendered in a contrasting dark color over the white stop
  icon. They stay the same size.

## #218 — Force splash in cramped landscape

Wide mobile screens in landscape make the canvas unusably small and the
toolbars too large.

**Fix:** Use `matchMedia('(orientation: landscape) and (max-height: 500px)')`.
When matched:
- Remove `is-editing` from body (hides toolbars).
- Stop playback.
- Set splash state active.
- Block splash dismiss until the query no longer matches.
- Show a subtle "Rotate to portrait" message.

Listen via `change` event on the `MediaQueryList`, not resize events.

## #217 — Remove share functionality

The share button and menu take horizontal space in the top toolbar. Share will
be reimplemented later with a different UX (#118).

**Fix:** Delete the share button and share menu from HTML, delete `share.ts`,
remove all imports and wiring. Clean removal, no preserved code.
