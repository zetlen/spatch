import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

// Set up DOM environment before importing modules that use `document`
let render, resetCache, normalizedCoord, createDefaultState;

const SVG_NS = 'http://www.w3.org/2000/svg';

beforeAll(async () => {
  const win = new Window();
  // Bun doesn't populate happy-dom's Window with native error constructors.
  // SelectorParser.getSelectorGroups() uses `this.window.SyntaxError` internally,
  // which is undefined without this patch, crashing any querySelector on SVG elements.
  win.window.SyntaxError = globalThis.SyntaxError;
  globalThis.document = win.document;
  globalThis.HTMLElement = win.window.HTMLElement;
  globalThis.SVGElement = win.window.SVGElement;
  globalThis.addEventListener = win.window.addEventListener.bind(win.window);

  const renderMod = await import('../../js/canvas/render.ts');
  render = renderMod.render;
  resetCache = renderMod.resetCache;

  const typesMod = await import('../../js/types.ts');
  normalizedCoord = typesMod.normalizedCoord;

  const stateMod = await import('../../js/state.ts');
  createDefaultState = stateMod.createDefaultState;
});

function createSVG() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1 1');
  // Must attach to document for happy-dom's querySelector to work on SVG elements
  document.body.appendChild(svg);
  return svg;
}

function makeSineVoice(overrides = {}) {
  return {
    id: 'v-sine-1',
    waveform: 'sine',
    x: normalizedCoord(0.5),
    y: normalizedCoord(0.5),
    size: normalizedCoord(0.2),
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    effect: undefined,
    blend: 'screen',
    border: undefined,
    ...overrides,
  };
}

function makePulseVoice(overrides = {}) {
  return {
    id: 'v-pulse-1',
    waveform: 'pulse',
    x: normalizedCoord(0.3),
    y: normalizedCoord(0.3),
    size: normalizedCoord(0.15),
    fill: { mode: 'solid', h: 120, s: 70, l: 45 },
    effect: undefined,
    blend: 'screen',
    border: undefined,
    timbre: normalizedCoord(0),
    ...overrides,
  };
}

function makeBlendVoice(overrides = {}) {
  return {
    id: 'v-blend-1',
    waveform: 'blend',
    x: normalizedCoord(0.7),
    y: normalizedCoord(0.7),
    size: normalizedCoord(0.18),
    fill: { mode: 'solid', h: 30, s: 90, l: 55 },
    effect: undefined,
    blend: 'screen',
    border: undefined,
    timbre: normalizedCoord(0),
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    ...createDefaultState(),
    ...overrides,
  };
}

// ---- Voice creation ----

describe('canvas render — voice creation', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('creates a circle element for sine voice', () => {
    const svg = createSVG();
    const state = makeState({ voices: [makeSineVoice()] });
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    expect(voiceLayer).not.toBeNull();

    const group = voiceLayer.querySelector('g[data-voice-id="v-sine-1"]');
    expect(group).not.toBeNull();

    const circle = group.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle.getAttribute('cx')).toBe('0.5');
    expect(circle.getAttribute('cy')).toBe('0.5');
    expect(circle.getAttribute('r')).toBe('0.1'); // size/2 = 0.2/2
  });

  test('creates a rect element for pulse voice', () => {
    const svg = createSVG();
    const state = makeState({ voices: [makePulseVoice()] });
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    const group = voiceLayer.querySelector('g[data-voice-id="v-pulse-1"]');
    expect(group).not.toBeNull();

    const rect = group.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect.getAttribute('width')).toBe('0.15');
    expect(rect.getAttribute('height')).toBe('0.15');
  });

  test('creates a polygon element for blend voice', () => {
    const svg = createSVG();
    const state = makeState({ voices: [makeBlendVoice()] });
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    const group = voiceLayer.querySelector('g[data-voice-id="v-blend-1"]');
    expect(group).not.toBeNull();

    const polygon = group.querySelector('polygon');
    expect(polygon).not.toBeNull();
    // Should have a points attribute with 3 points
    const points = polygon.getAttribute('points');
    expect(points).toBeDefined();
    expect(points.split(' ')).toHaveLength(3);
  });

  test('creates multiple voices at once', () => {
    const svg = createSVG();
    const state = makeState({
      voices: [makeSineVoice(), makePulseVoice(), makeBlendVoice()],
    });
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    const groups = voiceLayer.querySelectorAll('g[data-voice-id]');
    expect(groups.length).toBe(3);
  });
});

// ---- Layer structure ----

describe('canvas render — layer structure', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('creates defs, voices, and selection layers', () => {
    const svg = createSVG();
    const state = makeState();
    render(svg, state, undefined);

    expect(svg.querySelector('defs')).not.toBeNull();
    expect(svg.querySelector('g[data-layer="voices"]')).not.toBeNull();
    expect(svg.querySelector('g[data-layer="selection"]')).not.toBeNull();
  });

  test('voice layer has isolation style', () => {
    const svg = createSVG();
    const state = makeState();
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    expect(voiceLayer.style.isolation).toBe('isolate');
  });

  test('reuses existing layers on re-render', () => {
    const svg = createSVG();
    const state = makeState({ voices: [makeSineVoice()] });
    render(svg, state, undefined);

    const firstVoiceLayer = svg.querySelector('g[data-layer="voices"]');

    render(svg, state, undefined);

    const secondVoiceLayer = svg.querySelector('g[data-layer="voices"]');
    expect(secondVoiceLayer).toBe(firstVoiceLayer);
  });
});

// ---- Voice update ----

describe('canvas render — voice update', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('updates position without creating new elements', () => {
    const svg = createSVG();
    const voice = makeSineVoice();
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    const groupsBefore = voiceLayer.querySelectorAll('g[data-voice-id]').length;
    const circle = voiceLayer.querySelector('circle');
    expect(circle.getAttribute('cx')).toBe('0.5');

    // Update position
    const updatedVoice = { ...voice, x: normalizedCoord(0.8), y: normalizedCoord(0.3) };
    const state2 = makeState({ voices: [updatedVoice] });
    render(svg, state2, undefined);

    const groupsAfter = voiceLayer.querySelectorAll('g[data-voice-id]').length;
    expect(groupsAfter).toBe(groupsBefore);

    const updatedCircle = voiceLayer.querySelector('circle');
    expect(updatedCircle.getAttribute('cx')).toBe('0.8');
    expect(updatedCircle.getAttribute('cy')).toBe('0.3');
  });

  test('updates size without creating new elements', () => {
    const svg = createSVG();
    const voice = makeSineVoice();
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const circle = svg.querySelector('g[data-layer="voices"] circle');
    expect(circle.getAttribute('r')).toBe('0.1');

    const updatedVoice = { ...voice, size: normalizedCoord(0.4) };
    const state2 = makeState({ voices: [updatedVoice] });
    render(svg, state2, undefined);

    expect(circle.getAttribute('r')).toBe('0.2'); // 0.4/2
  });

  test('updates rect voice attributes on re-render', () => {
    const svg = createSVG();
    const voice = makePulseVoice();
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const rect = svg.querySelector('g[data-layer="voices"] rect');
    expect(rect.getAttribute('width')).toBe('0.15');

    const updatedVoice = { ...voice, size: normalizedCoord(0.3) };
    const state2 = makeState({ voices: [updatedVoice] });
    render(svg, state2, undefined);

    expect(rect.getAttribute('width')).toBe('0.3');
    expect(rect.getAttribute('height')).toBe('0.3');
  });
});

// ---- Voice removal ----

describe('canvas render — voice removal', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('removes voice group when voice is removed from state', () => {
    const svg = createSVG();
    const voice1 = makeSineVoice({ id: 'v1' });
    const voice2 = makePulseVoice({ id: 'v2' });
    const state = makeState({ voices: [voice1, voice2] });
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    expect(voiceLayer.querySelectorAll('g[data-voice-id]').length).toBe(2);

    // Remove voice1
    const state2 = makeState({ voices: [voice2] });
    render(svg, state2, undefined);

    expect(voiceLayer.querySelectorAll('g[data-voice-id]').length).toBe(1);
    expect(voiceLayer.querySelector('g[data-voice-id="v1"]')).toBeNull();
    expect(voiceLayer.querySelector('g[data-voice-id="v2"]')).not.toBeNull();
  });

  test('removes all voice groups when all voices are removed', () => {
    const svg = createSVG();
    const state = makeState({ voices: [makeSineVoice(), makePulseVoice()] });
    render(svg, state, undefined);

    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    expect(voiceLayer.querySelectorAll('g[data-voice-id]').length).toBe(2);

    const state2 = makeState({ voices: [] });
    render(svg, state2, undefined);

    expect(voiceLayer.querySelectorAll('g[data-voice-id]').length).toBe(0);
  });
});

// ---- Fill rendering ----

describe('canvas render — fill rendering', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('solid fill sets fill attribute to hsl color', () => {
    const svg = createSVG();
    const voice = makeSineVoice({
      fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const circle = svg.querySelector('g[data-layer="voices"] circle');
    const fill = circle.getAttribute('fill');
    expect(fill).toBe('hsl(200, 80%, 50%)');
  });

  test('linear fill creates a linearGradient in defs', () => {
    const svg = createSVG();
    const voice = makeSineVoice({
      id: 'v-grad',
      fill: {
        mode: 'linear',
        h: 200,
        s: 80,
        l: 50,
        h2: 100,
        s2: 60,
        l2: 40,
        gradAngle: 0,
      },
    });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const defs = svg.querySelector('defs');
    const grad = defs.querySelector('#grad-v-grad');
    expect(grad).not.toBeNull();
    expect(grad.tagName.toLowerCase()).toBe('lineargradient');

    // Shape should reference the gradient
    const circle = svg.querySelector('g[data-layer="voices"] circle');
    expect(circle.getAttribute('fill')).toBe('url(#grad-v-grad)');
  });

  test('switching from linear to solid removes gradient def', () => {
    const svg = createSVG();
    const voice = makeSineVoice({
      id: 'v-switch',
      fill: {
        mode: 'linear',
        h: 200,
        s: 80,
        l: 50,
        h2: 100,
        s2: 60,
        l2: 40,
        gradAngle: 0,
      },
    });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const defs = svg.querySelector('defs');
    expect(defs.querySelector('#grad-v-switch')).not.toBeNull();

    // Switch to solid
    const solidVoice = {
      ...voice,
      fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    };
    const state2 = makeState({ voices: [solidVoice] });
    render(svg, state2, undefined);

    expect(defs.querySelector('#grad-v-switch')).toBeNull();
  });
});

// ---- Blend mode ----

describe('canvas render — blend mode', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('blend mode only applies when voices overlap', () => {
    const svg = createSVG();
    // Two overlapping voices at the same position
    const v1 = makeSineVoice({ id: 'v1', blend: 'multiply' });
    const v2 = makePulseVoice({ id: 'v2', x: normalizedCoord(0.5), y: normalizedCoord(0.5) });
    render(svg, makeState({ voices: [v1, v2] }), undefined);

    const group = svg.querySelector('g[data-voice-id="v1"]');
    expect(group.style.mixBlendMode).toBe('multiply');
  });

  test('blend mode reverts to screen when no overlap', () => {
    const svg = createSVG();
    // Single voice — no overlap possible
    const voice = makeSineVoice({ blend: 'multiply' });
    render(svg, makeState({ voices: [voice] }), undefined);

    const group = svg.querySelector('g[data-voice-id="v-sine-1"]');
    expect(group.style.mixBlendMode).toBe('screen');
  });

  test('blend mode updates on re-render when overlap changes', () => {
    const svg = createSVG();
    // Start overlapping
    const v1 = makeSineVoice({ id: 'v1', blend: 'difference' });
    const v2 = makePulseVoice({ id: 'v2', x: normalizedCoord(0.5), y: normalizedCoord(0.5) });
    render(svg, makeState({ voices: [v1, v2] }), undefined);

    const group = svg.querySelector('g[data-voice-id="v1"]');
    expect(group.style.mixBlendMode).toBe('difference');

    // Move v2 far away — no overlap
    const v2Far = { ...v2, x: normalizedCoord(0.01), y: normalizedCoord(0.01) };
    render(svg, makeState({ voices: [v1, v2Far] }), undefined);
    expect(group.style.mixBlendMode).toBe('screen');
  });
});

// ---- Selection indicators ----

describe('canvas render — selection indicators', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('renders selection UI when a voice is selected', () => {
    const svg = createSVG();
    const voice = makeSineVoice();
    const state = makeState({ voices: [voice] });
    render(svg, state, 'v-sine-1');

    const selectionLayer = svg.querySelector('g[data-layer="selection"]');
    // Selection should contain at least the marching ants outlines
    expect(selectionLayer.children.length).toBeGreaterThan(0);
  });

  test('selection layer is empty when no voice is selected', () => {
    const svg = createSVG();
    const voice = makeSineVoice();
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const selectionLayer = svg.querySelector('g[data-layer="selection"]');
    expect(selectionLayer.children.length).toBe(0);
  });

  test('selection UI is cleared on re-render with no selection', () => {
    const svg = createSVG();
    const voice = makeSineVoice();
    const state = makeState({ voices: [voice] });

    // First render with selection
    render(svg, state, 'v-sine-1');
    const selectionLayer = svg.querySelector('g[data-layer="selection"]');
    expect(selectionLayer.children.length).toBeGreaterThan(0);

    // Re-render without selection
    render(svg, state, undefined);
    expect(selectionLayer.children.length).toBe(0);
  });

  test('selection UI changes when selection moves to different voice', () => {
    const svg = createSVG();
    const voice1 = makeSineVoice({ id: 'v1' });
    const voice2 = makePulseVoice({ id: 'v2' });
    const state = makeState({ voices: [voice1, voice2] });

    render(svg, state, 'v1');
    const selectionLayer = svg.querySelector('g[data-layer="selection"]');
    const firstSelectionChildCount = selectionLayer.children.length;
    expect(firstSelectionChildCount).toBeGreaterThan(0);

    // Selection UI for sine (circle) includes circle outlines.
    // Check that the first selection child is a circle (for sine voice).
    const firstOutline = selectionLayer.children[0];
    expect(firstOutline.tagName.toLowerCase()).toBe('circle');

    // Switch selection to pulse voice (rect)
    render(svg, state, 'v2');
    const secondOutline = selectionLayer.children[0];
    expect(secondOutline.tagName.toLowerCase()).toBe('rect');
  });

  test('selection UI is not rendered for a non-existent voice id', () => {
    const svg = createSVG();
    const voice = makeSineVoice();
    const state = makeState({ voices: [voice] });
    render(svg, state, 'non-existent-id');

    const selectionLayer = svg.querySelector('g[data-layer="selection"]');
    expect(selectionLayer.children.length).toBe(0);
  });
});

// ---- Border rendering ----

describe('canvas render — borders', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('renders border stroke elements when voice has a border', () => {
    const svg = createSVG();
    const voice = makeSineVoice({
      border: { color: 'white', double: false, thickness: normalizedCoord(0.5) },
    });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const group = svg.querySelector('g[data-voice-id="v-sine-1"]');
    const borders = group.querySelectorAll('[data-border]');
    expect(borders.length).toBe(1);
    expect(borders[0].getAttribute('stroke')).toBe('white');
    expect(borders[0].getAttribute('fill')).toBe('none');
  });

  test('renders double border with two stroke elements', () => {
    const svg = createSVG();
    const voice = makeSineVoice({
      border: { color: 'black', double: true, thickness: normalizedCoord(0.5) },
    });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const group = svg.querySelector('g[data-voice-id="v-sine-1"]');
    const borders = group.querySelectorAll('[data-border]');
    expect(borders.length).toBe(2);
    expect(borders[0].dataset.border).toBe('outer');
    expect(borders[1].dataset.border).toBe('inner');
  });

  test('no border elements when voice has no border', () => {
    const svg = createSVG();
    const voice = makeSineVoice({ border: undefined });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const group = svg.querySelector('g[data-voice-id="v-sine-1"]');
    const borders = group.querySelectorAll('[data-border]');
    expect(borders.length).toBe(0);
  });

  test('border elements are removed when border is removed from voice', () => {
    const svg = createSVG();
    const voice = makeSineVoice({
      border: { color: 'white', double: false, thickness: normalizedCoord(0.5) },
    });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const group = svg.querySelector('g[data-voice-id="v-sine-1"]');
    expect(group.querySelectorAll('[data-border]').length).toBe(1);

    const updatedVoice = { ...voice, border: undefined };
    const state2 = makeState({ voices: [updatedVoice] });
    render(svg, state2, undefined);

    expect(group.querySelectorAll('[data-border]').length).toBe(0);
  });
});

// ---- Rotation / transform ----

describe('canvas render — rotation', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('sine voice has no transform (no timbre)', () => {
    const svg = createSVG();
    const voice = makeSineVoice();
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const circle = svg.querySelector('g[data-layer="voices"] circle');
    expect(circle.getAttribute('transform')).toBeNull();
  });

  test('pulse voice with timbre > 0 gets a rotation transform', () => {
    const svg = createSVG();
    const voice = makePulseVoice({ timbre: normalizedCoord(0.5) });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const rect = svg.querySelector('g[data-layer="voices"] rect');
    const transform = rect.getAttribute('transform');
    expect(transform).not.toBeNull();
    // Pulse period is 90 degrees, so timbre 0.5 => 45 degrees
    expect(transform).toContain('rotate(45');
  });

  test('blend voice with timbre > 0 gets a rotation transform', () => {
    const svg = createSVG();
    const voice = makeBlendVoice({ timbre: normalizedCoord(0.5) });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const polygon = svg.querySelector('g[data-layer="voices"] polygon');
    const transform = polygon.getAttribute('transform');
    expect(transform).not.toBeNull();
    // Blend period is 120 degrees, so timbre 0.5 => 60 degrees
    expect(transform).toContain('rotate(60');
  });

  test('pulse voice with timbre = 0 has no transform', () => {
    const svg = createSVG();
    const voice = makePulseVoice({ timbre: normalizedCoord(0) });
    const state = makeState({ voices: [voice] });
    render(svg, state, undefined);

    const rect = svg.querySelector('g[data-layer="voices"] rect');
    // timbre 0 => rotation 0 => no transform set
    expect(rect.getAttribute('transform')).toBeNull();
  });
});

// ---- Pattern defs ----

describe('canvas render — pattern defs', () => {
  beforeEach(() => {
    resetCache();
    // Clean up any SVGs from previous tests
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('ensures pattern definitions in defs on first render', () => {
    const svg = createSVG();
    const state = makeState();
    render(svg, state, undefined);

    const defs = svg.querySelector('defs');
    expect(defs.querySelector('#pat-stripes')).not.toBeNull();
    expect(defs.querySelector('#pat-bricks')).not.toBeNull();
    expect(defs.querySelector('#pat-weave')).not.toBeNull();
  });
});

// ---- Solo muting ----

describe('canvas render — solo muting', () => {
  beforeEach(() => {
    resetCache();
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('render applies muted class to non-solo voices', () => {
    const svg = createSVG();
    const state = makeState({
      voices: [makeSineVoice({ id: 'a' }), makePulseVoice({ id: 'b' })],
    });

    // Render with solo on voice 'a'
    render(svg, state, undefined, 'a');

    const groupA = svg.querySelector('g[data-voice-id="a"]');
    const groupB = svg.querySelector('g[data-voice-id="b"]');
    expect(groupA.classList.contains('muted')).toBe(false);
    expect(groupB.classList.contains('muted')).toBe(true);
  });

  test('render removes muted class when solo cleared', () => {
    const svg = createSVG();
    const state = makeState({
      voices: [makeSineVoice({ id: 'a' }), makePulseVoice({ id: 'b' })],
    });

    render(svg, state, undefined, 'a');
    render(svg, state, undefined, undefined);

    const groupA = svg.querySelector('g[data-voice-id="a"]');
    const groupB = svg.querySelector('g[data-voice-id="b"]');
    expect(groupA.classList.contains('muted')).toBe(false);
    expect(groupB.classList.contains('muted')).toBe(false);
  });
});

// ---- DOM order preservation ----

describe('canvas render — DOM order preservation', () => {
  beforeEach(() => {
    resetCache();
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('reconciler does not reorder existing voice groups', () => {
    const svg = createSVG();
    const state = makeState({
      voices: [makeSineVoice({ id: 'a' }), makePulseVoice({ id: 'b' })],
    });

    // Initial render — groups in data order: a, b
    render(svg, state, undefined);
    const voiceLayer = svg.querySelector('g[data-layer="voices"]');
    const groups = () =>
      [...voiceLayer.querySelectorAll('g[data-voice-id]')].map((g) => g.dataset.voiceId);
    expect(groups()).toEqual(['a', 'b']);

    // Manually reorder: move 'b' before 'a' (simulates double-click send-to-back)
    const groupB = voiceLayer.querySelector('g[data-voice-id="b"]');
    voiceLayer.prepend(groupB);
    expect(groups()).toEqual(['b', 'a']); // b is first in DOM now

    // Re-render — reconciler should NOT move groups back to data order
    render(svg, state, undefined);
    expect(groups()).toEqual(['b', 'a']); // order preserved, not reset to data order
  });
});

// ---- resetCache ----

describe('canvas render — resetCache', () => {
  test('resetCache allows using a new SVG root', () => {
    // Clear any cached layers from prior tests
    resetCache();

    const svg1 = createSVG();
    const state = makeState({ voices: [makeSineVoice()] });
    render(svg1, state, undefined);

    // First SVG should have the voice
    expect(svg1.querySelector('g[data-voice-id="v-sine-1"]')).not.toBeNull();

    // Reset cache to work with new SVG
    resetCache();

    const svg2 = createSVG();
    render(svg2, state, undefined);

    // Second SVG should also have the voice
    expect(svg2.querySelector('g[data-voice-id="v-sine-1"]')).not.toBeNull();
  });
});
