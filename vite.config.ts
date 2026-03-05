import { resolve } from 'path';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import type { Plugin, HtmlTagDescriptor } from 'vite';
import { defineConfig } from 'vite';
import svgSpritePlugin from './scripts/vite-plugin-svg-sprite';

// ---------------------------------------------------------------------------
// Scene images (resolved at config time)
// ---------------------------------------------------------------------------

const sceneFiles = readdirSync(resolve(import.meta.dirname, 'img/scene'))
  .filter((f) => f.endsWith('.jpg'))
  .sort();

// ---------------------------------------------------------------------------
// spatchHtmlPlugin — analytics injection, version stamp, scene image copy
// ---------------------------------------------------------------------------

function spatchPlugin(): Plugin {
  const sceneImagePaths = sceneFiles.map((f) => `/img/scene/${f}`);

  return {
    name: 'spatch',

    resolveId(id) {
      if (id === 'virtual:scene-images') return '\0virtual:scene-images';
    },

    load(id) {
      if (id === '\0virtual:scene-images') {
        return `export default ${JSON.stringify(sceneImagePaths)}`;
      }
    },

    transformIndexHtml: {
      order: 'post' as const,
      handler(html) {
        const url = process.env.VITE_UMAMI_URL;
        const siteId = process.env.VITE_UMAMI_SITE_ID;

        const tags: HtmlTagDescriptor[] = [];

        if (url && siteId) {
          tags.push({
            tag: 'script',
            attrs: {
              defer: true,
              src: url,
              'data-website-id': siteId,
            },
            injectTo: 'head',
          });
        }

        return { html, tags };
      },
    },

    writeBundle(options) {
      // Copy scene images to dist/img/scene/
      const outDir = resolve(options.dir ?? 'dist', 'img', 'scene');
      mkdirSync(outDir, { recursive: true });

      const sceneDir = resolve(import.meta.dirname, 'img/scene');
      for (const file of sceneFiles) {
        copyFileSync(resolve(sceneDir, file), resolve(outDir, file));
      }
      console.log(`Copied ${sceneFiles.length} scene image(s) to ${outDir}/`);
    },

    closeBundle() {
      try {
        const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'));
        const version = pkg.version;
        const sha = execSync('git rev-parse --short HEAD', {
          encoding: 'utf-8',
        }).trim();

        const distDir = resolve(import.meta.dirname, 'dist');
        const htmlFiles = readdirSync(distDir).filter((f) => f.endsWith('.html'));

        for (const file of htmlFiles) {
          const filePath = resolve(distDir, file);
          const content = readFileSync(filePath, 'utf-8');
          writeFileSync(filePath, content + `\n<!-- spatch v${version} (${sha}) -->`);
        }
      } catch {
        // Non-fatal — version stamp is best-effort
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        embed: resolve(import.meta.dirname, 'embed.html'),
      },
    },
  },

  plugins: [
    svgSpritePlugin({
      iconsDir: 'node_modules/@tabler/icons/icons',
      prefix: 'tabler',
      placeholder: 'tabler-sprite.svg',
      sourceGlobs: ['*.html', 'js/**/*.ts', 'js/**/*.js'],
      resolve: (name) => {
        const isFilled = name.endsWith('-filled');
        const base = isFilled ? name.slice(0, -7) : name;
        const dir = isFilled ? 'filled' : 'outline';
        const symbolAttrs: Record<string, string> = isFilled
          ? { fill: 'currentColor' }
          : {
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '2',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            };
        return { path: `${dir}/${base}.svg`, symbolAttrs };
      },
      transformContent: (inner) =>
        inner.replace(/<path\s+stroke="none"\s+d="M0 0h24v24H0z"\s+fill="none"\s*\/?>/, '').trim(),
    }),

    spatchPlugin(),
  ],
});
