import IMAGES from 'virtual:scene-images';
import { qel } from './dom.ts';

const STAGE_CLASS = 'stage-florid';

interface StageState {
  florid: boolean;
  imageIndex: number;
}

const STORAGE_KEY = 'stage-theme';

function load(): StageState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        florid: parsed.florid === true || parsed.modeIndex === 2,
        imageIndex: typeof parsed.imageIndex === 'number' ? parsed.imageIndex % IMAGES.length : 0,
      };
    }
  } catch {
    /* Ignore */
  }
  return { florid: false, imageIndex: 0 };
}

function save(state: StageState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let app: HTMLElement;
let area: HTMLElement;
let state: StageState;

function apply(): void {
  app.classList.toggle(STAGE_CLASS, state.florid);
  area.classList.toggle(STAGE_CLASS, state.florid);

  if (state.florid) {
    const bgUrl = `url(${IMAGES[state.imageIndex]})`;
    area.style.setProperty('--stage-bg', bgUrl);
    app.style.setProperty('--stage-bg', bgUrl);
  }

  const btn = document.querySelector<HTMLElement>('#btn-stage');
  if (btn) {
    btn.title = state.florid
      ? `Stage: Image (${state.imageIndex + 1}/${IMAGES.length})`
      : 'Stage: White';
  }
}

export function initStage(): void {
  app = qel('#app');
  area = qel('#canvas-area');
  state = load();
  apply();

  const btn = document.querySelector<HTMLElement>('#btn-stage');
  if (btn) {
    btn.addEventListener('click', () => {
      if (state.florid) {
        // Florid → White, advance to next image for next time
        state.florid = false;
        state.imageIndex = (state.imageIndex + 1) % IMAGES.length;
      } else {
        // White → Florid
        state.florid = true;
      }

      save(state);
      apply();
    });
  }
}

export function setAudioLevel(level: number): void {
  if (area) {
    area.style.setProperty('--audio-level', level.toFixed(3));
  }
}
