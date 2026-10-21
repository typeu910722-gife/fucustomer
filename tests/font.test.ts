// The UI font is cut down to the characters the game uses and split in two (scripts/font-subset.py): a small
// menu file (preloaded) and a game file the browser fetches only when needed (unicode-range). New text must be added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { menuText } from '../scripts/font-menu-text.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIX = 'run: python3 scripts/font-subset.py';
const MENU_FONT_BUDGET_KB = 175; // first-load font (was 298 KB as one file); measured ≈ 140 KB in round 27
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
const skip = (c: number) => c <= 0x7f || (c >= 0x1f000 && c <= 0x1ffff) || (c >= 0x2600 && c <= 0x27bf) || c === 0xfe0f || c === 0x200d;
const all = new Set(readFileSync(path.join(ROOT, 'scripts/font-chars.txt'), 'utf8'));
const menu = new Set(readFileSync(path.join(ROOT, 'scripts/font-menu-chars.txt'), 'utf8'));
const html = readFileSync(path.join(ROOT, 'client/index.html'), 'utf8');

/** The two generated @font-face rules: file, ?v= hash and unicode-range (as code point intervals). */
function faces() {
  return [...html.matchAll(/@font-face \{ font-family: "Huninn"; src: url\("fonts\/(huninn-\w+\.woff2)\?v=(\w+)"\)[^}]*unicode-range: ([^;]+);/g)].map(m => ({
    file: m[1], hash: m[2],
    ranges: m[3].split(',').map(r => { const [a, b] = r.trim().replace(/^U\+/, '').split('-'); return [parseInt(a, 16), parseInt(b ?? a, 16)] as [number, number]; }),
  }));
}
const covers = (ranges: [number, number][], cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);

test('every character in the game text is in the font subset', () => {
  const files = [...walk(path.join(ROOT, 'client/src')), ...walk(path.join(ROOT, 'shared')), path.join(ROOT, 'client/index.html')];
  const missing = new Set<string>();
  for (const f of files) for (const ch of readFileSync(f, 'utf8')) if (!skip(ch.codePointAt(0)!) && !all.has(ch)) missing.add(ch);
  assert.equal([...missing].join(''), '', FIX);
});

test('everything the main menu / settings / licence card can show is in the small menu font file', () => {
  const { strings, missing: gone } = menuText();
  assert.deepEqual(gone, [], 'scripts/font-menu-text.ts MENU_SOURCES names a file / function that no longer exists');
  const missing = new Set<string>();
  for (const s of strings) for (const ch of s) if (!skip(ch.codePointAt(0)!) && !menu.has(ch)) missing.add(ch);
  assert.equal([...missing].join(''), '', FIX);
  for (const ch of menu) assert.ok(all.has(ch), `menu character ${ch} missing from font-chars.txt`);
});

test('index.html: two @font-face rules with disjoint unicode-ranges that match the font files', () => {
  const f = faces();
  assert.deepEqual(f.map(x => x.file), ['huninn-menu.woff2', 'huninn-game.woff2'], FIX);
  const [m, g] = f;
  for (const ch of all) {
    const cp = ch.codePointAt(0)!;
    const inM = covers(m.ranges, cp), inG = covers(g.ranges, cp);
    assert.ok(inM !== inG, `${ch} must be in exactly one unicode-range (menu ${inM}, game ${inG}) — ${FIX}`);
    assert.equal(inM, menu.has(ch), `${ch}: unicode-range and font-menu-chars.txt disagree — ${FIX}`);
  }
  for (let cp = 0x20; cp < 0x7f; cp++) assert.ok(covers(m.ranges, cp), 'ASCII belongs to the menu file');
  for (const x of f) {
    const bytes = readFileSync(path.join(ROOT, 'client/public/fonts', x.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 10), x.hash, `${x.file} changed but index.html wasn't regenerated — ${FIX}`);
  }
  // only the menu file is preloaded (the game file would otherwise be on the first-load path)
  const pre = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map(x => x[1]);
  assert.deepEqual(pre, [`fonts/huninn-menu.woff2?v=${m.hash}`]);
  assert.ok(!/fonts\/huninn\.woff2/.test(html), 'old single font file still referenced');
});

test(`menu font file stays small (≤ ${MENU_FONT_BUDGET_KB} KB)`, () => {
  const kb = statSync(path.join(ROOT, 'client/public/fonts/huninn-menu.woff2')).size / 1024;
  const game = statSync(path.join(ROOT, 'client/public/fonts/huninn-game.woff2')).size / 1024;
  console.log(`menu font ${kb.toFixed(1)} KB, game font ${game.toFixed(1)} KB`);
  assert.ok(kb <= MENU_FONT_BUDGET_KB, `huninn-menu.woff2 is ${kb.toFixed(0)} KB`);
});
