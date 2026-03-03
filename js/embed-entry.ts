// embed-entry.ts — entry point for the embed viewer
import { render } from './canvas.ts';
import { AudioEngine } from './audio.ts';
import { deserializeState } from './serialize.ts';
import { updateCanvasBorderRadius } from './envelope.ts';

const hash = window.location.hash.slice(1);
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
    const sigil = state; // narrow for closures
    const svgEl = document.getElementById('c') as unknown as SVGSVGElement;
    const frame = document.getElementById('canvas-frame')!;
    const audio = new AudioEngine();

    // Apply ADSR border radius to frame (static in embed — only needs to run once)
    updateCanvasBorderRadius(frame, sigil.envelope, 800);

    // Apply reverb shadow to frame
    if (sigil.reverb) {
      const maxBlur = 800 * 0.15;
      const blur = sigil.reverb.depth * maxBlur;
      const alpha = 0.3 + sigil.reverb.depth * 0.5;
      const color =
        sigil.reverb.style === 'glow'
          ? `rgba(255,255,255,${alpha.toFixed(2)})`
          : `rgba(0,0,0,${alpha.toFixed(2)})`;
      frame.style.boxShadow = `inset 0 0 ${blur.toFixed(1)}px ${color}`;
    }

    // Render loop: continuously re-render so playback glow effects animate
    function renderLoop(): void {
      render(svgEl, sigil, null);
      requestAnimationFrame(renderLoop);
    }
    renderLoop();

    // Play button: click-to-toggle works on both mouse and touch
    const btn = document.getElementById('play-btn')!;

    function setEmbedPlayIcon(playing: boolean): void {
      const symbol = playing ? 'tabler-player-stop-filled' : 'tabler-player-play-filled';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `tabler-sprite.svg#${symbol}`);
      svg.appendChild(use);
      btn.replaceChildren(svg);
    }

    btn.addEventListener('click', async () => {
      if (audio.isPlaying) {
        audio.release(sigil.envelope);
        btn.classList.remove('playing');
        setEmbedPlayIcon(false);
      } else {
        if (sigil.voices.length === 0) return;
        await audio.play(sigil, sigil.envelope);
        btn.classList.add('playing');
        setEmbedPlayIcon(true);
      }
    });
  }
}
