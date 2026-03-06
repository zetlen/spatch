# Radial Play Gesture Design

Addresses [issue #114](https://got.colonpipe.org/zetlen/spatch/issues/114): play
button fan-out is hidden by finger on mobile.

## Problem

The current play button sits in the top toolbar. Its fan-out menu (latch/loop
options) drops downward and is obscured by the user's finger on mobile. The
button is also far from comfortable thumb reach.

## Solution

Replace the toolbar play button and fan-out with a **radial gesture** on a
repositioned button.

### Button Relocation and Restyling

The play button moves from the top toolbar to the **stage area**, centered
horizontally below the canvas frame, in the gap between the frame and the bottom
toolbar. It adopts the stage switcher's visual style: transparent background, no
border, white icon with `drop-shadow`, subtle opacity on hover. Hit target is
36-40px (slightly larger than the 28px stage switcher, since it's a primary
control).

The share button stays in the top toolbar.

### Radial Overlay Zones

On `pointerdown`, audio starts playing (momentary mode). A translucent overlay
appears centered on the button, covering the full app, with three concentric
filled zones:

```
+--------------------------------------------------+
|                                                  |
|              LATCH ZONE (outer)                  |
|         slightly different tint                  |
|                                                  |
|        +------------------------------+         |
|        |                              |         |
|        |       LOOP ZONE (middle)     |         |
|        |     largest zone, subtle     |         |
|        |     tint, loop duration      |         |
|        |     scales with drag dist    |         |
|        |                              |         |
|        |      +----------------+      |         |
|        |      | MOMENTARY ZONE |      |         |
|        |      |  (inner disc)  |      |         |
|        |      |   ~80px radius |      |         |
|        |      +----------------+      |         |
|        |                              |         |
|        +------------------------------+         |
|                                                  |
+--------------------------------------------------+
```

- **Inner disc** (~80px radius): Momentary zone. Releasing here stops playback.
- **Middle ring** (~80px to ~70% of screen edge): Loop zone. Largest area.
  Loop duration scales logarithmically with drag distance (100ms-2000ms).
- **Outer ring** (remaining space to screen edges): Latch zone. Wide enough
  for thumb release at device edge.

Zones have similar translucency with very slightly different tints. The active
zone (where the pointer currently is) highlights with brighter tint or subtle
border emphasis. Zone boundaries are visible as subtle edges between tints.

### Release Behavior

- Release in inner disc: stop (was momentary play only)
- Release in middle ring: commit to loop mode at calculated duration
- Release in outer ring: commit to latch mode
- Overlay disappears on release

### Active State Indicators

- **Any active mode**: Play icon swaps to stop icon
- **Loop mode**: Circular progress ring around the button, filling clockwise,
  one full rotation per loop cycle
- **Latch mode**: Subtle glow around the button (soft box-shadow or similar)

### Keyboard

Space bar behavior unchanged: toggles latch mode.

### Removed

- `.play-fan-wrap`, `.play-fan`, `.fan-option` elements and CSS
- Mode indicator badges (`#play-mode-lock`, `#play-mode-loop`)
- Left-to-right linear gradient loop animation

### Preserved

- iOS Safari audio unlock strategy (warmUp on pointerdown, qualifying gestures)
- Audio engine integration, playback state machine core logic
- Stage switcher position and behavior
