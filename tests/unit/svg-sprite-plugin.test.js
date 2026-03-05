import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSymbol, rewriteHtml, scanSourceFiles } from '../../scripts/vite-plugin-svg-sprite.ts';

// ---------------------------------------------------------------------------
// ScanSourceFiles
// ---------------------------------------------------------------------------

describe('scanSourceFiles', () => {
  test('finds icon names from HTML href attributes', () => {
    const root = mkdtempSync(join(tmpdir(), 'sprite-test-'));
    writeFileSync(
      join(root, 'index.html'),
      `<svg><use href="icons.svg#my-arrow"/></svg>
       <svg><use href="icons.svg#my-star"/></svg>`,
    );
    const result = scanSourceFiles(root, ['**/*.html'], 'my');
    expect(result).toEqual(new Set(['arrow', 'star']));
  });

  test('finds bare fragment references', () => {
    const root = mkdtempSync(join(tmpdir(), 'sprite-test-'));
    writeFileSync(join(root, 'page.html'), `<svg><use href="#pfx-home"/></svg>`);
    const result = scanSourceFiles(root, ['**/*.html'], 'pfx');
    expect(result).toEqual(new Set(['home']));
  });

  test('finds references in JS/TS files', () => {
    const root = mkdtempSync(join(tmpdir(), 'sprite-test-'));
    mkdirSync(join(root, 'js'));
    writeFileSync(
      join(root, 'js', 'app.ts'),
      `el.setAttribute('href', '#my-check');
       // #my-plus is also used`,
    );
    const result = scanSourceFiles(root, ['js/*.ts'], 'my');
    expect(result).toEqual(new Set(['check', 'plus']));
  });

  test('skips node_modules and dist', () => {
    const root = mkdtempSync(join(tmpdir(), 'sprite-test-'));
    // File in node_modules — should be skipped
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.html'), `<use href="#my-hidden"/>`);
    // File in dist — should be skipped
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'index.html'), `<use href="#my-also-hidden"/>`);
    // File in root — should be found
    writeFileSync(join(root, 'index.html'), `<use href="#my-visible"/>`);
    const result = scanSourceFiles(root, ['**/*.html'], 'my');
    expect(result).toEqual(new Set(['visible']));
  });
});

// ---------------------------------------------------------------------------
// BuildSymbol
// ---------------------------------------------------------------------------

describe('buildSymbol', () => {
  test('extracts viewBox and inner content', () => {
    const svg = '<svg viewBox="0 0 48 48"><path d="M0 0"/></svg>';
    const result = buildSymbol('arrow', svg, 'my', { path: 'arrow.svg' });
    expect(result).toBe('<symbol id="my-arrow" viewBox="0 0 48 48"><path d="M0 0"/></symbol>');
  });

  test('applies symbolAttrs from resolution', () => {
    const svg = '<svg viewBox="0 0 24 24"><circle r="1"/></svg>';
    const result = buildSymbol('star', svg, 'ico', {
      path: 'star.svg',
      symbolAttrs: { fill: 'none', stroke: 'currentColor' },
    });
    expect(result).toContain('fill="none"');
    expect(result).toContain('stroke="currentColor"');
    expect(result).toContain('id="ico-star"');
  });

  test('applies transformContent callback', () => {
    const svg = '<svg viewBox="0 0 24 24"><rect/><path d="M1"/></svg>';
    const result = buildSymbol('clean', svg, 'my', { path: 'clean.svg' }, (inner) =>
      inner.replace(/<rect\/>/, ''),
    );
    expect(result).not.toContain('<rect/>');
    expect(result).toContain('<path d="M1"/>');
  });

  test('defaults viewBox to 0 0 24 24 when missing', () => {
    const svg = '<svg><path d="M5"/></svg>';
    const result = buildSymbol('noview', svg, 'my', { path: 'noview.svg' });
    expect(result).toContain('viewBox="0 0 24 24"');
  });
});

// ---------------------------------------------------------------------------
// RewriteHtml
// ---------------------------------------------------------------------------

describe('rewriteHtml', () => {
  test('removes placeholder filename from hrefs', () => {
    const html = '<body><svg><use href="sprite.svg#my-arrow"/></svg></body>';
    const result = rewriteHtml(html, 'sprite.svg', '<symbol id="my-arrow"/>');
    expect(result).toContain('href="#my-arrow"');
    expect(result).not.toContain('sprite.svg');
  });

  test('injects sprite after body tag', () => {
    const html = '<body><div>content</div></body>';
    const sprite = '<symbol id="my-arrow"/>';
    const result = rewriteHtml(html, 'sprite.svg', sprite);
    expect(result).toContain(
      '<body><svg xmlns="http://www.w3.org/2000/svg" style="display:none"><symbol id="my-arrow"/></svg>',
    );
  });

  test('handles body with attributes', () => {
    const html = '<body class="dark"><div/></body>';
    const sprite = '<symbol id="x"/>';
    const result = rewriteHtml(html, 'sprite.svg', sprite);
    expect(result).toContain(
      '<body class="dark"><svg xmlns="http://www.w3.org/2000/svg" style="display:none"><symbol id="x"/></svg>',
    );
  });

  test('rewrites multiple hrefs', () => {
    const html =
      '<body>' +
      '<use href="icons.svg#p-a"/>' +
      '<use href="icons.svg#p-b"/>' +
      '<use href="icons.svg#p-c"/>' +
      '</body>';
    const result = rewriteHtml(html, 'icons.svg', '');
    expect(result).toContain('href="#p-a"');
    expect(result).toContain('href="#p-b"');
    expect(result).toContain('href="#p-c"');
    expect(result).not.toContain('icons.svg');
  });

  test('leaves bare fragment references unchanged', () => {
    const html = '<body><use href="#p-c"/></body>';
    const result = rewriteHtml(html, 'icons.svg', '');
    expect(result).toContain('href="#p-c"');
  });
});
