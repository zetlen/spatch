// Embed-entry.ts — Embeddable press-to-play viewer with postMessage control API
//
// Supports two boot modes:
//   1. URL state:  /embed/<data>  — renders immediately, press-to-play
//   2. Blank start: /embed/       — waits for parent to send `load` command
//
// PostMessage protocol (see docs/plans/2026-03-31-embed-postmessage-design.md):
//   Commands (parent → embed):  load, play, stop, convert
//   Events   (embed → parent):  ready, playing, stopped, error, converted

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

// ---- Origin validation ----

function getAllowedOrigins(): Set<string> | undefined {
  const param = new URLSearchParams(globalThis.location.search).get('origin');
  if (!param) {
    return undefined;
  }
  return new Set(
    param
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

const allowedOrigins = getAllowedOrigins();

function isOriginAllowed(origin: string): boolean {
  // Same-origin is always allowed
  if (origin === globalThis.location.origin) {
    return true;
  }
  // If no allowlist configured, reject cross-origin
  if (!allowedOrigins) {
    return false;
  }
  return allowedOrigins.has(origin);
}

// ---- PostMessage helpers ----

function emit(type: string, extra?: Record<string, unknown>): void {
  const msg = { source: 'spatch', type, ...extra };
  // Send to parent (iframe host) or opener (popup)
  const target =
    globalThis.parent !== (globalThis as unknown as Window) ? globalThis.parent : globalThis.opener;
  if (target) {
    target.postMessage(msg, '*');
  }
}

// ---- Load initial state from URL ----

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
    return undefined;
  }
  // Read from pathname: /embed/<data>
  const pathname = globalThis.location.pathname;
  if (pathname.startsWith('/embed/') && pathname.length > 7) {
    return deserializeState(pathname.slice(7));
  }
  return undefined;
}

// ---- Error display ----

function showError(msg: string): void {
  const p = document.createElement('p');
  p.className = 'error-msg';
  p.textContent = msg;
  document.body.replaceChildren(p);
}

// ---- Embed controller ----

const embed = qel('#embed');
const sceneBg = qel('#scene-bg');
const tile = qel('#tile');
const svgRoot = qel<SVGSVGElement>('#c');
const audio = new AudioEngine();

let sigil: SigilData | undefined;
let sceneReady: Promise<void> | undefined;
let playing = false;
let playStartTime = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let audioUnlocked = false;
let pendingPlay = false;

// Pre-warm AudioContext on first qualifying gesture
{
  const warmUpEvents = ['touchend', 'click', 'keydown'] as const;
  function onFirstGesture(): void {
    audio.warmUp();
    audioUnlocked = true;
    if (audio.audioCtx) {
      decodeStampSamples(audio.audioCtx);
    }
    for (const evt of warmUpEvents) {
      document.removeEventListener(evt, onFirstGesture);
    }
    // If a play command was waiting for audio unlock, fire it now
    if (pendingPlay) {
      pendingPlay = false;
      startPlay();
    }
  }
  for (const evt of warmUpEvents) {
    document.addEventListener(evt, onFirstGesture);
  }
}

// Inject stamp symbols before first render
initStampSymbols(svgRoot);

function loadSigil(data: SigilData): void {
  const wasPlaying = playing;
  if (wasPlaying) {
    doStop();
  }

  sigil = data;

  // Scene
  const sceneDef = getScene(sigil.scene);
  sceneReady = prefetchScene(sceneDef);

  // ADSR corner radii
  updateCanvasBorderRadius(tile, sigil.envelope);
  updateCanvasBorderRadius(svgRoot, sigil.envelope, 10);

  // Render
  render(svgRoot, sigil, computeOverlappingVoices(sigil.voices), undefined);

  // Scene background
  sceneReady
    .then(() => {
      sceneBg.style.backgroundImage = `url(${sceneDef.stageBackground})`;
      if (!embed.classList.contains('ready')) {
        embed.classList.add('ready');
        requestAnimationFrame(() => embed.classList.add('gleam'));
      }
    })
    .catch(() => {
      if (!embed.classList.contains('ready')) {
        embed.classList.add('ready');
      }
    });
}

async function startPlay(fromMessage = false): Promise<void> {
  if (releaseTimer !== undefined) {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
    return;
  }
  if (playing || !sigil || sigil.voices.length === 0) {
    return;
  }

  // PostMessage-triggered plays attempt audio warmup directly.
  // On desktop browsers this works without an in-iframe gesture.
  // On iOS Safari the AudioContext will stay suspended — show overlay.
  if (!audioUnlocked) {
    if (fromMessage) {
      audio.warmUp();
      if (audio.audioCtx?.state === 'suspended') {
        showAudioOverlay();
        pendingPlay = true;
        return;
      }
      audioUnlocked = true;
      if (audio.audioCtx) {
        decodeStampSamples(audio.audioCtx);
      }
    } else {
      showAudioOverlay();
      pendingPlay = true;
      return;
    }
  }

  playing = true;
  playStartTime = Date.now();
  embed.classList.add('pressing');

  audio.warmUp();
  try {
    const sceneDef = getScene(sigil.scene);
    await sceneReady;
    const irBuffer = audio.audioCtx ? await loadSceneIR(audio.audioCtx, sceneDef) : undefined;
    await audio.play(sigil, sigil.envelope, sceneDef.reverb, { irBuffer });
    emit('playing');
  } catch {
    doRelease();
  }
}

function stopPlay(immediate = false): void {
  if (!playing) {
    return;
  }

  // PostMessage stop commands release immediately — no minimum hold time.
  // Pointer-driven stops enforce MIN_PLAY_MS to prevent accidental taps.
  if (immediate) {
    doRelease();
    return;
  }

  const elapsed = Date.now() - playStartTime;
  const remaining = MIN_PLAY_MS - elapsed;

  if (remaining > 0) {
    releaseTimer = setTimeout(() => doRelease(), remaining);
  } else {
    doRelease();
  }
}

function doRelease(): void {
  embed.classList.remove('pressing');
  if (sigil) {
    audio.release(sigil.envelope);
  }
  playing = false;
  releaseTimer = undefined;
  emit('stopped');
}

function doStop(): void {
  if (releaseTimer !== undefined) {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  }
  embed.classList.remove('pressing');
  audio.stop();
  playing = false;
}

// ---- iOS audio unlock overlay ----

function showAudioOverlay(): void {
  if (embed.querySelector('.audio-unlock')) {
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'audio-unlock';
  overlay.textContent = 'tap to enable sound';
  embed.appendChild(overlay);
  // The touchend/click listener in the warmup handler will unlock audio
  // and trigger the pending play. Clean up overlay on unlock.
  const cleanup = () => {
    overlay.remove();
    overlay.removeEventListener('touchend', cleanup);
    overlay.removeEventListener('click', cleanup);
  };
  overlay.addEventListener('touchend', cleanup);
  overlay.addEventListener('click', cleanup);
}

// ---- Press-to-play interaction (pointer events) ----

embed.addEventListener('pointerdown', (e: PointerEvent) => {
  e.preventDefault();
  startPlay();
});

embed.addEventListener('pointerup', () => stopPlay());
embed.addEventListener('pointerleave', () => stopPlay());
embed.addEventListener('pointercancel', () => stopPlay());
embed.addEventListener('contextmenu', (e: Event) => e.preventDefault());

// ---- PostMessage command handler ----

globalThis.addEventListener('message', (e: MessageEvent) => {
  if (!e.data || e.data.source !== 'spatch') {
    return;
  }
  if (!isOriginAllowed(e.origin)) {
    return;
  }

  switch (e.data.type) {
    case 'load': {
      // Accept either a serialized string or a plain SigilData object.
      // String form: { type: 'load', data: '<base64>' }
      // Object form: { type: 'load', state: { voices, envelope, scene, blend } }
      let state: SigilData | undefined;
      if (typeof e.data.data === 'string') {
        state = deserializeState(e.data.data);
      } else if (e.data.state && Array.isArray(e.data.state.voices)) {
        state = e.data.state as SigilData;
      }
      if (!state) {
        emit('error', { message: 'load: invalid sigil data' });
        return;
      }
      loadSigil(state);
      break;
    }
    case 'play': {
      startPlay(true);
      break;
    }
    case 'stop': {
      stopPlay(true);
      break;
    }
    case 'convert': {
      // Serialization RPC: send wire format ↔ SigilData object.
      // Request:  { type: 'convert', data: '<base64>', id: '...' }
      //        or { type: 'convert', state: SigilData,  id: '...' }
      // Response: { type: 'converted', id: '...', data/state (opposite form) }
      const id = e.data.id;
      if (typeof e.data.data === 'string') {
        const state = deserializeState(e.data.data);
        if (state) {
          emit('converted', { id, state });
        } else {
          emit('error', { id, message: 'convert: invalid wire data' });
        }
      } else if (e.data.state && Array.isArray(e.data.state.voices)) {
        const data = serializeState(e.data.state as SigilData);
        emit('converted', { id, data });
      } else {
        emit('error', { id, message: 'convert: provide data (string) or state (object)' });
      }
      break;
    }
  }
});

// ---- Boot ----

const initialState = loadEmbedState();
if (initialState) {
  loadSigil(initialState);
} else {
  // Blank start or invalid data
  const hasData =
    globalThis.location.hash.length > 1 ||
    (globalThis.location.pathname.startsWith('/embed/') && globalThis.location.pathname.length > 7);
  if (hasData) {
    showError('Invalid sigil data.');
  } else {
    // Blank start — ready for postMessage commands
    embed.classList.add('ready');
  }
}

emit('ready');
