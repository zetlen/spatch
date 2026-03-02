// embed-entry.ts — entry point for the embed viewer
import { render } from './canvas.ts';
import { AudioEngine } from './audio.ts';
import { deserializeState } from './serialize.ts';
import { updateCanvasBorderRadius } from './envelope.ts';

const hash = window.location.hash.slice(1);
if (!hash) {
  // Static content only — no user input involved
  document.body.innerHTML =
    '<p style="color:#e0e0ff;text-align:center;padding:2em;">No sigil data found.</p>';
} else {
  const state = deserializeState(hash);
  if (!state) {
    // Static content only — no user input involved
    document.body.innerHTML =
      '<p style="color:#e0e0ff;text-align:center;padding:2em;">Invalid sigil data.</p>';
  } else {
    const sigil = state; // narrow for closures
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const audio = new AudioEngine();

    // Render loop: continuously re-render so playback glow effects animate
    function renderLoop(): void {
      render(ctx, sigil, 800, null, audio.playingShapeIds);
      updateCanvasBorderRadius(canvas, sigil.envelope, 800);
      requestAnimationFrame(renderLoop);
    }
    renderLoop();

    // Play button: click-to-toggle works on both mouse and touch
    const btn = document.getElementById('play-btn')!;

    btn.addEventListener('click', async () => {
      if (audio.isPlaying) {
        audio.release(sigil.envelope);
        btn.classList.remove('playing');
        btn.textContent = '\u25B6 PLAY';
      } else {
        if (sigil.voices.length === 0) return;
        await audio.play(sigil, sigil.envelope);
        btn.classList.add('playing');
        btn.textContent = '\u25A0 STOP';
      }
    });
  }
}
