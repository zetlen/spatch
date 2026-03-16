// keyboard.ts — Global keyboard shortcut handler.
//
// Owns the clipboard variable and the document 'keydown' listener.
// Handles delete, copy/paste/duplicate, undo/redo, escape, tool switch,
// and space-bar play toggle.

import type { SelectionManager, SigilStore, UndoManager } from './state.ts';
import type { PlaybackController } from './playback.ts';
import type { Voice } from './types.ts';

/** Minimal toolbar interface needed by keyboard shortcuts for tool switching. */
export interface KeyboardToolbar {
  currentTool: string;
  _updateToolActive(): void;
}

/**
 * Bind global keyboard shortcuts: delete, copy/paste/duplicate, undo/redo,
 * escape (deselect), tool switching, and space-bar play toggle.
 */
export function bindKeyboardShortcuts(deps: {
  store: SigilStore;
  undo: UndoManager;
  selection: SelectionManager;
  toolbar: KeyboardToolbar;
  playback: PlaybackController;
  requestRender: () => void;
  toggleSolo: () => void;
}): void {
  const { store, undo, selection, toolbar, playback, requestRender, toggleSolo } = deps;

  let clipboard: Voice | undefined;

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Don't intercept when typing in inputs
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    ) {
      return;
    }

    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.voiceId) {
        undo.snapshot();
        store.removeVoice(selection.voiceId);
        selection.clear();
      }
    }
    if (e.key === 'c' && mod) {
      if (selection.voiceId) {
        const voice = store.getVoice(selection.voiceId);
        if (voice) {
          clipboard = structuredClone(voice);
        }
      }
    }
    if (e.key === 'v' && mod) {
      e.preventDefault();
      if (clipboard) {
        undo.snapshot();
        const pasted = store.pasteVoice(clipboard, 0.03, 0.03);
        selection.select(pasted.id);
        requestRender();
      }
      return;
    }
    if (e.key === 'd' && mod) {
      e.preventDefault();
      if (selection.voiceId) {
        undo.snapshot();
        const dup = store.duplicateVoice(selection.voiceId, 0.03, 0.03);
        if (dup) {
          selection.select(dup.id);
          requestRender();
        }
      }
      return;
    }
    if (e.key === 'z' && mod) {
      e.preventDefault();
      if (e.shiftKey) {
        undo.redo();
      } else {
        undo.undo();
      }
    }
    if (e.key === 'y' && mod) {
      e.preventDefault();
      undo.redo();
    }
    if (e.key === 'Escape') {
      selection.clear();
      toolbar.currentTool = 'select';
      toolbar._updateToolActive();
      requestRender();
    }
    if (e.key === 'v' && !mod) {
      toolbar.currentTool = 'select';
      toolbar._updateToolActive();
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (e.repeat || !document.body.classList.contains('is-editing')) {
        return;
      }
      if (playback.isPlaying) {
        playback.stop();
      } else if (store.data.voices.length > 0) {
        playback.start().then(() => playback.latch());
      }
    }
    if (e.key === 's' && !mod) {
      toggleSolo();
    }
  });
}
