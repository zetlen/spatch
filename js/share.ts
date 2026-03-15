// share.ts — Share overlay: link, embed snippet generation, and live embed preview
//
// Icon references for sprite scanner: #tabler-users-plus #tabler-copy

import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';
import { serializeState } from './serialize.ts';
import type { SigilStore } from './state.ts';

function appBaseUrl(): string {
  return `${globalThis.location.origin}/s/`;
}

function embedBaseUrl(): string {
  return `${globalThis.location.origin}/embed/`;
}

interface OverlayHandle {
  hide(): void;
  onShow: (() => void) | null;
}

export function initShare(audio: AudioEngine, store: SigilStore): OverlayHandle {
  const btn = qel('#btn-share');
  const overlay = qel('#share-overlay');
  const linkCode = qel('#share-link');
  const embedCode = qel('#share-embed-code');
  const sizeSlider = qel<HTMLInputElement>('#share-size');
  const sizeValue = qel('#share-size-value');
  const copyLinkBtn = qel('#btn-copy-link');
  const copyEmbedBtn = qel('#btn-copy-embed');
  const preview = qel<HTMLIFrameElement>('#share-preview');

  const handle: OverlayHandle = { hide, onShow: null };

  let currentHash = '';

  function updateSnippets(): void {
    const size = sizeSlider.value;
    sizeValue.textContent = size;

    const linkUrl = `${appBaseUrl()}${currentHash}`;
    linkCode.textContent = linkUrl;

    const embedUrl = `${embedBaseUrl()}${currentHash}`;
    embedCode.textContent = `<iframe src="${embedUrl}" width="${size}" height="${size}" style="border:none"></iframe>`;

    preview.src = embedUrl;
    const px = size + 'px';
    preview.style.width = px;
    preview.style.height = px;
  }

  function show(): void {
    if (store.data.voices.length === 0) return;
    handle.onShow?.();
    currentHash = serializeState(store.data);

    updateSnippets();
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
    if ((e.target as HTMLElement).closest('.share-content')) return;
    hide();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      hide();
    }
  });

  sizeSlider.addEventListener('input', updateSnippets);

  copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(linkCode.textContent || '');
  });

  copyEmbedBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(embedCode.textContent || '');
  });

  return handle;
}
