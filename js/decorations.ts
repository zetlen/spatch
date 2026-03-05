// Decorations.ts — Text decoration placement tool (text-only, squiggle/curlicue removed)

import { qel } from './dom.ts';
import type { SigilStore, UndoManager } from './state.ts';
import type { NormalizedCoord } from './types.ts';

export class DecorationTool {
  store: SigilStore;
  undo: UndoManager;
  currentTool: string | undefined;

  constructor(store: SigilStore, undo: UndoManager) {
    this.store = store;
    this.undo = undo;
    this.currentTool = undefined;
  }

  setTool(tool: string | undefined): void {
    this.currentTool = tool;
  }

  handleMouseDown(nx: NormalizedCoord, ny: NormalizedCoord): { placed: string } | undefined {
    if (this.currentTool !== 'text') {
      return;
    }
    const text = qel<HTMLInputElement>('#text-input').value.trim();
    if (!text) {
      return;
    }
    this.undo.snapshot();
    const deco = this.store.addTextDeco(text, nx, ny);
    return { placed: deco.id };
  }
}
