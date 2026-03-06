// Embed-entry.ts — entry point for the embed viewer
import { render } from './canvas/render.ts';
import { AudioEngine } from './audio/engine.ts';
import { deserializeState } from './serialize.ts';
import { updateCanvasBorderRadius } from './shapes.ts';
import { qel, svgEl } from './dom.ts';

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
    updateCanvasBorderRadius(frame, sigil.envelope);

    // Render loop: continuously re-render so playback glow effects animate
    function renderLoop(): void {
      render(svgRoot, sigil, undefined);
      requestAnimationFrame(renderLoop);
    }
    renderLoop();

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
        await audio.play(sigil, sigil.envelope);
        btn.classList.add('playing');
        setEmbedPlayIcon(true);
      }
    });
  }
}
