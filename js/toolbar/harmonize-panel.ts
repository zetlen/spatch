// Harmonize-panel.ts — Long-press scale picker
// Icon references for sprite scanner:
// #tabler-award #tabler-bell-school #tabler-chart-histogram #tabler-mailbox-off
// #tabler-fish #tabler-currency-dram #tabler-circuit-cell-plus #tabler-joker
// #tabler-torii

import type { SigilStore, UndoManager } from '../state.ts';
import { harmonizeWithScale } from '../harmony.ts';
import { createExpansionPanel, type ExpansionPanel } from './expansion-panel.ts';

const SCALE_ICONS: { symbol: string; title: string }[] = [
  { symbol: 'tabler-award', title: 'Major Pentatonic' },
  { symbol: 'tabler-bell-school', title: 'Minor Pentatonic' },
  { symbol: 'tabler-chart-histogram', title: 'Mixolydian' },
  { symbol: 'tabler-mailbox-off', title: 'Lydian' },
  { symbol: 'tabler-fish', title: 'Phrygian' },
  { symbol: 'tabler-currency-dram', title: 'Dorian' },
  { symbol: 'tabler-circuit-cell-plus', title: 'Natural Minor' },
  { symbol: 'tabler-joker', title: 'Blues' },
  { symbol: 'tabler-torii', title: 'Mu' },
];

export function createHarmonizePanel(deps: {
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
      SCALE_ICONS.map((icon, i) => ({
        type: 'icon' as const,
        symbol: icon.symbol,
        title: icon.title,
        key: String(i),
      })),
    onClick(key) {
      harmonizeWithScale(store, undo, parseInt(key));
      requestRender();
    },
    onDismiss,
  });
}
