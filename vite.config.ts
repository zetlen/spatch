import { resolve } from 'path';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { type HtmlTagDescriptor, type Plugin, defineConfig } from 'vite';
import svgSpritePlugin from './scripts/vite-plugin-svg-sprite';

// ---------------------------------------------------------------------------
// Scene images (resolved at config time)
// ---------------------------------------------------------------------------

const sceneFiles = readdirSync(resolve(import.meta.dirname, 'img/scene'))
  .filter((f) => f.endsWith('.jpg'))
  .toSorted();

// ---------------------------------------------------------------------------
// SpatchHtmlPlugin — analytics injection, version stamp, scene image copy
// ---------------------------------------------------------------------------

function spatchPlugin(): Plugin {
  const sceneImagePaths = sceneFiles.map((f) => `/img/scene/${f}`);

  return {
    closeBundle() {
      try {
        const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'));
        const { version } = pkg;
        const sha = execSync('git rev-parse --short HEAD', {
          encoding: 'utf8',
        }).trim();

        const distDir = resolve(import.meta.dirname, 'dist');
        const htmlFiles = readdirSync(distDir).filter((f) => f.endsWith('.html'));

        for (const file of htmlFiles) {
          const filePath = resolve(distDir, file);
          const content = readFileSync(filePath, 'utf8');
          writeFileSync(filePath, content + `\n<!-- spatch v${version} (${sha}) -->`);
        }
      } catch {
        // Non-fatal — version stamp is best-effort
      }
    },

    load(id) {
      if (id === '\0virtual:scene-images') {
        return `export default ${JSON.stringify(sceneImagePaths)}`;
      }
    },

    name: 'spatch',

    resolveId(id) {
      if (id === 'virtual:scene-images') {
        return '\0virtual:scene-images';
      }
    },

    transformIndexHtml: {
      handler(html) {
        const url = process.env.VITE_UMAMI_URL;
        const siteId = process.env.VITE_UMAMI_SITE_ID;

        const tags: HtmlTagDescriptor[] = [];

        if (url && siteId) {
          tags.push({
            attrs: {
              'data-website-id': siteId,
              defer: true,
              src: url,
            },
            injectTo: 'head',
            tag: 'script',
          });
        }

        return { html, tags };
      },
      order: 'post' as const,
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
  };
}

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------

export default defineConfig(({ mode }) => ({
  define: {
    __VIBE_DEBUG__: String(mode !== 'production'),
  },

  build: {
    rollupOptions: {
      input: {
        embed: resolve(import.meta.dirname, 'embed.html'),
        main: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },

  server: {
    allowedHosts: true,
    host: true,
  },

  plugins: [
    svgSpritePlugin({
      iconsDir: 'node_modules/@tabler/icons/icons',
      placeholder: 'tabler-sprite.svg',
      prefix: 'tabler',
      resolve: (name) => {
        const isFilled = name.endsWith('-filled');
        const base = isFilled ? name.slice(0, -7) : name;
        const dir = isFilled ? 'filled' : 'outline';
        const symbolAttrs: Record<string, string> = isFilled
          ? { fill: 'currentColor' }
          : {
              fill: 'none',
              stroke: 'currentColor',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              'stroke-width': '2',
            };
        return { path: `${dir}/${base}.svg`, symbolAttrs };
      },
      sourceGlobs: ['*.html', 'js/**/*.ts', 'js/**/*.js'],
      transformContent: (inner) =>
        inner.replace(/<path\s+stroke="none"\s+d="M0 0h24v24H0z"\s+fill="none"\s*\/?>/, '').trim(),
    }),

    spatchPlugin(),
  ],
}));
