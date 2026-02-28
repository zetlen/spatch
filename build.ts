const isDev = process.argv.includes("--dev");

// Clean dist
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
  process.exit(1);
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
  process.exit(1);
}

// Summary
const totalOutputs = htmlResult.outputs.length + workletResult.outputs.length;
console.log(`Build complete: ${totalOutputs} files written to dist/`);
for (const output of [...htmlResult.outputs, ...workletResult.outputs]) {
  const size = output.size < 1024
    ? `${output.size} B`
    : `${(output.size / 1024).toFixed(1)} KB`;
  console.log(`  ${output.path} (${size})`);
}
