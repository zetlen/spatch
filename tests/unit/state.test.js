import { describe, test, expect } from 'bun:test';
import { SigilState, createDefaultState } from '../../js/state.js';

describe('SigilState CRUD', () => {
  test('starts with default state (empty shapes, default envelope)', () => {
    const state = new SigilState();
    expect(state.data.shapes).toHaveLength(0);
    expect(state.data.decorations).toHaveLength(0);
    expect(state.data.envelope.attack).toBe(0.1);
  });

  test('addShape adds a shape and selects it', () => {
    const state = new SigilState();
    const shape = state.addShape('circle', 0.5, 0.5);

    expect(state.data.shapes).toHaveLength(1);
    expect(shape.type).toBe('circle');
    expect(shape.x).toBe(0.5);
    expect(shape.y).toBe(0.5);
    expect(state.selectedId).toBe(shape.id);
  });

  test('removeShape removes a shape and clears selection', () => {
    const state = new SigilState();
    const shape = state.addShape('square', 0.3, 0.3);
    state.removeShape(shape.id);

    expect(state.data.shapes).toHaveLength(0);
    expect(state.selectedId).toBeNull();
  });

  test('removeShape does nothing for nonexistent id', () => {
    const state = new SigilState();
    state.addShape('circle', 0.5, 0.5);
    state.removeShape('nonexistent');
    expect(state.data.shapes).toHaveLength(1);
  });

  test('getShape returns the shape by id', () => {
    const state = new SigilState();
    const shape = state.addShape('triangle', 0.2, 0.8);
    expect(state.getShape(shape.id)).toBe(shape);
  });

  test('getShape returns undefined for nonexistent id', () => {
    const state = new SigilState();
    expect(state.getShape('nonexistent')).toBeUndefined();
  });

  test('getSelected returns the selected shape', () => {
    const state = new SigilState();
    const shape = state.addShape('circle', 0.5, 0.5);
    expect(state.getSelected()).toBe(shape);
  });

  test('getSelected returns null when nothing selected', () => {
    const state = new SigilState();
    expect(state.getSelected()).toBeNull();
  });
});

describe('SigilState updateShape / updateFill / updateEnvelope', () => {
  test('updateShape modifies shape properties', () => {
    const state = new SigilState();
    const shape = state.addShape('circle', 0.5, 0.5);
    state.updateShape(shape.id, { x: 0.8, rotation: 45 });

    const updated = state.getShape(shape.id);
    expect(updated.x).toBe(0.8);
    expect(updated.rotation).toBe(45);
    expect(updated.y).toBe(0.5); // unchanged
  });

  test('updateFill modifies fill properties', () => {
    const state = new SigilState();
    const shape = state.addShape('circle', 0.5, 0.5);
    state.updateFill(shape.id, { mode: 'radial', labL: 80 });

    const updated = state.getShape(shape.id);
    expect(updated.fill.mode).toBe('radial');
    expect(updated.fill.labL).toBe(80);
    expect(updated.fill.h).toBe(200); // unchanged
  });

  test('updateEnvelope modifies envelope', () => {
    const state = new SigilState();
    state.updateEnvelope({ attack: 1.5, sustain: 0.3 });

    expect(state.data.envelope.attack).toBe(1.5);
    expect(state.data.envelope.sustain).toBe(0.3);
    expect(state.data.envelope.decay).toBe(0.2); // unchanged
  });
});

describe('SigilState undo / redo', () => {
  test('undo restores previous state after addShape', () => {
    const state = new SigilState();
    state.addShape('circle', 0.5, 0.5);
    expect(state.data.shapes).toHaveLength(1);

    state.undo();
    expect(state.data.shapes).toHaveLength(0);
  });

  test('redo restores undone state', () => {
    const state = new SigilState();
    state.addShape('circle', 0.5, 0.5);
    state.undo();
    state.redo();

    expect(state.data.shapes).toHaveLength(1);
  });

  test('undo after removeShape restores the shape', () => {
    const state = new SigilState();
    const shape = state.addShape('triangle', 0.3, 0.7);
    state.removeShape(shape.id);
    expect(state.data.shapes).toHaveLength(0);

    state.undo();
    expect(state.data.shapes).toHaveLength(1);
    expect(state.data.shapes[0].type).toBe('triangle');
  });

  test('undo does nothing when stack is empty', () => {
    const state = new SigilState();
    state.undo(); // should not throw
    expect(state.data.shapes).toHaveLength(0);
  });

  test('redo does nothing when stack is empty', () => {
    const state = new SigilState();
    state.redo(); // should not throw
    expect(state.data.shapes).toHaveLength(0);
  });

  test('new mutation clears redo stack', () => {
    const state = new SigilState();
    state.addShape('circle', 0.5, 0.5);
    state.undo();
    state.addShape('square', 0.3, 0.3);
    state.redo(); // should do nothing since redo stack cleared
    expect(state.data.shapes).toHaveLength(1);
    expect(state.data.shapes[0].type).toBe('square');
  });

  test('updateShapeWithUndo supports undo', () => {
    const state = new SigilState();
    const shape = state.addShape('circle', 0.5, 0.5);
    state.updateShapeWithUndo(shape.id, { x: 0.9 });

    expect(state.getShape(shape.id).x).toBe(0.9);
    state.undo();
    expect(state.data.shapes[0].x).toBe(0.5);
  });
});

describe('SigilState layer ordering', () => {
  test('moveLayer moves shape up by +1', () => {
    const state = new SigilState();
    const a = state.addShape('circle', 0.1, 0.1);
    const b = state.addShape('square', 0.5, 0.5);

    state.moveLayer(a.id, 1);
    expect(state.data.shapes[0].id).toBe(b.id);
    expect(state.data.shapes[1].id).toBe(a.id);
  });

  test('moveLayer does nothing at boundary', () => {
    const state = new SigilState();
    const a = state.addShape('circle', 0.1, 0.1);
    state.addShape('square', 0.5, 0.5);

    state.moveLayer(a.id, -1); // already at bottom
    expect(state.data.shapes[0].id).toBe(a.id);
  });

  test('bringToFront moves shape to last position', () => {
    const state = new SigilState();
    const a = state.addShape('circle', 0.1, 0.1);
    state.addShape('square', 0.5, 0.5);
    state.addShape('triangle', 0.9, 0.9);

    state.bringToFront(a.id);
    expect(state.data.shapes[2].id).toBe(a.id);
  });

  test('bringToFront does nothing if already at front', () => {
    const state = new SigilState();
    state.addShape('circle', 0.1, 0.1);
    const b = state.addShape('square', 0.5, 0.5);

    state.bringToFront(b.id); // already last
    expect(state.data.shapes[1].id).toBe(b.id);
  });

  test('sendToBack moves shape to first position', () => {
    const state = new SigilState();
    state.addShape('circle', 0.1, 0.1);
    state.addShape('square', 0.5, 0.5);
    const c = state.addShape('triangle', 0.9, 0.9);

    state.sendToBack(c.id);
    expect(state.data.shapes[0].id).toBe(c.id);
  });

  test('sendToBack does nothing if already at back', () => {
    const state = new SigilState();
    const a = state.addShape('circle', 0.1, 0.1);
    state.addShape('square', 0.5, 0.5);

    state.sendToBack(a.id); // already first
    expect(state.data.shapes[0].id).toBe(a.id);
  });
});

describe('SigilState onChange listener', () => {
  test('listener fires on addShape', () => {
    const state = new SigilState();
    let called = false;
    state.onChange(() => {
      called = true;
    });
    state.addShape('circle', 0.5, 0.5);
    expect(called).toBe(true);
  });

  test('listener fires on updateShape', () => {
    const state = new SigilState();
    const shape = state.addShape('circle', 0.5, 0.5);
    let callCount = 0;
    state.onChange(() => {
      callCount++;
    });
    state.updateShape(shape.id, { x: 0.9 });
    expect(callCount).toBe(1);
  });

  test('listener fires on undo', () => {
    const state = new SigilState();
    state.addShape('circle', 0.5, 0.5);
    let called = false;
    state.onChange(() => {
      called = true;
    });
    state.undo();
    expect(called).toBe(true);
  });

  test('listener receives current data', () => {
    const state = new SigilState();
    let receivedData = null;
    state.onChange((data) => {
      receivedData = data;
    });
    state.addShape('circle', 0.5, 0.5);
    expect(receivedData).toBe(state.data);
    expect(receivedData.shapes).toHaveLength(1);
  });
});

describe('SigilState decorations', () => {
  test('addDecoration adds and notifies', () => {
    const state = new SigilState();
    let notified = false;
    state.onChange(() => {
      notified = true;
    });
    const deco = state.addDecoration(
      'squiggle',
      [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      '#ff0',
    );
    expect(state.data.decorations).toHaveLength(1);
    expect(deco.type).toBe('squiggle');
    expect(deco.points).toHaveLength(2);
    expect(notified).toBe(true);
  });

  test('removeDecoration removes and notifies', () => {
    const state = new SigilState();
    const deco = state.addDecoration('text', [], '#fff');
    let notified = false;
    state.onChange(() => {
      notified = true;
    });
    state.removeDecoration(deco.id);
    expect(state.data.decorations).toHaveLength(0);
    expect(notified).toBe(true);
  });
});

describe('SigilState loadState', () => {
  test('loadState replaces data and clears undo/redo', () => {
    const state = new SigilState();
    state.addShape('circle', 0.5, 0.5);
    state.addShape('square', 0.3, 0.3);

    const newData = createDefaultState();
    state.loadState(newData);

    expect(state.data.shapes).toHaveLength(0);
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
    expect(state.selectedId).toBeNull();
  });
});
