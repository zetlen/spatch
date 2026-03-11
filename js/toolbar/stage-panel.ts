// stage-panel.ts — Long-press scene picker
// Icon references for sprite scanner (pulled from each scene's `icon` field):
// #tabler-armchair #tabler-fountain-off #tabler-building-monument
// #tabler-building-airport #tabler-paint #tabler-traffic-cone #tabler-mouse-2
// #tabler-building-skyscraper #tabler-building-bank #tabler-train #tabler-wall
// #tabler-building-warehouse

import type { SigilStore, UndoManager } from '../state.ts';
import { SCENES, getScene } from '../scenes/index.ts';
import { prefetchAllScenes } from '../scenes/loader.ts';
import { createExpansionPanel, type ExpansionPanel } from './expansion-panel.ts';

export function createStagePanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  requestRender: () => void;
  onDismiss: () => void;
}): ExpansionPanel {
  const { area, store, undo, requestRender, onDismiss } = deps;

  return createExpansionPanel({
    area,
    entries: () =>
      SCENES.map((_, i) => {
        const scene = getScene(i);
        return { type: 'icon' as const, symbol: scene.icon, title: scene.name, key: String(i) };
      }),
    isActive: (key) => store.data.scene === parseInt(key),
    onClick(key) {
      undo.snapshot();
      store.updateScene(parseInt(key));
      requestRender();
    },
    onDismiss,
    onOpen: prefetchAllScenes,
  });
}
