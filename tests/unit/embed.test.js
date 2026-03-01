import { describe, test, expect } from 'bun:test';
import { generateEmbedSnippet, copyToClipboard } from '../../js/embed.js';

describe('generateEmbedSnippet', () => {
  test('returns an iframe string containing encoded state', () => {
    const state = {
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
      shapes: [],
      decorations: [],
    };
    const snippet = generateEmbedSnippet(state, 'https://example.com/embed.html');
    expect(snippet).toContain('<iframe');
    expect(snippet).toContain('https://example.com/embed.html#');
    expect(snippet).toContain('width="400"');
    expect(snippet).toContain('height="400"');
    expect(snippet).toContain('allow="autoplay"');
  });

  test('uses provided host as base URL', () => {
    const state = {
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
      shapes: [],
      decorations: [],
    };
    const snippet = generateEmbedSnippet(state, 'https://my-site.com/embed.html');
    expect(snippet).toContain('src="https://my-site.com/embed.html#');
  });
});
