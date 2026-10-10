// Vitest 3.2 keeps a 60s birpc timeout on worker calls. A research game that
// runs about that long makes "onTaskUpdate" time out after the test has passed,
// and Vitest then exits 1. Vitest 4 disables that timer (vitest-dev/vitest#8297).
// This applies the same one-line change before `vitest run`. Re-running is safe.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'node_modules/vitest/dist/chunks');
const from = 'const DEFAULT_TIMEOUT = 6e4;';
const to = 'const DEFAULT_TIMEOUT = -1;';
let patched = 0;
let already = 0;

for (const name of readdirSync(dir)) {
  if (!name.endsWith('.js')) continue;
  const path = join(dir, name);
  const source = readFileSync(path, 'utf8');
  if (source.includes(to) && source.includes('function createBirpc')) {
    already++;
    continue;
  }
  if (!source.includes(from) || !source.includes('function createBirpc')) continue;
  writeFileSync(path, source.replace(from, to));
  patched++;
}

if (patched === 0 && already === 0) {
  console.error('patch-vitest-rpc: birpc DEFAULT_TIMEOUT was not found in', dir);
  process.exit(1);
}
