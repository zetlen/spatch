// Embed.ts — Embed snippet generator

import { serializeState } from './serialize.ts';
import type { SigilData } from './types.ts';

export function generateEmbedSnippet(state: SigilData, host?: string): string {
  const encoded = serializeState(state);
  const base =
    host ||
    globalThis.location.origin + globalThis.location.pathname.replace(/[^/]*$/, '') + 'embed.html';
  const url = `${base}#${encoded}`;

  const iframe = `<iframe src="${url}" width="400" height="400" style="border:none;border-radius:8px;" allow="autoplay"></iframe>`;

  return iframe;
}

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
