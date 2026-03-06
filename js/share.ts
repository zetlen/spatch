// Share.ts — Share menu UI + embed snippet generator

// Icon reference for sprite scanner: #tabler-link #tabler-code #tabler-check

import { svgEl } from './dom.ts';
import { serializeState } from './serialize.ts';
import type { SigilStore } from './state.ts';
import type { SigilData } from './types.ts';

/** Wire up the share menu button with link-copy and embed-snippet actions. */
export function bindShareMenu(deps: {
  shareBtn: HTMLElement;
  shareMenu: HTMLElement;
  store: SigilStore;
}): void {
  const { shareBtn, shareMenu, store } = deps;

  function syncShareActive(): void {
    shareBtn.classList.toggle('active', !shareMenu.classList.contains('hidden'));
  }

  shareBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    shareMenu.classList.toggle('hidden');
    syncShareActive();
  });

  document.addEventListener('click', (e: MouseEvent) => {
    if (!shareMenu.contains(e.target as Node) && e.target !== shareBtn) {
      shareMenu.classList.add('hidden');
      syncShareActive();
    }
  });

  shareMenu.addEventListener('click', async (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | undefined;
    if (!btn) {
      return;
    }

    const { action } = btn.dataset;

    if (action === 'share') {
      await copyToClipboard(globalThis.location.href);
    } else if (action === 'embed') {
      const snippet = generateEmbedSnippet(store.data);
      await copyToClipboard(snippet);
    }

    // Briefly swap icon to check mark
    const origSvg = btn.querySelector('svg')!;
    const checkSvg = svgEl(
      'svg',
      { width: 20, height: 20 },
      svgEl('use', { href: '#tabler-check' }),
    );
    origSvg.replaceWith(checkSvg);
    setTimeout(() => {
      checkSvg.replaceWith(origSvg);
    }, 1500);
  });
}

/**
 * Generate an HTML iframe snippet for embedding a sigil.
 * @param state - The sigil state to embed
 * @param host - Optional base URL for the embed page (defaults to current origin + embed.html)
 * @returns An iframe HTML string with the serialized state in the URL hash
 */
export function generateEmbedSnippet(state: SigilData, host?: string): string {
  const encoded = serializeState(state);
  const base =
    host ||
    globalThis.location.origin + globalThis.location.pathname.replace(/[^/]*$/, '') + 'embed.html';
  const url = `${base}#${encoded}`;

  const iframe = `<iframe src="${url}" width="400" height="400" style="border:none;border-radius:8px;" allow="autoplay"></iframe>`;

  return iframe;
}

/**
 * Copy text to the clipboard, using the Clipboard API with an execCommand fallback.
 * @param text - The text to copy
 * @returns A promise that resolves when copying is complete
 */
export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}
