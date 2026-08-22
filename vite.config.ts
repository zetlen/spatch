import { resolve } from 'path';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { type HtmlTagDescriptor, type Plugin, defineConfig } from 'vite';
import type { NextHandleFunction } from 'connect';
import svgSpritePlugin from './scripts/vite-plugin-svg-sprite';

// ---------------------------------------------------------------------------
// SpatchHtmlPlugin — analytics injection, version stamp
// ---------------------------------------------------------------------------

function spatchPlugin(): Plugin {
  return {
    closeBundle() {
      try {
        const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'));
        const { version } = pkg;
        // Image builds have no .git; bin/release.sh passes the sha in.
        const sha =
          process.env.GIT_SHA ??
          execSync('git rev-parse --short HEAD', {
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

    name: 'spatch',

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
  };
}

// ---------------------------------------------------------------------------
// SPA fallback plugin — redirect unmatched paths to entry points
// ---------------------------------------------------------------------------

const spaRewrite: NextHandleFunction = (req, _res, next) => {
  // Rewrite known app routes to their HTML entry points.
  // Everything else (assets, Vite internals) passes through untouched.
  if (req.url?.startsWith('/embed/')) {
    req.url = '/embed.html';
  } else if (req.url?.startsWith('/s/')) {
    req.url = '/index.html';
  }
  next();
};

function spaFallbackPlugin(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use(spaRewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(spaRewrite);
    },
  };
}

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------

export default defineConfig((_env) => ({
  build: {
    rollupOptions: {
      input: {
        embed: resolve(import.meta.dirname, 'embed.html'),
        main: resolve(import.meta.dirname, 'index.html'),
      },
      output: {
        assetFileNames: '[hash][extname]',
      },
    },
  },

  server: {
    allowedHosts: true,
    host: true,
  },

  plugins: [
    spaFallbackPlugin(),

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
