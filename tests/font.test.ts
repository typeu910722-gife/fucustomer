// The UI font is cut down to the characters the game uses (scripts/font-subset.py). New text must be added to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
const skip = (c: number) => c <= 0x7f || (c >= 0x1f000 && c <= 0x1ffff) || (c >= 0x2600 && c <= 0x27bf) || c === 0xfe0f || c === 0x200d;

test('every character in the game text is in the font subset', () => {
  const have = new Set(readFileSync(path.join(ROOT, 'scripts/font-chars.txt'), 'utf8'));
  const files = [...walk(path.join(ROOT, 'client/src')), ...walk(path.join(ROOT, 'shared')), path.join(ROOT, 'client/index.html')];
  const missing = new Set<string>();
  for (const f of files) for (const ch of readFileSync(f, 'utf8')) if (!skip(ch.codePointAt(0)!) && !have.has(ch)) missing.add(ch);
  assert.equal([...missing].join(''), '', 'run: python3 scripts/font-subset.py');
});
