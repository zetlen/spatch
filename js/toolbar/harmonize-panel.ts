// harmonize-panel.ts — Long-press scale picker for the harmonize button
//
// Quick click: random harmonize. Long press: opens a panel with one button
// per scale. Clicking a scale button applies it and dismisses the panel.

import type { SigilStore, UndoManager } from '../state.ts';
import { harmonize, harmonizeWithScale, SCALE_COUNT } from '../harmony.ts';
import { createIconButton } from './dom-helpers.ts';

// Icon references for sprite scanner:
// #tabler-award #tabler-bell-school #tabler-chart-histogram #tabler-mailbox-off
// #tabler-fish #tabler-currency-dram #tabler-circuit-cell-plus #tabler-joker
// #tabler-mood-puzzled

const SCALE_ICONS: { symbol: string; title: string }[] = [
  { symbol: 'tabler-award', title: 'Major Pentatonic' },
  { symbol: 'tabler-bell-school', title: 'Minor Pentatonic' },
  { symbol: 'tabler-chart-histogram', title: 'Mixolydian' },
  { symbol: 'tabler-mailbox-off', title: 'Lydian' },
  { symbol: 'tabler-fish', title: 'Phrygian' },
  { symbol: 'tabler-currency-dram', title: 'Dorian' },
  { symbol: 'tabler-circuit-cell-plus', title: 'Natural Minor' },
  { symbol: 'tabler-joker', title: 'Blues' },
  { symbol: 'tabler-mood-puzzled', title: 'Mu' },
];

const LONG_PRESS_MS = 400;

export function createHarmonizePanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  requestRender: () => void;
}): { bindLongPress(btn: HTMLElement): void } {
  const { area, store, undo, requestRender } = deps;

  function open(): void {
    area.replaceChildren();

    for (let i = 0; i < SCALE_COUNT; i++) {
      const icon = SCALE_ICONS[i]!;
      const btn = createIconButton({
        className: 'action-btn',
        dataset: { scale: String(i) },
        symbol: icon.symbol,
        title: icon.title,
      });
      area.append(btn);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        harmonizeWithScale(store, undo, i);
        requestRender();
        close();
      });
    }

    area.classList.remove('hidden');
  }

  function close(): void {
    area.classList.add('hidden');
    area.replaceChildren();
  }

  function isOpen(): boolean {
    return !area.classList.contains('hidden');
  }

  function bindLongPress(btn: HTMLElement): void {
    // Click-away dismissal (needs btn reference, so registered inside bindLongPress)
    document.addEventListener('click', (e: MouseEvent) => {
      if (!isOpen()) return;
      const target = e.target as Node;
      if (!area.contains(target) && !btn.contains(target)) {
        close();
      }
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let didLongPress = false;

    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      didLongPress = false;
      btn.setPointerCapture(e.pointerId);
      timer = setTimeout(() => {
        didLongPress = true;
        timer = undefined;
        if (isOpen()) {
          close();
        } else {
          open();
        }
      }, LONG_PRESS_MS);
    });

    btn.addEventListener('pointerup', () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        // Short click — random harmonize (only if panel isn't open)
        if (!didLongPress && !isOpen()) {
          harmonize(store, undo);
          requestRender();
        }
      }
    });

    btn.addEventListener('pointercancel', () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    });
  }

  return { bindLongPress };
}
