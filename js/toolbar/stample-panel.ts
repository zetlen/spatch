// stample-panel.ts — Stample picker panel
//
// Opens an expansion panel showing all available stamples. Clicking one
// sets the default stample for new stamp voices and dismisses the panel.
// If a stamp voice is selected, also updates its stamp variant.

import type { SigilStore, UndoManager } from '../state.ts';
import { STAMPLES } from '../stamples/index.ts';
import { setDefaultStampleIndex, getDefaultStampleIndex } from '../waveforms/stamp.ts';
import { createExpansionPanel, type ExpansionPanel } from './expansion-panel.ts';

export function createStamplePanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
  requestRender: () => void;
  onDismiss: () => void;
}): ExpansionPanel {
  const { area, store, undo, getSelectedId, requestRender, onDismiss } = deps;

  return createExpansionPanel({
    area,
    entries: () =>
      STAMPLES.map((stample, i) => ({
        type: 'item' as const,
        key: String(i),
        create() {
          const btn = document.createElement('button');
          btn.className = 'action-btn';
          btn.title = stample.name;
          const img = document.createElement('img');
          img.src = stample.svgDataUri;
          img.width = 20;
          img.height = 20;
          img.style.display = 'block';
          btn.append(img);
          return btn;
        },
      })),
    isActive: (key) => getDefaultStampleIndex() === parseInt(key),
    onClick(key) {
      const index = parseInt(key);
      setDefaultStampleIndex(index);

      // If a stamp voice is selected, update its variant
      const id = getSelectedId();
      if (id) {
        const voice = store.getVoice(id);
        if (voice && voice.waveform === 'stamp') {
          undo.snapshot();
          store.updateVoice(id, { stamp: index });
          requestRender();
        }
      }
    },
    onDismiss,
  });
}
