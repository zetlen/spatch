import IMAGES from 'virtual:scene-images';
import { qel } from './dom.ts';
import type { SigilStore } from './state.ts';

const STORAGE_KEY = 'stage-theme';

/** Read fallback scene index from localStorage (for fresh visits with no URL state). */
export function loadFallbackScene(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const idx = typeof parsed === 'number' ? parsed : (parsed.imageIndex ?? 0);
      return idx % IMAGES.length;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

let app: HTMLElement;

/** Apply the given scene index visually (set CSS custom property on #app). */
export function applyScene(index: number): void {
  const safeIndex = ((index % IMAGES.length) + IMAGES.length) % IMAGES.length;
  if (app) {
    app.style.setProperty('--stage-bg', `url(${IMAGES[safeIndex]})`);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeIndex));
}

/** Get a resolved image URL for a scene index (for embed page). */
export function getSceneImageUrl(index: number): string {
  const safeIndex = ((index % IMAGES.length) + IMAGES.length) % IMAGES.length;
  return IMAGES[safeIndex]!;
}

export function initStage(store: SigilStore): void {
  app = qel('#app');
  applyScene(store.data.scene);

  const btn = document.querySelector<HTMLElement>('#btn-stage');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = (store.data.scene + 1) % IMAGES.length;
      store.updateScene(next);
    });
  }
}
