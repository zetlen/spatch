// Embed-entry.ts — entry point for the embed viewer
import { render } from './canvas/render.ts';
import { AudioEngine } from './audio/engine.ts';
import { deserializeState } from './serialize.ts';
import { updateCanvasBorderRadius } from './shapes.ts';
import { qel, svgEl } from './dom.ts';
import { Vibe, setVibe } from './audio/vibe.ts';
import { getScene } from './scenes';
import { prefetchScene, loadSceneIR } from './scenes/loader';

const hash = globalThis.location.hash.slice(1);
if (!hash) {
  // Static content only — no user input involved
  document.body.innerHTML =
    '<p style="color:#2a2a2a;text-align:center;padding:2em;">No sigil data found.</p>';
} else {
  const state = deserializeState(hash);
  if (!state) {
    // Static content only — no user input involved
    document.body.innerHTML =
      '<p style="color:#2a2a2a;text-align:center;padding:2em;">Invalid sigil data.</p>';
  } else {
    const sigil = state; // Narrow for closures

    // Apply scene vibe and start prefetching assets
    const sceneDef = getScene(sigil.scene);
    setVibe(new Vibe(sceneDef?.vibe));
    const sceneReady = prefetchScene(sceneDef);

    const svgRoot = qel<SVGSVGElement>('#c');
    const frame = qel('#tile');
    const audio = new AudioEngine();

    // Pre-warm AudioContext on first user gesture. iOS Safari only allows
    // Audio from touchend/click/keydown — NOT pointerdown/mousedown.
    {
      const warmUpEvents = ['touchend', 'click', 'keydown'] as const;
      function onFirstGesture(): void {
        audio.warmUp();
        for (const evt of warmUpEvents) {
          document.removeEventListener(evt, onFirstGesture);
        }
      }
      for (const evt of warmUpEvents) {
        document.addEventListener(evt, onFirstGesture);
      }
    }

    // Apply ADSR border radius to frame (static in embed — only needs to run once)
    updateCanvasBorderRadius(qel('#wrap'), sigil.envelope);
    updateCanvasBorderRadius(frame, sigil.envelope);
    updateCanvasBorderRadius(svgRoot, sigil.envelope, 10);

    // Render loop: continuously re-render so playback glow effects animate
    function renderLoop(): void {
      render(svgRoot, sigil, undefined);
      requestAnimationFrame(renderLoop);
    }
    renderLoop();

    // Reveal after first render + scene assets loaded (no FOUC)
    sceneReady.then(() => {
      document.body.style.backgroundImage = `url(${sceneDef.stageBackground})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      qel('#wrap').classList.add('ready');
    });

    // Play button: click-to-toggle works on both mouse and touch
    const btn = qel('#play-btn');

    function setEmbedPlayIcon(playing: boolean): void {
      const symbol = playing ? 'tabler-player-stop-filled' : 'tabler-player-play-filled';
      btn.replaceChildren(
        svgEl(
          'svg',
          { width: 20, height: 20 },
          svgEl('use', { href: `tabler-sprite.svg#${symbol}` }),
        ),
      );
    }

    btn.addEventListener('click', async () => {
      if (audio.isPlaying) {
        audio.release(sigil.envelope);
        btn.classList.remove('playing');
        setEmbedPlayIcon(false);
      } else {
        if (sigil.voices.length === 0) {
          return;
        }
        audio.warmUp(); // Synchronous — must happen before any await (iOS Safari)
        await sceneReady;
        const irBuffer = audio.audioCtx ? await loadSceneIR(audio.audioCtx, sceneDef) : undefined;
        await audio.play(sigil, sigil.envelope, { irBuffer });
        btn.classList.add('playing');
        setEmbedPlayIcon(true);
      }
    });
  }
}
