import { describe, test, expect } from 'bun:test';
import { SigilStore, UndoManager, createDefaultState } from '../../js/state.ts';

describe('SigilStore CRUD', () => {
  test('starts with default state (empty voices, default envelope)', () => {
    const store = new SigilStore();
    expect(store.data.voices).toHaveLength(0);
    expect(store.data.texts).toHaveLength(0);
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
    expect(updated.y).toBe(0.5); // unchanged
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
    store.updateFill(voice.id, { mode: 'radial', h: 200, s: 80, l: 50, h2: 100, s2: 60, l2: 40 });

    const updated = store.getVoice(voice.id);
    expect(updated.fill.mode).toBe('radial');
    expect(updated.fill.h2).toBe(100);
    expect(updated.fill.h).toBe(200);
  });

  test('updateEnvelope modifies envelope', () => {
    const store = new SigilStore();
    store.updateEnvelope({ attack: 1.5, sustain: 0.3 });

    expect(store.data.envelope.attack).toBe(1.5);
    expect(store.data.envelope.sustain).toBe(0.3);
    expect(store.data.envelope.decay).toBe(0.2); // unchanged
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
    undo.undo(); // should not throw
    expect(store.data.voices).toHaveLength(0);
  });

  test('redo does nothing when stack is empty', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.redo(); // should not throw
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
    undo.redo(); // should do nothing since redo stack cleared
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
  test('voices default to soft-light blend', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    expect(voice.blend).toBe('soft-light');
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
    expect(store.data.voices[0].blend).toBe('soft-light');
    undo.redo();
    expect(store.data.voices[0].blend).toBe('difference');
  });
});

describe('SigilStore border', () => {
  test('voices default to null border', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    expect(voice.border).toBeNull();
  });

  test('updateVoice can set border', () => {
    const store = new SigilStore();
    const voice = store.addVoice('sine', 0.5, 0.5);
    store.updateVoice(voice.id, {
      border: { color: 'white', double: false, thickness: 0.5 },
    });

    const updated = store.getVoice(voice.id);
    expect(updated.border).not.toBeNull();
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
    store.updateVoice(voice.id, { border: null });

    const updated = store.getVoice(voice.id);
    expect(updated.border).toBeNull();
  });

  test('border persists through undo/redo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    const voice = store.addVoice('sine', 0.5, 0.5);
    undo.snapshot();
    store.updateVoice(voice.id, {
      border: { color: 'white', double: false, thickness: 0.6 },
    });

    expect(store.getVoice(voice.id).border).not.toBeNull();
    undo.undo();
    expect(store.data.voices[0].border).toBeNull();
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
    let receivedData = null;
    store.onChange((data) => {
      receivedData = data;
    });
    store.addVoice('sine', 0.5, 0.5);
    expect(receivedData).toBe(store.data);
    expect(receivedData.voices).toHaveLength(1);
  });
});

describe('SigilStore text decorations', () => {
  test('addTextDeco adds and notifies', () => {
    const store = new SigilStore();
    let notified = false;
    store.onChange(() => {
      notified = true;
    });
    const deco = store.addTextDeco('Hello', 0.5, 0.5);
    expect(store.data.texts).toHaveLength(1);
    expect(deco.text).toBe('Hello');
    expect(notified).toBe(true);
  });

  test('removeText removes and notifies', () => {
    const store = new SigilStore();
    const deco = store.addTextDeco('Hello', 0.5, 0.5);
    let notified = false;
    store.onChange(() => {
      notified = true;
    });
    store.removeText(deco.id);
    expect(store.data.texts).toHaveLength(0);
    expect(notified).toBe(true);
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
