// Embed-entry.ts — Minimal press-to-play embed viewer

import { render } from './canvas/render.ts';
import { computeOverlappingVoices } from './overlap.ts';
import { AudioEngine } from './audio/engine.ts';
import { createSampleLoader, setSampleLoader } from './audio/sample-loader.ts';
import { deserializeState, serializeState } from './serialize.ts';
import { updateCanvasBorderRadius } from './shapes.ts';
import { qel } from './dom.ts';
import { getScene } from './scenes';
import { prefetchScene, loadSceneIR } from './scenes/loader';
import {
  prefetchStampSamples,
  initStampSymbols,
  decodeStampSamples,
} from './voices/stamp/lifecycle.ts';
import type { SigilData } from './types.ts';

setSampleLoader(createSampleLoader(fetch.bind(globalThis)));
prefetchStampSamples();

const MIN_PLAY_MS = 2000;

function loadEmbedState(): SigilData | undefined {
  // Hash migration: old embed URLs stored state in the hash
  const hash = globalThis.location.hash.slice(1);
  if (hash) {
    const state = deserializeState(hash);
    if (state) {
      const path = '/embed/' + serializeState(state);
      history.replaceState(null, '', path);
      return state;
    }
    // Hash present but invalid
    return undefined;
  }
  // Read from pathname: /embed/<data>
  const pathname = globalThis.location.pathname;
  if (pathname.startsWith('/embed/') && pathname.length > 7) {
    return deserializeState(pathname.slice(7));
  }
  return undefined;
}

const state = loadEmbedState();
if (!state) {
  const hasData =
    globalThis.location.hash.length > 1 ||
    (globalThis.location.pathname.startsWith('/embed/') && globalThis.location.pathname.length > 7);
  showError(hasData ? 'Invalid sigil data.' : 'No sigil data found.');
} else {
  boot(state);
}

function showError(msg: string): void {
  const p = document.createElement('p');
  p.className = 'error-msg';
  p.textContent = msg;
  document.body.replaceChildren(p);
}

function boot(sigil: SigilData): void {
  // Scene
  const sceneDef = getScene(sigil.scene);
  const sceneReady = prefetchScene(sceneDef);

  // DOM
  const embed = qel('#embed');
  const sceneBg = qel('#scene-bg');
  const tile = qel('#tile');
  const svgRoot = qel<SVGSVGElement>('#c');

  // Audio
  const audio = new AudioEngine();

  // Pre-warm AudioContext on first qualifying gesture
  {
    const warmUpEvents = ['touchend', 'click', 'keydown'] as const;
    function onFirstGesture(): void {
      audio.warmUp();
      if (audio.audioCtx) {
        decodeStampSamples(audio.audioCtx);
      }
      for (const evt of warmUpEvents) {
        document.removeEventListener(evt, onFirstGesture);
      }
    }
    for (const evt of warmUpEvents) {
      document.addEventListener(evt, onFirstGesture);
    }
  }

  // ADSR corner radii (static — only set once, not on embed so scene bg shows through corners)
  updateCanvasBorderRadius(tile, sigil.envelope);
  updateCanvasBorderRadius(svgRoot, sigil.envelope, 10);

  // Inject stamp symbols before first render
  initStampSymbols(svgRoot);

  // Initial render (one-shot — state never changes in embed)
  render(svgRoot, sigil, computeOverlappingVoices(sigil.voices), undefined);

  // Reveal after scene assets loaded
  sceneReady
    .then(() => {
      sceneBg.style.backgroundImage = `url(${sceneDef.stageBackground})`;
      embed.classList.add('ready');

      // Gleam on load
      requestAnimationFrame(() => {
        embed.classList.add('gleam');
      });
    })
    .catch(() => {
      embed.classList.add('ready');
    });

  // ---- Press-to-play interaction ----

  let playing = false;
  let playStartTime = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  async function startPlay(): Promise<void> {
    if (releaseTimer !== undefined) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      return;
    }
    if (playing) {
      return;
    }
    if (sigil.voices.length === 0) {
      return;
    }

    playing = true;
    playStartTime = Date.now();
    embed.classList.add('pressing');

    audio.warmUp();
    try {
      await sceneReady;
      const irBuffer = audio.audioCtx ? await loadSceneIR(audio.audioCtx, sceneDef) : undefined;
      await audio.play(sigil, sigil.envelope, sceneDef.reverb, { irBuffer });
    } catch {
      doRelease();
    }
  }

  function stopPlay(): void {
    if (!playing) {
      return;
    }

    const elapsed = Date.now() - playStartTime;
    const remaining = MIN_PLAY_MS - elapsed;

    if (remaining > 0) {
      // Hold for minimum duration, then release
      releaseTimer = setTimeout(() => {
        doRelease();
      }, remaining);
    } else {
      doRelease();
    }
  }

  function doRelease(): void {
    embed.classList.remove('pressing');
    audio.release(sigil.envelope);
    playing = false;
    releaseTimer = undefined;
  }

  // Pointer events for press-and-hold
  embed.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    startPlay();
  });

  embed.addEventListener('pointerup', () => {
    stopPlay();
  });

  embed.addEventListener('pointerleave', () => {
    stopPlay();
  });

  embed.addEventListener('pointercancel', () => {
    stopPlay();
  });

  // Prevent context menu on long-press (mobile)
  embed.addEventListener('contextmenu', (e: Event) => {
    e.preventDefault();
  });
}
