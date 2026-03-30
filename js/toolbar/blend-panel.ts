// Blend-panel.ts — Long-press blend mode picker
// Icon references for sprite scanner:
// #tabler-blender #tabler-layers-union #tabler-layers-intersect
// #tabler-layers-intersect-2 #tabler-layers-difference

import type { SigilStore, UndoManager } from '../state.ts';
import { BLEND_MODES, type BlendMode } from '../types.ts';
import { createExpansionPanel, type ExpansionPanel } from './expansion-panel.ts';

const BLEND_ICONS: Record<BlendMode, string> = {
  screen: 'tabler-layers-union',
  multiply: 'tabler-layers-intersect',
  exclusion: 'tabler-layers-intersect-2',
  difference: 'tabler-layers-difference',
};

const BLEND_LABELS: Record<BlendMode, string> = {
  screen: 'Screen (no FM)',
  multiply: 'Multiply (gentle FM)',
  exclusion: 'Exclusion (medium FM)',
  difference: 'Difference (intense FM)',
};

export function createBlendPanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  onDismiss: () => void;
}): ExpansionPanel {
  const { area, store, undo, onDismiss } = deps;

  return createExpansionPanel({
    area,
    entries: () =>
      BLEND_MODES.map((mode) => ({
        type: 'icon' as const,
        symbol: BLEND_ICONS[mode],
        title: BLEND_LABELS[mode],
        key: mode,
      })),
    isActive: (key) => store.data.blend === key,
    onClick(key) {
      undo.snapshot();
      store.updateBlend(key as BlendMode);
    },
    onDismiss,
  });
}
