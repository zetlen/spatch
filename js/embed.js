// embed.js — Embed snippet generator

import { serializeState } from './serialize.js';

export function generateEmbedSnippet(state, host) {
  const encoded = serializeState(state);
  const base = host || window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'embed.html';
  const url = `${base}#${encoded}`;

  const iframe = `<iframe src="${url}" width="400" height="400" style="border:none;border-radius:8px;" allow="autoplay"></iframe>`;

  return iframe;
}

export function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

export function showEmbedModal(state) {
  const snippet = generateEmbedSnippet(state);

  // Remove existing modal
  const existing = document.getElementById('embed-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'embed-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center; z-index: 200;
  `;

  modal.innerHTML = `
    <div style="background: #12122a; border: 1px solid rgba(0,240,255,0.3); border-radius: 8px;
                padding: 20px; max-width: 500px; width: 90%; color: #e0e0ff; font-family: 'Share Tech Mono', monospace;">
      <h3 style="margin: 0 0 12px; color: #00f0ff; font-family: 'Orbitron', sans-serif; font-size: 14px;">
        EMBED YOUR SIGIL
      </h3>
      <textarea id="embed-code" readonly style="
        width: 100%; height: 80px; background: #0a0a1a; color: #e0e0ff; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px; padding: 8px; font-family: 'Share Tech Mono', monospace; font-size: 11px; resize: none;
      ">${snippet}</textarea>
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button id="embed-copy" style="
          background: linear-gradient(135deg, #ff2d95, #b44dff); border: none; color: white;
          padding: 8px 16px; border-radius: 4px; cursor: pointer; font-family: 'Orbitron', sans-serif;
          font-size: 12px; letter-spacing: 1px;
        ">COPY</button>
        <button id="embed-close" style="
          background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #e0e0ff;
          padding: 8px 16px; border-radius: 4px; cursor: pointer; font-family: 'Share Tech Mono', monospace;
          font-size: 12px;
        ">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('embed-copy').addEventListener('click', () => {
    copyToClipboard(snippet).then(() => {
      document.getElementById('embed-copy').textContent = 'COPIED!';
      setTimeout(() => {
        const btn = document.getElementById('embed-copy');
        if (btn) btn.textContent = 'COPY';
      }, 2000);
    });
  });

  document.getElementById('embed-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}
