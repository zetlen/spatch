#!/usr/bin/env bun
// Install fb-idb into .venv/ for iOS Simulator automation.
// Usage: bun run scripts/install-idb.ts
//        PYTHON=python3.14 bun run scripts/install-idb.ts   # override interpreter

import { $ } from 'bun';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (platform() !== 'darwin') {
  console.log('not running macos, so no reason to install fb-idb for ios debugging');
  process.exit(0);
}

const repoRoot = join(import.meta.dir, '..');
const venvDir = join(repoRoot, '.venv');
const python = process.env.PYTHON ?? 'python3';

if (!existsSync(venvDir)) {
  console.log(`creating venv at ${venvDir} (using ${python})`);
  await $`${python} -m venv ${venvDir}`;
}

const pip = join(venvDir, 'bin', 'pip');
await $`${pip} install --upgrade pip`;
await $`${pip} install ${'fb-idb>=1.1.7'}`;

const mainDef = `
def main(cmd_input: Optional[List[str]] = None) -> int:`;
const oldAsyncCode = `${mainDef}
    loop = asyncio.get_event_loop()`;

const newAsyncCode = `${mainDef}
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)`;

// fb-idb compatibility patch for modern Python — uncomment and fill in:
const patchFile = join(venvDir, 'lib/python3.14/site-packages/idb/cli/main.py');
const source = await Bun.file(patchFile).text();
const patched = source.replace(oldAsyncCode, newAsyncCode);
await Bun.write(patchFile, patched);

console.log(`\ndone. activate venv: source ${venvDir}/bin/activate`);
