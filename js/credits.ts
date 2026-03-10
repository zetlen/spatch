// credits.ts -- Credits overlay toggle + audio muffling + dynamic photo credit

// Icon reference for sprite scanner: #tabler-heart-search

import { effect } from '@preact/signals-core';
import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';
import { getScene } from './scenes/index.ts';
import type { SigilStore } from './state.ts';

interface OverlayHandle {
  show(): void;
  hide(): void;
  onShow: (() => void) | null;
}

export function initCredits(audio: AudioEngine, store: SigilStore): OverlayHandle {
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

  const handle: OverlayHandle = { show, hide, onShow: null };

  function show(): void {
    handle.onShow?.();
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    audio.muffle();
  }

  function hide(): void {
    if (overlay.classList.contains('hidden')) return;
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

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      hide();
    }
  });

  return handle;
}
