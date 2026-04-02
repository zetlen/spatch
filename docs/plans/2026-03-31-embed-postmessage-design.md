# Embed PostMessage Protocol

**Issue:** #315 — Embeds should be externally controllable via postMessage API
**Date:** 2026-03-31
**Status:** Design

## Motivation

The tutorial manipulates the main app's `SigilStore` directly to demo voices,
chords, and animations. This pollutes the URL with tutorial demo state and
requires save/restore of the user's spatch. If the tutorial rendered demos in
an embedded spatch iframe (`/embed/<data>`), demo state would be completely
isolated.

## Core insight

The URL wire format (`serialize.ts`) already solves state encoding: ~4 bytes
header + 11–16 bytes per voice, base64-url-safe, self-versioned. The
postMessage protocol reuses it verbatim — the embed becomes a stateless
renderer that applies snapshots from the parent.

## Message envelope

All messages are JSON with `source: 'spatch'` for namespace isolation:

```ts
interface SpatchMessage {
  source: 'spatch';
  type: string;
}
```

The embed ignores any `message` event where `e.data?.source !== 'spatch'`.

## Commands (parent → embed)

| Type   | Extra fields                  | Description                                       |
|--------|-------------------------------|---------------------------------------------------|
| `load` | `data: string` or             | Replace entire sigil state. Two forms:             |
|        | `state: SigilData`            | `data` is a serialized base64 string (URL format); |
|        |                               | `state` is a plain SigilData object (structured-   |
|        |                               | cloned by postMessage, no encoding needed).        |
| `play` | —                             | Start playback (warm up AudioContext, load scene   |
|        |                               | IR, play).                                         |
| `stop` | —                             | Trigger release phase.                             |
| `convert` | `data: string` + `id` or  | Serialization RPC. Send wire format, get back      |
|           | `state: SigilData` + `id` | the object (or vice versa). Response is a          |
|           |                           | `converted` event with the same `id`.              |

`load` subsumes all fine-grained mutations (`moveVoice`, `addVoice`,
`removeVoice`, `setEnvelope`). The parent mutates its local state model
and sends `load`. The parent is the authority; the embed is stateless
between loads. The object form avoids reimplementing the wire encoder —
postMessage handles structured cloning natively.

## Events (embed → parent)

| Type      | Extra fields      | Description                                         |
|-----------|-------------------|-----------------------------------------------------|
| `ready`     | —                        | Boot complete, scene loaded, safe to send commands. |
| `playing`   | —                        | Audio started (post-warmup, post-IR-load).          |
| `stopped`   | —                        | Release complete, audio silent.                     |
| `converted` | `id` + `data` or `state` | Response to a `convert` command (opposite form).    |
| `error`     | `message: string`        | Deserialization failed, audio blocked, etc.         |

## Why full snapshots

A 4-voice sigil serializes to ~70 characters. At 60fps that's ~4KB/s of
postMessage traffic — negligible. Full snapshots:

- Reuse the existing serialization with no new code.
- Avoid the voice identity problem (serialized voices have no IDs).
- Eliminate sync bugs — no partial state, no ordering constraints.
- Keep the embed a pure function of the last `load`.

## Origin policy

- **Same-origin** (tutorial): automatic.
- **Cross-origin**: embed validates `event.origin` against an allowlist passed
  as a query param: `/embed/<data>?origin=https://example.com` (comma-separated
  for multiple).

## iOS Safari audio

iOS requires a user gesture within the iframe to unlock `AudioContext`. On
first `play` with locked audio, the embed shows a "tap to enable sound"
overlay. After one tap, subsequent `play` commands work. The overlay appears
at most once per embed lifetime.

## Blank-start embeds

The embed can boot with no initial state:

```html
<iframe src="/embed/"></iframe>
```

It emits `ready` immediately, then the parent sends `load` commands. This is
the expected pattern for the tutorial — no URL pollution.

## Usage example

```ts
const iframe = document.createElement('iframe');
iframe.src = '/embed/';
container.appendChild(iframe);

window.addEventListener('message', (e) => {
  if (e.data?.source !== 'spatch') return;
  if (e.data.type === 'ready') {
    post({ type: 'load', data: serializeState(demoState) });
    post({ type: 'play' });
  }
});

function post(msg: { type: string; [k: string]: unknown }) {
  iframe.contentWindow!.postMessage(
    { source: 'spatch', ...msg },
    location.origin
  );
}
```

## Implementation plan

1. Refactor `embed-entry.ts`: extract `boot()` internals into a controller
   class that can re-render and re-play on state changes.
2. Add `postMessage` listener with `load`, `play`, `stop` handlers.
3. Emit `ready`, `playing`, `stopped`, `error` events to `parent`.
4. Support blank-start (no URL state → boot with empty renderer, wait for
   `load`).
5. Add iOS audio unlock overlay (shown on first `play` when audio is locked).
6. Add origin validation from `?origin=` query param.
