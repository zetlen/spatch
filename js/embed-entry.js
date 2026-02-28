// embed-entry.js — entry point for the embed viewer
import { render } from './canvas.js';
import { AudioEngine } from './audio.js';
import { deserializeState } from './serialize.js';
import { updateCanvasBorderRadius } from './envelope.js';

const hash = window.location.hash.slice(1);
if (!hash) {
  document.body.innerHTML = '<p style="color:#e0e0ff;text-align:center;padding:2em;">No sigil data found.</p>';
} else {
  const state = deserializeState(hash);
  if (!state) {
    document.body.innerHTML = '<p style="color:#e0e0ff;text-align:center;padding:2em;">Invalid sigil data.</p>';
  } else {
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const audio = new AudioEngine();

    render(ctx, state, 800, null, null);
    updateCanvasBorderRadius(canvas, state.envelope, 800);

    const btn = document.getElementById('play-btn');

    btn.addEventListener('mousedown', async () => {
      if (state.shapes.length === 0) return;
      await audio.play(state, state.envelope);
      btn.classList.add('playing');
      btn.textContent = '■ STOP';
    });

    btn.addEventListener('mouseup', () => {
      if (audio.isPlaying) {
        audio.release(state.envelope);
        btn.classList.remove('playing');
        btn.innerHTML = '&#9654; PLAY';
      }
    });
  }
}
