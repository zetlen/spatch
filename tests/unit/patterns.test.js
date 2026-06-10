import { describe, expect, test } from 'bun:test';
import { createEffect, getPatternFill, getPatternPreviewCSS } from '../../js/patterns.ts';
import { createStubAudioContext } from './helpers/web-audio-stubs.js';
import { PATTERN_TYPES } from '../../js/types.ts';

describe('getPatternFill', () => {
  test('every pattern type returns a fill URL', () => {
    for (const p of PATTERN_TYPES) {
      expect(getPatternFill(p)).toBe(`url(#pat-${p})`);
    }
  });
});

describe('getPatternPreviewCSS', () => {
  test('every pattern returns a non-empty data URI', () => {
    for (const p of PATTERN_TYPES) {
      const css = getPatternPreviewCSS(p);
      expect(css).toContain('data:image/svg+xml');
    }
  });
});

describe('PATTERN_TYPES', () => {
  test('has exactly 7 entries (3-bit serialization budget)', () => {
    expect(PATTERN_TYPES).toHaveLength(7);
  });
});

// Instrument the Web Audio stub constructors to track stop/connect/disconnect
function instrument() {
  const oscs = [];
  const OrigOsc = globalThis.OscillatorNode;
  const OrigGain = globalThis.GainNode;
  globalThis.OscillatorNode = function (ctx, opts) {
    const node = new OrigOsc(ctx, opts);
    node.__stopped = false;
    node.__disconnected = false;
    node.__targets = [];
    const origStop = node.stop;
    const origConnect = node.connect;
    const origDisconnect = node.disconnect;
    node.stop = (...a) => {
      node.__stopped = true;
      return origStop?.apply(node, a);
    };
    node.connect = (target, ...a) => {
      node.__targets.push(target);
      return origConnect?.apply(node, [target, ...a]);
    };
    node.disconnect = (...a) => {
      node.__disconnected = true;
      return origDisconnect?.apply(node, a);
    };
    oscs.push(node);
    return node;
  };
  globalThis.GainNode = function (ctx, opts) {
    const node = new OrigGain(ctx, opts);
    node.__disconnected = false;
    const origDisconnect = node.disconnect;
    node.disconnect = (...a) => {
      node.__disconnected = true;
      return origDisconnect?.apply(node, a);
    };
    return node;
  };
  return () => {
    globalThis.OscillatorNode = OrigOsc;
    globalThis.GainNode = OrigGain;
  };
}

describe('effect dispose disconnects modulation sources', () => {
  for (const pattern of PATTERN_TYPES) {
    test(`${pattern}: dispose stops and disconnects every LFO and its gain`, () => {
      const restore = instrument();
      try {
        const oscs = [];
        const TrackOsc = globalThis.OscillatorNode;
        globalThis.OscillatorNode = function (ctx, opts) {
          const node = new TrackOsc(ctx, opts);
          oscs.push(node);
          return node;
        };
        const effect = createEffect(createStubAudioContext(), pattern);
        expect(effect).toBeDefined();
        effect.dispose();
        // Every oscillator an effect creates is an LFO. After dispose it must
        // be stopped and disconnected, and so must every gain it drives.
        for (const osc of oscs) {
          expect(osc.__stopped).toBe(true);
          expect(osc.__disconnected).toBe(true);
          for (const target of osc.__targets) {
            expect(target.__disconnected).toBe(true);
          }
        }
      } finally {
        restore();
      }
    });
  }
});
