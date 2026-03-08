// credits.ts -- Credits overlay toggle + audio muffling + dynamic photo credit

// Icon reference for sprite scanner: #tabler-heart-search

import { effect } from '@preact/signals-core';
import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';
import { getScene } from './scenes/index.ts';
import type { SigilStore } from './state.ts';

export function initCredits(audio: AudioEngine, store: SigilStore): void {
  const btn = qel('#btn-credits');
  const overlay = qel('#credits-overlay');

  // Dynamic photo credit: updates when the scene changes
  const creditLi = qel('#credit-photo');
  const creditLink = creditLi.querySelector('a')!;

  effect(() => {
    const scene = getScene(store.data.scene);
    if (scene.creditUrl) {
      creditLink.href = scene.creditUrl;
      creditLink.textContent = scene.imageCredit;
      creditLink.style.display = '';
      creditLi.childNodes[0]!.textContent = 'Photography: ';
    } else {
      creditLink.style.display = 'none';
      creditLi.childNodes[0]!.textContent = `Photography: ${scene.imageCredit}`;
    }
  });

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
