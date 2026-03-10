// stage-panel.ts — Long-press scene picker for the stage button
//
// Quick click: advance to next scene. Long press: opens a panel with one
// button per scene. The current scene is highlighted. Clicking a scene
// button applies it and dismisses the panel.

import type { SigilStore, UndoManager } from '../state.ts';
import { SCENES, getScene } from '../scenes/index.ts';
import { prefetchAllScenes } from '../scenes/loader.ts';
import { createIconButton } from './dom-helpers.ts';

// Icon references for sprite scanner (pulled from each scene's `icon` field):
// #tabler-armchair #tabler-fountain-off #tabler-building-monument
// #tabler-building-airport #tabler-paint #tabler-traffic-cone #tabler-mouse-2
// #tabler-building-skyscraper #tabler-building-bank #tabler-train #tabler-wall
// #tabler-building-warehouse

const LONG_PRESS_MS = 400;

export function createStagePanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  requestRender: () => void;
}): { bindLongPress(btn: HTMLElement): void } {
  const { area, store, undo, requestRender } = deps;

  function open(): void {
    area.replaceChildren();
    prefetchAllScenes();

    const currentScene = store.data.scene;

    for (let i = 0; i < SCENES.length; i++) {
      const scene = getScene(i);
      const btn = createIconButton({
        className: 'action-btn',
        dataset: { scene: String(i) },
        symbol: scene.icon,
        title: scene.name,
      });
      if (i === currentScene) {
        btn.classList.add('active');
      }
      area.append(btn);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        undo.snapshot();
        store.updateScene(i);
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
        if (!didLongPress && !isOpen()) {
          undo.snapshot();
          store.updateScene((store.data.scene + 1) % SCENES.length);
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
