// decorations.ts — Squiggle drawing, curlicue placement, text vocoder decoration

import type { SigilStore, UndoManager } from './state.ts';
import type { NormalizedCoord } from './types.ts';

export class DecorationTool {
  store: SigilStore;
  undo: UndoManager;
  canvas: HTMLCanvasElement;
  canvasSize: number;
  isDrawing: boolean;
  currentPoints: [number, number][];
  currentTool: string | null;

  constructor(
    store: SigilStore,
    undo: UndoManager,
    canvasEl: HTMLCanvasElement,
    canvasSize: number,
  ) {
    this.store = store;
    this.undo = undo;
    this.canvas = canvasEl;
    this.canvasSize = canvasSize;
    this.isDrawing = false;
    this.currentPoints = [];
    this.currentTool = null;
  }

  setTool(tool: string | null): void {
    this.currentTool = tool;
  }

  handleMouseDown(
    nx: NormalizedCoord,
    ny: NormalizedCoord,
  ): { drawing: true } | { placed: string } | null {
    if (this.currentTool === 'squiggle') {
      this.isDrawing = true;
      this.currentPoints = [[nx, ny]];
      return { drawing: true };
    }
    if (this.currentTool === 'curlicue') {
      this.undo.snapshot();
      const deco = this.store.addCurlicue(nx, ny);
      return { placed: deco.id };
    }
    if (this.currentTool === 'text') {
      const text = (document.getElementById('text-input') as HTMLInputElement).value.trim();
      if (!text) return null;
      this.undo.snapshot();
      const deco = this.store.addTextDeco(text, nx, ny);
      return { placed: deco.id };
    }
    return null;
  }

  handleMouseMove(nx: number, ny: number): void {
    if (!this.isDrawing) return;
    const last = this.currentPoints[this.currentPoints.length - 1];
    const dx = (nx - last[0]) * this.canvasSize;
    const dy = (ny - last[1]) * this.canvasSize;
    if (dx * dx + dy * dy > 16) {
      this.currentPoints.push([nx, ny]);
    }
  }

  handleMouseUp(): string | null {
    if (!this.isDrawing) return null;
    this.isDrawing = false;
    let decoId: string | null = null;
    if (this.currentPoints.length >= 2) {
      this.undo.snapshot();
      const deco = this.store.addSquiggle(
        this.currentPoints as [NormalizedCoord, NormalizedCoord][],
        'hsl(320, 100%, 60%)',
      );
      decoId = deco.id;
    }
    this.currentPoints = [];
    return decoId;
  }

  getDrawingPoints(): [number, number][] | null {
    return this.isDrawing ? this.currentPoints : null;
  }
}
