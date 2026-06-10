import { describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../js/audio/engine.ts';

// _handleStateChange is the response to OS-level interruptions (system
// sleep/wake, Bluetooth handoff, phone calls). iOS won't honor resume()
// from outside a user gesture for the 'interrupted' state, so we stop
// cleanly instead and rely on the next user-initiated play() to recover.

function makeRecordingCtx(initialState = 'running') {
  return {
    resumeCalls: 0,
    resume() {
      this.resumeCalls++;
      return Promise.resolve();
    },
    state: initialState,
  };
}

describe('AudioEngine._handleStateChange', () => {
  test('interrupted while playing calls stop() and fires onInterrupted', () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('interrupted');
    engine.audioCtx = ctx;
    engine.isPlaying = true;
    let callbackFired = false;
    engine.onInterrupted = () => {
      callbackFired = true;
    };

    engine._handleStateChange();

    expect(engine.isPlaying).toBe(false);
    expect(callbackFired).toBe(true);
    expect(ctx.resumeCalls).toBe(0);
  });

  test('interrupted while NOT playing fires onInterrupted but stop() is a no-op', () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('interrupted');
    engine.audioCtx = ctx;
    engine.isPlaying = false;
    let callbackFired = false;
    engine.onInterrupted = () => {
      callbackFired = true;
    };

    engine._handleStateChange();

    expect(engine.isPlaying).toBe(false);
    expect(callbackFired).toBe(true);
    expect(ctx.resumeCalls).toBe(0);
  });

  test('running state does NOT call stop() or fire onInterrupted', () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('running');
    engine.audioCtx = ctx;
    engine.isPlaying = true;
    let callbackFired = false;
    engine.onInterrupted = () => {
      callbackFired = true;
    };

    engine._handleStateChange();

    expect(engine.isPlaying).toBe(true);
    expect(callbackFired).toBe(false);
  });

  test('suspended state does NOT fire onInterrupted (handled by visibilitychange)', () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('suspended');
    engine.audioCtx = ctx;
    engine.isPlaying = true;
    let callbackFired = false;
    engine.onInterrupted = () => {
      callbackFired = true;
    };

    engine._handleStateChange();

    expect(callbackFired).toBe(false);
  });

  test('handles missing audioCtx gracefully', () => {
    const engine = new AudioEngine();
    engine.audioCtx = undefined;
    engine.isPlaying = true;

    expect(() => engine._handleStateChange()).not.toThrow();
  });

  test('handles missing onInterrupted callback gracefully', () => {
    const engine = new AudioEngine();
    const ctx = makeRecordingCtx('interrupted');
    engine.audioCtx = ctx;
    engine.isPlaying = false;
    engine.onInterrupted = undefined;

    expect(() => engine._handleStateChange()).not.toThrow();
  });
});
