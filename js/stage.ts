import IMAGES from 'virtual:scene-images';
import { qel } from './dom.ts';

const STORAGE_KEY = 'stage-theme';

function loadIndex(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Support old format (had florid + imageIndex) and new (just index)
      const idx = typeof parsed === 'number' ? parsed : (parsed.imageIndex ?? 0);
      return idx % IMAGES.length;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function saveIndex(index: number): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
}

let app: HTMLElement;
let imageIndex: number;

function apply(): void {
  app.style.setProperty('--stage-bg', `url(${IMAGES[imageIndex]})`);
}

export function initStage(): void {
  app = qel('#app');
  imageIndex = loadIndex();
  apply();

  const btn = document.querySelector<HTMLElement>('#btn-stage');
  if (btn) {
    btn.addEventListener('click', () => {
      imageIndex = (imageIndex + 1) % IMAGES.length;
      saveIndex(imageIndex);
      apply();
    });
  }
}
