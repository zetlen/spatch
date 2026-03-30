import { existsSync, globSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { Plugin } from 'vite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IconResolution {
  /** Relative path within iconsDir to the SVG file */
  path: string;
  /** Attributes to set on the <symbol> element (in addition to id and viewBox) */
  symbolAttrs?: Record<string, string>;
}

export interface SvgSpriteOptions {
  /** Base directory containing individual SVG files */
  iconsDir: string;
  /** Prefix used in #{prefix}-{name} references (e.g. 'tabler') */
  prefix: string;
  /** Placeholder filename in source href attributes (e.g. 'tabler-sprite.svg').
   *  Removed from hrefs at build time so references become same-document fragments. */
  placeholder: string;
  /** Glob patterns for source files to scan for icon references.
   *  Relative to Vite root. Defaults to ['**\/*.html', '**\/*.ts', '**\/*.js']. */
  sourceGlobs?: string[];
  /** Maps an icon name to its path within iconsDir and symbol attributes. */
  resolve: (name: string) => IconResolution;
  /** Optional transform applied to SVG inner content before wrapping in <symbol>. */
  transformContent?: (innerSvg: string, name: string) => string;
}

// ---------------------------------------------------------------------------
// Exported helpers (for unit testing)
// ---------------------------------------------------------------------------

/**
 * Scan source files for `#{prefix}-{name}` references and return the set of
 * icon names (without the prefix).
 */
export function scanSourceFiles(root: string, globs: string[], prefix: string): Set<string> {
  const names = new Set<string>();
  const pattern = new RegExp(`#${escapeRegExp(prefix)}-([\\w-]+)`, 'g');

  for (const glob of globs) {
    const files = globSync(glob, { cwd: root });
    for (const file of files) {
      if (file.includes('node_modules') || file.includes('dist')) {
        continue;
      }
      const content = readFileSync(join(root, file), 'utf8');
      for (const match of content.matchAll(pattern)) {
        names.add(match[1]!);
      }
    }
  }

  return names;
}

/**
 * Build a `<symbol>` element from an individual SVG file's content.
 *
 * - Extracts `viewBox` from the `<svg>` tag (defaults to `0 0 24 24`).
 * - Strips the outer `<svg>` wrapper, keeping only inner content.
 * - Applies `transformContent` callback if provided.
 * - Merges `resolution.symbolAttrs` onto the `<symbol>`.
 */
export function buildSymbol(
  name: string,
  svgContent: string,
  prefix: string,
  resolution: IconResolution,
  transformContent?: (inner: string, name: string) => string,
): string {
  // Extract viewBox from the <svg> tag
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch?.[1] ?? '0 0 24 24';

  // Strip outer <svg> wrapper, keep inner content
  let inner = svgContent
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();

  // Apply optional transform
  if (transformContent) {
    inner = transformContent(inner, name);
  }

  // Build attribute string
  const attrs: string[] = [`id="${prefix}-${name}"`, `viewBox="${viewBox}"`];

  if (resolution.symbolAttrs) {
    for (const [key, value] of Object.entries(resolution.symbolAttrs)) {
      attrs.push(`${key}="${value}"`);
    }
  }

  return `<symbol ${attrs.join(' ')}>${inner}</symbol>`;
}

/**
 * Rewrite HTML to inline the SVG sprite:
 * 1. Replace `href="${placeholder}#` with `href="#` so `<use>` elements
 *    reference same-document fragment IDs.
 * 2. Inject the sprite SVG (hidden) after the opening `<body>` tag.
 */
export function rewriteHtml(html: string, placeholder: string, spriteSvg: string): string {
  // Replace placeholder references with same-document fragments.
  // Vite dev server may resolve relative paths to absolute (adding leading /),
  // So match an optional slash before the placeholder filename.
  const placeholderPattern = new RegExp(`href="/?${escapeRegExp(placeholder)}#`, 'g');
  let result = html.replace(placeholderPattern, 'href="#');

  // Inject sprite after <body...>
  const hiddenSprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${spriteSvg}</svg>`;
  result = result.replace(/(<body[^>]*>)/, `$1${hiddenSprite}`);

  return result;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export default function svgSpritePlugin(options: SvgSpriteOptions): Plugin {
  const {
    iconsDir,
    prefix,
    placeholder,
    sourceGlobs = ['**/*.html', '**/*.ts', '**/*.js'],
    resolve: resolveIcon,
    transformContent,
  } = options;

  let root = '';
  let cachedSprite = '';

  return {
    buildStart() {
      const resolvedIconsDir = resolve(root, iconsDir);

      // Validate iconsDir exists
      if (!existsSync(resolvedIconsDir)) {
        this.error(`SVG sprite plugin: iconsDir does not exist: ${resolvedIconsDir}`);
      }

      // Scan source files for icon references
      const names = scanSourceFiles(root, sourceGlobs, prefix);

      if (names.size === 0) {
        this.warn('SVG sprite plugin: no icon references found in source files');
        cachedSprite = '';
        return;
      }

      // Resolve each icon and build symbols
      const symbols: string[] = [];
      const missing: string[] = [];

      for (const name of [...names].toSorted()) {
        const resolution = resolveIcon(name);
        const svgPath = join(resolvedIconsDir, resolution.path);

        if (!existsSync(svgPath)) {
          missing.push(name);
          continue;
        }

        const svgContent = readFileSync(svgPath, 'utf8');
        symbols.push(buildSymbol(name, svgContent, prefix, resolution, transformContent));
      }

      if (missing.length > 0) {
        this.error(`SVG sprite plugin: ${missing.length} icon(s) not found: ${missing.join(', ')}`);
      }

      cachedSprite = symbols.join('');

      const byteSize = Buffer.byteLength(cachedSprite, 'utf8');
      const sizeStr = byteSize < 1024 ? `${byteSize} B` : `${(byteSize / 1024).toFixed(1)} KB`;
      console.log(`SVG sprite: ${names.size} icon(s), ${sizeStr}`);
    },

    configResolved(config) {
      ({ root } = config);
    },

    name: 'vite-plugin-svg-sprite',

    transformIndexHtml(html) {
      if (!cachedSprite) {
        return html;
      }
      return rewriteHtml(html, placeholder, cachedSprite);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
