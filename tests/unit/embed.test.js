import { describe, expect, test } from 'bun:test';
import { generateEmbedSnippet } from '../../js/share.ts';

describe('generateEmbedSnippet', () => {
  test('returns an iframe string containing encoded state', () => {
    const state = {
      envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
      reverb: undefined,

      voices: [],
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
      envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
      reverb: undefined,

      voices: [],
    };
    const snippet = generateEmbedSnippet(state, 'https://my-site.com/embed.html');
    expect(snippet).toContain('src="https://my-site.com/embed.html#');
  });
});
