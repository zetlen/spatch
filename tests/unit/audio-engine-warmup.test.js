import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../js/audio/engine.ts';

// warmUp() is the entry point for qualifying gestures (touchend, click,
// keydown). _init() early-returns when the AudioContext already exists, so a
// context first created in a NON-qualifying event (play-button pointerdown,
// embed postMessage) would never be resumed — iOS Safari only honors
// resume() from qualifying gestures. Regression test for the silent-app
// chain: gesture handlers must resume an existing non-running context.

function makeRecordingCtx(initialState, resumeImpl) {
  return {
    resumeCalls: 0,
    resume() {
      this.resumeCalls++;
      return resumeImpl ? resumeImpl() : Promise.resolve();
    },
    state: initialState,
  };
}

describe('AudioEngine.warmUp — existing context', () => {
  test('resumes a suspended context', () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('suspended');
    engine.audioCtx = ctx;

    engine.warmUp();

    expect(ctx.resumeCalls).toBe(1);
  });

  test("resumes an 'interrupted' context (iOS OS-level takeover)", () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('interrupted');
    engine.audioCtx = ctx;

    engine.warmUp();

    expect(ctx.resumeCalls).toBe(1);
  });

  test('does not resume a running context', () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('running');
    engine.audioCtx = ctx;

    engine.warmUp();

    expect(ctx.resumeCalls).toBe(0);
  });

  test('swallows resume() rejection (embed postMessage without activation)', async () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('suspended', () => Promise.reject(new Error('NotAllowedError')));
    engine.audioCtx = ctx;

    expect(() => engine.warmUp()).not.toThrow();
    expect(ctx.resumeCalls).toBe(1);
    // Let the rejected promise settle — an unhandled rejection here would
    // fail the test run.
    await Promise.resolve();
  });
});
