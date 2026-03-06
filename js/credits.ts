// credits.ts -- Credits overlay toggle + audio muffling

// Icon reference for sprite scanner: #tabler-heart-search

import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';

export function initCredits(audio: AudioEngine): void {
  const btn = qel('#btn-credits');
  const overlay = qel('#credits-overlay');

  function show(): void {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    audio.muffle();
  }

  function hide(): void {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    audio.unmuffle();
  }

  btn.addEventListener('click', () => {
    if (overlay.classList.contains('hidden')) {
      show();
    } else {
      hide();
    }
  });

  overlay.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) {
      return;
    }
    hide();
  });
}
