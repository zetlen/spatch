declare const __SCENE_IMAGES__: string[];
const IMAGES: string[] = __SCENE_IMAGES__;

const MODES = ['stage-minimal', 'stage-subtle', 'stage-florid'] as const;
type StageMode = (typeof MODES)[number];

const MODE_LABELS: Record<StageMode, string> = {
  'stage-minimal': 'Minimal',
  'stage-subtle': 'Subtle',
  'stage-florid': 'Florid',
};

interface StageState {
  modeIndex: number;
  imageIndex: number;
}

const STORAGE_KEY = 'stage-theme';

function load(): StageState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        modeIndex: typeof parsed.modeIndex === 'number' ? parsed.modeIndex % MODES.length : 0,
        imageIndex: typeof parsed.imageIndex === 'number' ? parsed.imageIndex % IMAGES.length : 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { modeIndex: 0, imageIndex: 0 };
}

function save(state: StageState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let area: HTMLElement;
let state: StageState;

function apply(): void {
  const mode = MODES[state.modeIndex]!;

  for (const cls of MODES) area.classList.remove(cls);

  if (mode !== 'stage-minimal') {
    area.classList.add(mode);
  }

  if (mode === 'stage-florid') {
    area.style.setProperty('--stage-bg', `url(${IMAGES[state.imageIndex]})`);
  }

  const btn = document.getElementById('btn-stage');
  if (btn) {
    const label = MODE_LABELS[mode];
    const suffix = mode === 'stage-florid' ? ` (${state.imageIndex + 1}/${IMAGES.length})` : '';
    btn.title = `Stage: ${label}${suffix}`;
  }
}

export function initStage(): void {
  area = document.getElementById('canvas-area')!;
  state = load();
  apply();

  const btn = document.getElementById('btn-stage');
  if (btn) {
    btn.addEventListener('click', () => {
      const prevModeIndex = state.modeIndex;
      state.modeIndex = (state.modeIndex + 1) % MODES.length;

      // Advance image when wrapping from florid back to minimal
      if (prevModeIndex === MODES.length - 1 && state.modeIndex === 0) {
        state.imageIndex = (state.imageIndex + 1) % IMAGES.length;
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
