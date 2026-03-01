import { describe, test, expect } from 'bun:test';
import { SigilStore, UndoManager, createDefaultState } from '../../js/state.ts';

describe('SigilStore CRUD', () => {
  test('starts with default state (empty shapes, default envelope)', () => {
    const store = new SigilStore();
    expect(store.data.shapes).toHaveLength(0);
    expect(store.data.decorations).toHaveLength(0);
    expect(store.data.envelope.attack).toBe(0.1);
  });

  test('addShape adds a shape', () => {
    const store = new SigilStore();
    const shape = store.addShape('circle', 0.5, 0.5);

    expect(store.data.shapes).toHaveLength(1);
    expect(shape.type).toBe('circle');
    expect(shape.x).toBe(0.5);
    expect(shape.y).toBe(0.5);
  });

  test('removeShape removes a shape', () => {
    const store = new SigilStore();
    const shape = store.addShape('square', 0.3, 0.3);
    store.removeShape(shape.id);

    expect(store.data.shapes).toHaveLength(0);
  });

  test('removeShape does nothing for nonexistent id', () => {
    const store = new SigilStore();
    store.addShape('circle', 0.5, 0.5);
    store.removeShape('nonexistent');
    expect(store.data.shapes).toHaveLength(1);
  });

  test('getShape returns the shape by id', () => {
    const store = new SigilStore();
    const shape = store.addShape('triangle', 0.2, 0.8);
    expect(store.getShape(shape.id)).toBe(shape);
  });

  test('getShape returns undefined for nonexistent id', () => {
    const store = new SigilStore();
    expect(store.getShape('nonexistent')).toBeUndefined();
  });
});

describe('SigilStore updateShape / updateFill / updateEnvelope', () => {
  test('updateShape modifies shape properties', () => {
    const store = new SigilStore();
    const shape = store.addShape('circle', 0.5, 0.5);
    store.updateShape(shape.id, { x: 0.8, rotation: 45 });

    const updated = store.getShape(shape.id);
    expect(updated.x).toBe(0.8);
    expect(updated.rotation).toBe(45);
    expect(updated.y).toBe(0.5); // unchanged
  });

  test('updateFill replaces the fill entirely', () => {
    const store = new SigilStore();
    const shape = store.addShape('circle', 0.5, 0.5);
    store.updateFill(shape.id, { mode: 'radial', h: 200, s: 80, l: 50, h2: 100, s2: 60, l2: 40 });

    const updated = store.getShape(shape.id);
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
  test('undo restores previous state after addShape', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addShape('circle', 0.5, 0.5);
    expect(store.data.shapes).toHaveLength(1);

    undo.undo();
    expect(store.data.shapes).toHaveLength(0);
  });

  test('redo restores undone state', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addShape('circle', 0.5, 0.5);
    undo.undo();
    undo.redo();

    expect(store.data.shapes).toHaveLength(1);
  });

  test('undo after removeShape restores the shape', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    const shape = store.addShape('triangle', 0.3, 0.7);
    undo.snapshot();
    store.removeShape(shape.id);
    expect(store.data.shapes).toHaveLength(0);

    undo.undo();
    expect(store.data.shapes).toHaveLength(1);
    expect(store.data.shapes[0].type).toBe('triangle');
  });

  test('undo does nothing when stack is empty', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.undo(); // should not throw
    expect(store.data.shapes).toHaveLength(0);
  });

  test('redo does nothing when stack is empty', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.redo(); // should not throw
    expect(store.data.shapes).toHaveLength(0);
  });

  test('new snapshot clears redo stack', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addShape('circle', 0.5, 0.5);
    undo.undo();
    undo.snapshot();
    store.addShape('square', 0.3, 0.3);
    undo.redo(); // should do nothing since redo stack cleared
    expect(store.data.shapes).toHaveLength(1);
    expect(store.data.shapes[0].type).toBe('square');
  });

  test('snapshot + updateShape supports undo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    const shape = store.addShape('circle', 0.5, 0.5);
    undo.snapshot();
    store.updateShape(shape.id, { x: 0.9 });

    expect(store.getShape(shape.id).x).toBe(0.9);
    undo.undo();
    expect(store.data.shapes[0].x).toBe(0.5);
  });
});

describe('SigilStore layer ordering', () => {
  test('moveLayer moves shape up by +1', () => {
    const store = new SigilStore();
    const a = store.addShape('circle', 0.1, 0.1);
    const b = store.addShape('square', 0.5, 0.5);

    store.moveLayer(a.id, 1);
    expect(store.data.shapes[0].id).toBe(b.id);
    expect(store.data.shapes[1].id).toBe(a.id);
  });

  test('moveLayer does nothing at boundary', () => {
    const store = new SigilStore();
    const a = store.addShape('circle', 0.1, 0.1);
    store.addShape('square', 0.5, 0.5);

    store.moveLayer(a.id, -1); // already at bottom
    expect(store.data.shapes[0].id).toBe(a.id);
  });

  test('bringToFront moves shape to last position', () => {
    const store = new SigilStore();
    const a = store.addShape('circle', 0.1, 0.1);
    store.addShape('square', 0.5, 0.5);
    store.addShape('triangle', 0.9, 0.9);

    store.bringToFront(a.id);
    expect(store.data.shapes[2].id).toBe(a.id);
  });

  test('bringToFront does nothing if already at front', () => {
    const store = new SigilStore();
    store.addShape('circle', 0.1, 0.1);
    const b = store.addShape('square', 0.5, 0.5);

    store.bringToFront(b.id); // already last
    expect(store.data.shapes[1].id).toBe(b.id);
  });

  test('sendToBack moves shape to first position', () => {
    const store = new SigilStore();
    store.addShape('circle', 0.1, 0.1);
    store.addShape('square', 0.5, 0.5);
    const c = store.addShape('triangle', 0.9, 0.9);

    store.sendToBack(c.id);
    expect(store.data.shapes[0].id).toBe(c.id);
  });

  test('sendToBack does nothing if already at back', () => {
    const store = new SigilStore();
    const a = store.addShape('circle', 0.1, 0.1);
    store.addShape('square', 0.5, 0.5);

    store.sendToBack(a.id); // already first
    expect(store.data.shapes[0].id).toBe(a.id);
  });
});

describe('SigilStore onChange listener', () => {
  test('listener fires on addShape', () => {
    const store = new SigilStore();
    let called = false;
    store.onChange(() => {
      called = true;
    });
    store.addShape('circle', 0.5, 0.5);
    expect(called).toBe(true);
  });

  test('listener fires on updateShape', () => {
    const store = new SigilStore();
    const shape = store.addShape('circle', 0.5, 0.5);
    let callCount = 0;
    store.onChange(() => {
      callCount++;
    });
    store.updateShape(shape.id, { x: 0.9 });
    expect(callCount).toBe(1);
  });

  test('listener fires on undo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addShape('circle', 0.5, 0.5);
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
    store.addShape('circle', 0.5, 0.5);
    expect(receivedData).toBe(store.data);
    expect(receivedData.shapes).toHaveLength(1);
  });
});

describe('SigilStore decorations', () => {
  test('addSquiggle adds and notifies', () => {
    const store = new SigilStore();
    let notified = false;
    store.onChange(() => {
      notified = true;
    });
    const deco = store.addSquiggle(
      [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      '#ff0',
    );
    expect(store.data.decorations).toHaveLength(1);
    expect(deco.type).toBe('squiggle');
    expect(deco.points).toHaveLength(2);
    expect(notified).toBe(true);
  });

  test('removeDecoration removes and notifies', () => {
    const store = new SigilStore();
    const deco = store.addTextDeco('Hello', 0.5, 0.5, '#fff');
    let notified = false;
    store.onChange(() => {
      notified = true;
    });
    store.removeDecoration(deco.id);
    expect(store.data.decorations).toHaveLength(0);
    expect(notified).toBe(true);
  });
});

describe('SigilStore loadState', () => {
  test('loadState replaces data', () => {
    const store = new SigilStore();
    store.addShape('circle', 0.5, 0.5);
    store.addShape('square', 0.3, 0.3);

    const newData = createDefaultState();
    store.loadState(newData);

    expect(store.data.shapes).toHaveLength(0);
  });

  test('UndoManager reset clears undo/redo stacks', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.addShape('circle', 0.5, 0.5);

    store.loadState(createDefaultState());
    undo.reset();

    expect(undo.undoStack).toHaveLength(0);
    expect(undo.redoStack).toHaveLength(0);
  });
});
