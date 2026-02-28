import { watch } from "fs";
import { join } from "path";

const isDev = process.argv.includes("--dev");
const shouldWatch = process.argv.includes("--watch");
const shouldServe = process.argv.includes("--serve");

async function build() {
  await Bun.$`rm -rf dist`;

  // Build HTML entry points — Bun's HTML loader handles script tag rewriting,
  // asset hashing, CSS bundling, and copying automatically.
  const htmlResult = await Bun.build({
    entrypoints: ["./index.html", "./embed.html"],
    outdir: "./dist",
    minify: !isDev,
    sourcemap: "external",
    target: "browser",
    naming: {
      entry: "[name].[ext]",
      chunk: "[name]-[hash].[ext]",
      asset: "[name]-[hash].[ext]",
    },
  });

  if (!htmlResult.success) {
    console.error("Build failed:");
    for (const log of htmlResult.logs) {
      console.error(log);
    }
    return false;
  }

  // Build worklet separately — AudioWorklets must be loaded via addModule()
  // with a stable URL, so we build it as its own entry without hashing the name.
  const workletResult = await Bun.build({
    entrypoints: ["./js/worklets/bitcrusher.js"],
    outdir: "./dist/worklets",
    minify: !isDev,
    sourcemap: "external",
    target: "browser",
    naming: "[name].[ext]",
  });

  if (!workletResult.success) {
    console.error("Worklet build failed:");
    for (const log of workletResult.logs) {
      console.error(log);
    }
    return false;
  }

  const totalOutputs = htmlResult.outputs.length + workletResult.outputs.length;
  console.log(`Build complete: ${totalOutputs} files written to dist/`);
  for (const output of [...htmlResult.outputs, ...workletResult.outputs]) {
    const size = output.size < 1024
      ? `${output.size} B`
      : `${(output.size / 1024).toFixed(1)} KB`;
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
      if (pathname === "/") pathname = "/index.html";
      const file = Bun.file(join("dist", pathname));
      if (await file.exists()) return new Response(file);
      return new Response("Not found", { status: 404 });
    },
  });
  console.log(`\nDev server running at http://localhost:${PORT}`);
}

if (shouldWatch) {
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  const dirs = ["js", "css"];

  for (const dir of dirs) {
    watch(dir, { recursive: true }, () => {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(async () => {
        console.log("\nRebuilding...");
        await build();
      }, 100);
    });
  }

  // Also watch root HTML files
  watch(".", { recursive: false }, (_event, filename) => {
    if (filename && filename.endsWith(".html")) {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(async () => {
        console.log("\nRebuilding...");
        await build();
      }, 100);
    }
  });

  console.log("Watching for changes in js/, css/, and *.html...");
}
