# Toolbar Redesign — Design Document

Issue: #36 — Redesign toolbars as dropdowns

## Goals

1. Replace all Unicode icon characters and text labels with consistent Tabler
   Icons (inline SVG, MIT-licensed, 24x24 grid, 2px stroke,
   `stroke="currentColor"`).
2. Remove all visible text except the SPATCH logo. Use `title` attributes on
   every button for desktop hover hints.
3. Split UI between top bar (canvas-wide actions) and bottom bar
   (context-sensitive tools/properties), both usable on narrow viewports.
4. Make undo, redo, copy, paste, duplicate, and delete accessible without a
   keyboard.

## Top Bar — Canvas-Wide Actions

```
[SPATCH] [▶ play] [↗ share] │ [◎ reverb] │ [↩ undo] [↪ redo] │ [+ new]
```

### Layout

Single flex row with four groups separated by visual dividers:

- **Left group:** SPATCH logo, play button, share button
- **Center-left group:** Reverb toggle
- **Right group:** Undo, redo
- **Far-right group:** New (clear all)

### Play Button

Icon-only: `player-play-filled` when stopped, `player-stop-filled` when
playing. No text label.

The fan gesture for latch/loop modes reverses direction — the fan drops
**downward** from the play button instead of upward. Fan options float below:
latch (`lock` icon), loop (`repeat` icon). Same pointer-capture drag mechanics,
position changes from `bottom: calc(100% + 6px)` to `top: calc(100% + 6px)`.

If already playing (latched or looping), tap stops playback (existing behavior).

### Share Button

Tabler `share` icon. Opens existing dropdown below the button with "Share link"
and "Embed code" items. These dropdown items can keep their SVG icons + text
since they are a selection UI, not toolbar labels.

### Reverb Toggle

Tabler `ripple` icon. Behavior:

- No reverb: tap adds default reverb (`depth: 0.5, style: 'glow'`) and opens
  popover below.
- Has reverb: tap toggles popover open/close. Button shows `.active` state.

Popover contains:
- Style toggle: glow (`sun` icon) / dim (`moon` icon)
- Depth slider
- Remove button (`trash` icon, danger color)

Popover dismisses on outside click.

### Undo / Redo

Tabler `arrow-back-up` and `arrow-forward-up`. Title attributes include keyboard
shortcuts: `title="Undo (Ctrl+Z)"`, `title="Redo (Ctrl+Y)"`.

### New

Tabler `file-plus` icon. Separated from undo/redo by a divider, rightmost
position. Tap takes an undo snapshot then clears all voices. Undo can reverse
it. `title="New"`.

## Bottom Bar — Context-Sensitive

The bottom bar has two states based on selection.

### No Selection: Shape Tools

```
[↖ select] │ [△ triangle] [□ square] [○ circle]
```

Centered flex row. The select tool and shape tools use existing clean SVGs
(triangle/square/circle outlines). The select tool gets Tabler `pointer` icon.

Active tool shows pressed/inset border (existing `.active` style). Tapping
select when something is selected deselects it.

### Shape Selected: Property Controls

```
[■ swatch] [≡ pattern ▾] [⊕ blend ▾] [□ border] │ [🗑 delete]
```

Property icons replace shape tools when a voice is selected. Delete is
rightmost, separated by a divider, danger-colored.

**Transition:** Fast crossfade (100ms out, 100ms in) when selection state
changes.

#### Fill Swatch

A colored square rendered dynamically from the selected voice's fill. Not an
icon — it's a live preview.

Tap opens **inline expansion**: the bottom bar grows upward to reveal the color
picker. Contains same tabs (Solid / Linear) and native `<input type="color">`
controls as the current panel. Tab switching, angle slider for linear gradient —
all preserved.

Tap swatch again or change selection to collapse.

#### Pattern Dropdown

Trigger: Tabler `texture` icon. Active pattern shown via `.active` state on the
trigger button.

Tap opens a dropdown floating above the button with 6 options:
- None, Stripes, Checker, Noise, Gradient, Rough

Each option rendered as a horizontal band showing the actual pattern. Use CSS
backgrounds or small inline canvases to generate pattern previews. Current
pattern has a highlight/checkmark.

Selecting an option applies it, closes the dropdown.

#### Blend Dropdown

Trigger: Tabler `layers-intersect` icon.

Tap opens a dropdown with 7 blend mode options, icons only:

| Blend Mode  | Icon         | Rationale          |
|-------------|--------------|-------------------|
| soft-light  | `feather`    | Soft, gentle       |
| multiply    | `stack-2`    | Darkening layers   |
| screen      | `sun`        | Brightening        |
| overlay     | `layers-linked` | Contrast boost  |
| color-burn  | `flame`      | Burning            |
| difference  | `arrows-diff`| Inversion          |
| exclusion   | `code-minus` | Exclusion          |

These icons are starting points — exact choices will be refined during
implementation based on visual distinctiveness at 24x24. Each item gets a
`title` attribute with the blend mode name.

Current blend mode highlighted. Selecting applies and closes.

#### Border Button

Tabler `border-outer` icon. Behavior:

- No border: tap adds default border and expands inline controls within the
  bottom bar (bar grows upward).
- Has border: tap toggles inline controls open/closed. Button shows `.active`
  state.

Inline controls contain:
- Color toggle: white (`circle` filled white) / black (`circle` filled black).
  Title attributes: "Octave up" / "Octave down".
- Style toggle: single / double. Icons TBD (possibly `square` / `squares`).
- Thickness slider.
- Remove button (danger-colored).

#### Delete Button

Tabler `trash` icon in `var(--danger)` color. Tap deletes selected voice with
undo snapshot. `title="Delete"`.

## Accessibility via `title` Attributes

Every interactive element gets a `title` attribute providing a text hint. On
desktop, hovering reveals the label. On mobile, long-press shows the tooltip
(browser-dependent).

This preserves the enigmatic, wordlessly-intuitive aesthetic while ensuring
discoverability for new users.

Examples:
- `title="Play"`, `title="Share"`, `title="Reverb"`
- `title="Undo (Ctrl+Z)"`, `title="Redo (Ctrl+Y)"`
- `title="Fill color"`, `title="Pattern"`, `title="Blend mode"`
- `title="Border"`, `title="Delete"`
- `title="New"`

## Touch Targets

Minimum 44x44px for all interactive elements (up from current 36x36px). Bottom
bar gets additional vertical padding to accommodate. Dropdown items are at least
44px tall.

## Responsive Behavior

- **Default:** Both bars are single-row flex layouts.
- **Narrow viewports (<400px):** Top bar may wrap — SPATCH + play + share on
  first line, reverb + undo/redo + new on second line. Bottom bar must NOT
  wrap; 5 property icons at 44px each (~260px total) fit on 320px screens.
- **`safe-area-inset-bottom`:** Preserved on bottom bar (existing behavior).

## What Gets Removed

- All Unicode icon characters (`&#8630;`, `&#8631;`, `&#9632;`, `&#9676;`,
  `&#10005;`, `&#8709;`, `&#9776;`, `&#9638;`, `&#9618;`, `&#9653;`,
  `&#10070;`, `&#8943;`, `&#9654;`, `&#9632;`)
- Text labels "PLAY" / "STOP" on the play button
- Native `<select>` element for blend mode
- Text labels inside panels ("Color", "Style", "Thickness", "Stop 1", "Stop 2",
  "Angle", "Remove", "Remove border")
- Text tool button and text input field (text decorations disabled)
- The word "PLAY" (replaced with icon)

## What Stays

- SPATCH logo text (the only text)
- Share dropdown item text ("Share link", "Embed code") — these are in a
  selection UI, not toolbar labels
- Keyboard shortcuts (unchanged, just no longer the only way to access actions)
- The hybrid-bevel button styling (border-color trick for pressed/raised states)
- The play fan gesture mechanics (just reversed direction)
- All current functionality — this is purely a UI reorganization

## Modules Affected

- `index.html` — restructure toolbar HTML, add inline SVG icons, remove text
  tool elements
- `css/style.css` — dropdown menu styles, inline expansion animation, larger
  touch targets, bottom bar context switching, responsive adjustments
- `toolbar.ts` — context-sensitive bottom bar logic, dropdown open/close,
  inline expansion, new button action, remove text tool bindings
- `app.ts` — update play fan direction, add "new" action, update splash reveal
  for new bar structure
