import { watch, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import pkg from './package.json';

async function getVersionComment(): Promise<string> {
  const sha = (await Bun.$`git rev-parse --short HEAD`.text()).trim();
  return `<!-- spatch v${pkg.version} (${sha}) -->`;
}

const isDev = process.argv.includes('--dev');
const shouldWatch = process.argv.includes('--watch');
const shouldServe = process.argv.includes('--serve');

const TABLER_ICONS = 'node_modules/@tabler/icons/icons';

function checkDependencies() {
  if (!existsSync(TABLER_ICONS)) {
    console.error('Error: node_modules not installed. Run `bun install` first.');
    process.exit(1);
  }
}

// Scan source files for tabler-sprite.svg#tabler-{name} references and build
// a minimal SVG sprite containing only the icons actually used.
async function generateTablerSprite() {
  // Scan all HTML, TS, and JS source files for icon references
  const sourceGlobs = ['*.html', 'js/**/*.ts', 'js/**/*.js'];
  const refs = new Set<string>();
  const pattern = /tabler-sprite\.svg#tabler-([\w-]+)/g;

  for (const glob of sourceGlobs) {
    const files = new Bun.Glob(glob).scanSync('.');
    for (const file of files) {
      if (file.includes('node_modules')) continue;
      const content = readFileSync(file, 'utf-8');
      for (const match of content.matchAll(pattern)) {
        refs.add(match[1]!);
      }
    }
  }

  if (refs.size === 0) {
    console.warn('Warning: no tabler icon references found in source files');
    return;
  }

  // Resolve each reference to an individual SVG file and convert to <symbol>
  const symbols: string[] = [];
  const missing: string[] = [];
  for (const name of [...refs].sort()) {
    // Check if it's a filled variant (name ends with -filled, file is in filled/ without suffix)
    const isFilled = name.endsWith('-filled');
    const baseName = isFilled ? name.slice(0, -7) : name;
    const dir = isFilled ? 'filled' : 'outline';
    const svgPath = join(TABLER_ICONS, dir, `${baseName}.svg`);

    const file = Bun.file(svgPath);
    if (!(await file.exists())) {
      missing.push(name);
      continue;
    }

    const svg = await file.text();

    // Extract attributes from the <svg> tag for the <symbol>
    const attrsMatch = svg.match(/<svg\s([^>]+)>/s);
    if (!attrsMatch) continue;
    const attrs = attrsMatch[1]!;

    // Extract viewBox
    const viewBox = attrs.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24';

    // Carry over fill/stroke attributes from the source SVG
    const symbolAttrs: string[] = [`id="tabler-${name}"`, `viewBox="${viewBox}"`];
    if (isFilled) {
      symbolAttrs.push('fill="currentColor"');
    } else {
      symbolAttrs.push('fill="none"', 'stroke="currentColor"', 'stroke-width="2"');
      symbolAttrs.push('stroke-linecap="round"', 'stroke-linejoin="round"');
    }

    // Extract inner content (everything between <svg> and </svg>), stripping
    // the transparent bounding-box path that Tabler includes in every icon
    const inner = svg
      .replace(/<svg[^>]*>/, '')
      .replace(/<\/svg>/, '')
      .replace(/<path\s+stroke="none"\s+d="M0 0h24v24H0z"\s+fill="none"\s*\/?>/, '')
      .trim();

    symbols.push(`<symbol ${symbolAttrs.join(' ')}>${inner}</symbol>`);
  }

  if (missing.length > 0) {
    console.error(`Error: ${missing.length} icon(s) not found: ${missing.join(', ')}`);
    process.exit(1);
  }

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
  await Bun.write('dist/tabler-sprite.svg', sprite);
  console.log(`  Generated tabler-sprite.svg (${refs.size} icons, ${sprite.length} bytes)`);
}

async function build() {
  checkDependencies();
  await Bun.$`rm -rf dist`;

  // Scan scene images so we can inject the list as a build-time constant
  const sceneDir = 'img/scene';
  const sceneGlob = new Bun.Glob('*.jpg');
  const sceneFiles = [...sceneGlob.scanSync(sceneDir)].sort();

  // Build HTML entry points — Bun's HTML loader handles script tag rewriting,
  // asset hashing, CSS bundling, and copying automatically.
  const htmlResult = await Bun.build({
    entrypoints: ['./index.html', './embed.html'],
    outdir: './dist',
    minify: !isDev,
    sourcemap: 'external',
    target: 'browser',
    naming: {
      entry: '[name].[ext]',
      chunk: '[name]-[hash].[ext]',
      asset: '[name]-[hash].[ext]',
    },
    define: {
      __SCENE_IMAGES__: JSON.stringify(sceneFiles.map((f) => `img/scene/${f}`)),
    },
  });

  if (!htmlResult.success) {
    console.error('Build failed:');
    for (const log of htmlResult.logs) {
      console.error(log);
    }
    return false;
  }

  // Inject version comment into each HTML output
  const versionComment = await getVersionComment();
  for (const output of htmlResult.outputs) {
    if (output.path.endsWith('.html')) {
      const html = await Bun.file(output.path).text();
      await Bun.write(output.path, html + '\n' + versionComment);
    }
  }

  // Auto-generate SVG sprite from icon usage. Scan source HTML files for
  // tabler-sprite.svg#tabler-{name} references, then assemble a sprite
  // containing only the icons actually used.
  await generateTablerSprite();

  // Copy scene images to dist
  const sceneOut = 'dist/img/scene';
  await Bun.$`mkdir -p ${sceneOut}`;
  for (const file of sceneFiles) {
    await Bun.$`cp ${sceneDir}/${file} ${sceneOut}/${file}`;
  }
  console.log(`  Copied ${sceneFiles.length} scene images to ${sceneOut}/`);

  const totalOutputs = htmlResult.outputs.length;
  console.log(`Build complete: ${totalOutputs} files written to dist/`);
  for (const output of htmlResult.outputs) {
    const size = output.size < 1024 ? `${output.size} B` : `${(output.size / 1024).toFixed(1)} KB`;
    console.log(`  ${output.path} (${size})`);
  }
  return true;
}

// Initial build
const ok = await build();
if (!ok && !shouldWatch) process.exit(1);

if (shouldServe) {
  const PORT = 3000;
  Bun.serve({
    port: PORT,
    async fetch(req) {
      let pathname = new URL(req.url).pathname;
      if (pathname === '/') pathname = '/index.html';
      const file = Bun.file(join('dist', pathname));
      if (await file.exists()) return new Response(file);
      return new Response('Not found', { status: 404 });
    },
  });
  console.log(`\nDev server running at http://localhost:${PORT}`);
}

if (shouldWatch) {
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  const dirs = ['js', 'css'];

  for (const dir of dirs) {
    watch(dir, { recursive: true }, () => {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(async () => {
        console.log('\nRebuilding...');
        await build();
      }, 100);
    });
  }

  // Also watch root HTML files
  watch('.', { recursive: false }, (_event, filename) => {
    if (filename && filename.endsWith('.html')) {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(async () => {
        console.log('\nRebuilding...');
        await build();
      }, 100);
    }
  });

  console.log('Watching for changes in js/, css/, and *.html...');
}
