import { describe, expect, test } from 'bun:test';
import { SigilStore, UndoManager, createDefaultState } from '../../js/state.ts';

describe('SigilStore CRUD', () => {
  test('starts with default state (empty voices, default envelope)', () => {
    const store = new SigilStore();
    expect(store.data.voices).toHaveLength(0);
    expect(store.data.envelope.attack).toBe(0.1);
  });

  test('addVoice adds a voice', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);

    expect(store.data.voices).toHaveLength(1);
    expect(voice.waveform).toBe('sine');
    expect(voice.x).toBe(0.5);
    expect(voice.y).toBe(0.5);
  });

  test('removeVoice removes a voice', () => {
    const store = new SigilStore();
    const voice = store.addVoice('pulse', 0.3, 0.3);
    store.removeVoice(voice.id);

    expect(store.data.voices).toHaveLength(0);
  });

  test('removeVoice does nothing for nonexistent id', () => {
    const store = new SigilStore();
    store.addVoice('sine', 0.5, 0.5);
    store.removeVoice('nonexistent');
    expect(store.data.voices).toHaveLength(1);
  });

  test('getVoice returns the voice by id', () => {
    const store = new SigilStore();
    const voice = store.addVoice('blend', 0.2, 0.8);
    expect(store.getVoice(voice.id)).toBe(voice);
  });

  test('getVoice returns undefined for nonexistent id', () => {
    const store = new SigilStore();
    expect(store.getVoice('nonexistent')).toBeUndefined();
  });
});

describe('SigilStore updateVoice / updateFill / updateEnvelope', () => {
  test('updateVoice modifies voice properties', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    store.updateVoice(voice.id, { x: 0.8 });

    const updated = store.getVoice(voice.id);
    expect(updated.x).toBe(0.8);
    expect(updated.y).toBe(0.5); // Unchanged
  });

  test('updateVoice can set timbre on pulse voice', () => {
    const store = new SigilStore();
    const voice = store.addVoice('pulse', 0.5, 0.5);
    expect(voice.timbre).toBe(0);
    store.updateVoice(voice.id, { timbre: 0.75 });

    const updated = store.getVoice(voice.id);
    expect(updated.timbre).toBe(0.75);
  });

  test('updateFill replaces the fill entirely', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    store.updateFill(voice.id, {
      gradAngle: 0,
      h: 200,
      h2: 100,
      l: 50,
      l2: 40,
      mode: 'linear',
      s: 80,
      s2: 60,
    });

    const updated = store.getVoice(voice.id);
    expect(updated.fill.mode).toBe('linear');
    expect(updated.fill.h2).toBe(100);
    expect(updated.fill.h).toBe(200);
  });

  test('updateEnvelope modifies envelope', () => {
    const store = new SigilStore();
    store.updateEnvelope({ attack: 1.5, sustain: 0.3 });

    expect(store.data.envelope.attack).toBe(1.5);
    expect(store.data.envelope.sustain).toBe(0.3);
    expect(store.data.envelope.decay).toBe(0.2); // Unchanged
  });
});

describe('UndoManager undo / redo', () => {
  test('undo restores previous state after addVoice', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addVoice('sine', 0.5, 0.5);
    expect(store.data.voices).toHaveLength(1);

    undo.undo();
    expect(store.data.voices).toHaveLength(0);
  });

  test('redo restores undone state', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addVoice('sine', 0.5, 0.5);
    undo.undo();
    undo.redo();

    expect(store.data.voices).toHaveLength(1);
  });

  test('undo after removeVoice restores the voice', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    const voice = store.addVoice('blend', 0.3, 0.7);
    undo.snapshot();
    store.removeVoice(voice.id);
    expect(store.data.voices).toHaveLength(0);

    undo.undo();
    expect(store.data.voices).toHaveLength(1);
    expect(store.data.voices[0].waveform).toBe('blend');
  });

  test('undo does nothing when stack is empty', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.undo(); // Should not throw
    expect(store.data.voices).toHaveLength(0);
  });

  test('redo does nothing when stack is empty', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.redo(); // Should not throw
    expect(store.data.voices).toHaveLength(0);
  });

  test('new snapshot clears redo stack', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addVoice('sine', 0.5, 0.5);
    undo.undo();
    undo.snapshot();
    store.addVoice('pulse', 0.3, 0.3);
    undo.redo(); // Should do nothing since redo stack cleared
    expect(store.data.voices).toHaveLength(1);
    expect(store.data.voices[0].waveform).toBe('pulse');
  });

  test('snapshot + updateVoice supports undo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    const voice = store.addVoice('sine', 0.5, 0.5);
    undo.snapshot();
    store.updateVoice(voice.id, { x: 0.9 });

    expect(store.getVoice(voice.id).x).toBe(0.9);
    undo.undo();
    expect(store.data.voices[0].x).toBe(0.5);
  });
});

describe('SigilStore blend mode', () => {
  test('voices default to screen blend', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    expect(voice.blend).toBe('screen');
  });

  test('updateVoice can change blend mode', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    store.updateVoice(voice.id, { blend: 'multiply' });

    const updated = store.getVoice(voice.id);
    expect(updated.blend).toBe('multiply');
  });

  test('blend mode persists through undo/redo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    const voice = store.addVoice('sine', 0.5, 0.5);
    undo.snapshot();
    store.updateVoice(voice.id, { blend: 'difference' });

    expect(store.getVoice(voice.id).blend).toBe('difference');
    undo.undo();
    expect(store.data.voices[0].blend).toBe('screen');
    undo.redo();
    expect(store.data.voices[0].blend).toBe('difference');
  });
});

describe('SigilStore border', () => {
  test('voices default to null border', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    expect(voice.border).toBeUndefined();
  });

  test('updateVoice can set border', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    store.updateVoice(voice.id, {
      border: { color: 'white', double: false, thickness: 0.5 },
    });

    const updated = store.getVoice(voice.id);
    expect(updated.border).not.toBeUndefined();
    expect(updated.border.color).toBe('white');
    expect(updated.border.double).toBe(false);
    expect(updated.border.thickness).toBe(0.5);
  });

  test('updateVoice can remove border', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    store.updateVoice(voice.id, {
      border: { color: 'black', double: true, thickness: 0.8 },
    });
    store.updateVoice(voice.id, { border: undefined });

    const updated = store.getVoice(voice.id);
    expect(updated.border).toBeUndefined();
  });

  test('border persists through undo/redo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    const voice = store.addVoice('sine', 0.5, 0.5);
    undo.snapshot();
    store.updateVoice(voice.id, {
      border: { color: 'white', double: false, thickness: 0.6 },
    });

    expect(store.getVoice(voice.id).border).not.toBeUndefined();
    undo.undo();
    expect(store.data.voices[0].border).toBeUndefined();
    undo.redo();
    expect(store.data.voices[0].border.color).toBe('white');
    expect(store.data.voices[0].border.thickness).toBe(0.6);
  });
});

describe('SigilStore onChange listener', () => {
  test('listener fires on addVoice', () => {
    const store = new SigilStore();
    let called = false;
    store.onChange(() => {
      called = true;
    });
    store.addVoice('sine', 0.5, 0.5);
    expect(called).toBe(true);
  });

  test('listener fires on updateVoice', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    let callCount = 0;
    store.onChange(() => {
      callCount++;
    });
    store.updateVoice(voice.id, { x: 0.9 });
    expect(callCount).toBe(1);
  });

  test('listener fires on undo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addVoice('sine', 0.5, 0.5);
    let called = false;
    store.onChange(() => {
      called = true;
    });
    undo.undo();
    expect(called).toBe(true);
  });

  test('listener receives current data', () => {
    const store = new SigilStore();
    let receivedData;
    store.onChange((data) => {
      receivedData = data;
    });
    store.addVoice('sine', 0.5, 0.5);
    expect(receivedData).toBe(store.data);
    expect(receivedData.voices).toHaveLength(1);
  });
});

describe('SigilStore signal reactivity', () => {
  test('onChange returns a dispose function that stops notifications', () => {
    const store = new SigilStore();
    let callCount = 0;
    const dispose = store.onChange(() => {
      callCount++;
    });
    store.addVoice('sine', 0.5, 0.5);
    expect(callCount).toBe(1);

    dispose();
    store.addVoice('pulse', 0.3, 0.3);
    expect(callCount).toBe(1); // No additional call after dispose
  });

  test('immutable updates create new state references', () => {
    const store = new SigilStore();
    const dataBefore = store.data;
    store.addVoice('sine', 0.5, 0.5);
    const dataAfter = store.data;

    expect(dataBefore).not.toBe(dataAfter);
    expect(dataBefore.voices).toHaveLength(0);
    expect(dataAfter.voices).toHaveLength(1);
  });

  test('voices array is a new reference after mutation', () => {
    const store = new SigilStore();
    store.addVoice('sine', 0.5, 0.5);
    const voicesBefore = store.data.voices;
    store.addVoice('pulse', 0.3, 0.3);
    const voicesAfter = store.data.voices;

    expect(voicesBefore).not.toBe(voicesAfter);
    expect(voicesBefore).toHaveLength(1);
    expect(voicesAfter).toHaveLength(2);
  });

  test('updateVoice creates new voice reference but preserves other voices', () => {
    const store = new SigilStore();
    const v1 = store.addVoice('sine', 0.1, 0.1);
    const v2 = store.addVoice('pulse', 0.5, 0.5);
    store.updateVoice(v1.id, { x: 0.9 });

    // Updated voice is a new object
    const updatedV1 = store.getVoice(v1.id);
    expect(updatedV1.x).toBe(0.9);

    // Other voice is the same reference (not copied unnecessarily)
    const sameV2 = store.getVoice(v2.id);
    expect(sameV2).toBe(v2);
  });

  test('UndoManager snapshot captures immutable state without structuredClone', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    store.addVoice('sine', 0.5, 0.5);
    const stateBeforeUpdate = store.data;

    undo.snapshot();
    store.updateVoice(store.data.voices[0].id, { x: 0.9 });

    // The snapshot should be the exact reference we captured
    expect(undo.undoStack[0]).toBe(stateBeforeUpdate);

    undo.undo();
    expect(store.data).toBe(stateBeforeUpdate);
    expect(store.data.voices[0].x).toBe(0.5);
  });
});

describe('SigilStore loadState', () => {
  test('loadState replaces data', () => {
    const store = new SigilStore();
    store.addVoice('sine', 0.5, 0.5);
    store.addVoice('pulse', 0.3, 0.3);

    const newData = createDefaultState();
    store.loadState(newData);

    expect(store.data.voices).toHaveLength(0);
  });

  test('UndoManager reset clears undo/redo stacks', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addVoice('sine', 0.5, 0.5);

    store.loadState(createDefaultState());
    undo.reset();

    expect(undo.undoStack).toHaveLength(0);
    expect(undo.redoStack).toHaveLength(0);
  });
});

describe('SigilStore scene', () => {
  test('default state has scene 0', () => {
    const store = new SigilStore();
    expect(store.data.scene).toBe(0);
  });

  test('updateScene sets scene index', () => {
    const store = new SigilStore();
    store.updateScene(3);
    expect(store.data.scene).toBe(3);
  });

  test('updateScene notifies listeners', () => {
    const store = new SigilStore();
    let called = false;
    store.onChange(() => {
      called = true;
    });
    store.updateScene(2);
    expect(called).toBe(true);
  });

  test('scene persists through undo/redo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.updateScene(5);

    expect(store.data.scene).toBe(5);
    undo.undo();
    expect(store.data.scene).toBe(0);
    undo.redo();
    expect(store.data.scene).toBe(5);
  });
});
