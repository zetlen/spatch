import { describe, expect, test } from 'bun:test';
import { effect } from '@preact/signals-core';
import { SigilStore, SelectionManager } from '../../js/state.ts';

describe('SelectionManager select and clear', () => {
  test('select voice sets voiceId', () => {
    const store = new SigilStore();
    const sel = new SelectionManager(store);

    sel.select('v1');
    expect(sel.voiceId).toBe('v1');
  });

  test('selecting a different voice replaces the previous selection', () => {
    const store = new SigilStore();
    const sel = new SelectionManager(store);

    sel.select('v1');
    expect(sel.voiceId).toBe('v1');

    sel.select('v2');
    expect(sel.voiceId).toBe('v2');
  });

  test('clear sets voiceId to undefined', () => {
    const store = new SigilStore();
    const sel = new SelectionManager(store);

    sel.select('v1');
    sel.clear();
    expect(sel.voiceId).toBeUndefined();
  });

  test('select with undefined clears the selection', () => {
    const store = new SigilStore();
    const sel = new SelectionManager(store);

    sel.select('v1');
    sel.select(undefined);
    expect(sel.voiceId).toBeUndefined();
  });
});

describe('SelectionManager getSelectedVoice', () => {
  test('getSelectedVoice returns the Voice object from the store', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    const sel = new SelectionManager(store);

    sel.select(voice.id);
    const selected = sel.getSelectedVoice();
    expect(selected).toBeDefined();
    expect(selected.id).toBe(voice.id);
    expect(selected.waveform).toBe('sine');
  });

  test('getSelectedVoice returns undefined when no voice is selected', () => {
    const store = new SigilStore();
    const sel = new SelectionManager(store);

    expect(sel.getSelectedVoice()).toBeUndefined();
  });

  test('getSelectedVoice returns undefined when selected voice was deleted', () => {
    const store = new SigilStore();
    const voice = store.addVoice('pulse', 0.3, 0.3);
    const sel = new SelectionManager(store);

    sel.select(voice.id);
    expect(sel.getSelectedVoice()).toBeDefined();

    store.removeVoice(voice.id);
    expect(sel.getSelectedVoice()).toBeUndefined();
    // VoiceId is still set, but the voice no longer exists in the store
    expect(sel.voiceId).toBe(voice.id);
  });
});

describe('SelectionManager signal reactivity', () => {
  test('effect fires when voice selection changes', () => {
    const store = new SigilStore();
    const sel = new SelectionManager(store);

    const observed = [];
    const dispose = effect(() => {
      observed.push(sel.voiceId);
    });

    sel.select('v1');
    sel.select('v2');
    sel.clear();

    expect(observed).toEqual([undefined, 'v1', 'v2', undefined]);
    dispose();
  });

  test('effect stops firing after dispose', () => {
    const store = new SigilStore();
    const sel = new SelectionManager(store);

    let callCount = 0;
    const dispose = effect(() => {
      void sel.voiceId; // Subscribe to the signal
      callCount++;
    });

    expect(callCount).toBe(1); // Initial effect run
    sel.select('v1');
    expect(callCount).toBe(2);

    dispose();
    sel.select('v2');
    expect(callCount).toBe(2); // No additional call after dispose
  });
});
