import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FORBIDDEN_PROVIDER_MARKERS } from '../src/lib/tokenFree';

const roots = ['src', 'server', 'scripts'];
const allowedFiles = new Set([
  join('src', 'lib', 'tokenFree.ts'),
  join('scripts', 'verify-token-free.ts')
]);

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx|js|jsx|json)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const files = (await Promise.all(roots.map(walk))).flat();
const violations: string[] = [];

for (const file of files) {
  if (allowedFiles.has(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const marker of FORBIDDEN_PROVIDER_MARKERS) {
    if (text.includes(marker)) violations.push(`${file} contains forbidden hosted LLM marker ${marker}`);
  }
}

if (violations.length) {
  process.stderr.write(violations.join('\n'));
  process.exit(1);
}

process.stdout.write(`Token-free guard passed across ${files.length} runtime files.\n`);
