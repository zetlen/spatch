// decorations.ts — Text decoration placement tool (text-only, squiggle/curlicue removed)

import type { SigilStore, UndoManager } from './state.ts';
import type { NormalizedCoord } from './types.ts';

export class DecorationTool {
  store: SigilStore;
  undo: UndoManager;
  currentTool: string | null;

  constructor(store: SigilStore, undo: UndoManager) {
    this.store = store;
    this.undo = undo;
    this.currentTool = null;
  }

  setTool(tool: string | null): void {
    this.currentTool = tool;
  }

  handleMouseDown(nx: NormalizedCoord, ny: NormalizedCoord): { placed: string } | null {
    if (this.currentTool !== 'text') return null;
    const text = (document.getElementById('text-input') as HTMLInputElement).value.trim();
    if (!text) return null;
    this.undo.snapshot();
    const deco = this.store.addTextDeco(text, nx, ny);
    return { placed: deco.id };
  }
}
