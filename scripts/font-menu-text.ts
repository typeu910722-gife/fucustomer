// The text the main menu can show before the 3D game is loaded (title quotes, store notices, licence card, settings,
// first-run welcome, invite screen, next shift / daily / weekly lines, ranks and titles). scripts/font-subset.py puts
// these characters in the small first-load font file (fonts/huninn-menu.woff2); everything else goes in
// fonts/huninn-game.woff2, which the browser fetches only when a character from it is shown (unicode-range) or when
// the game is warmed up. tests/font.test.ts checks the menu subset covers all of this.
//   node --import tsx scripts/font-menu-text.ts   → JSON array of strings (used by font-subset.py)
// Adding a new main-menu screen? Add its file / function names to MENU_SOURCES below.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUOTES, NOTICES } from '../client/src/quotes.ts';
import { CHAPTERS, DAILY_MODS, RANKS } from '../shared/career.ts';
import { WEEKLY_TWISTS } from '../shared/weekly.ts';
import { MAPS } from '../shared/maps/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source files (whole) or top-level functions / consts in them whose text is shown on the menu screens. */
export const MENU_SOURCES: { file: string; whole?: boolean; blocks?: string[]; lines?: RegExp[] }[] = [
  { file: 'client/index.html', whole: true },
  { file: 'client/src/quotes.ts', whole: true },
  { file: 'client/src/account.ts', whole: true }, // Google sign-in / licence messages under the card
  { file: 'client/src/ui.ts', blocks: ['licenseHtml', 'mainMenu', 'settingsMenu', 'inviteScreen', 'friendLicenseScreen'] },
  { file: 'client/src/main.ts', blocks: ['menu', 'friendlyJoinError', 'playerName'], lines: [/^else menu\(/] },
];

/** A top-level `function name` / `const name` block: from its line to the closing `}` / `];` at column 0. */
export function sourceBlock(src: string, name: string): string | null {
  const lines = src.split('\n');
  const start = lines.findIndex(l => new RegExp(`^(export )?(async )?(function\\*? ${name}\\b|(const|let) ${name}\\b)`).test(l));
  if (start < 0) return null;
  const opens = (lines[start].match(/[{[(]/g) ?? []).length, closes = (lines[start].match(/[}\])]/g) ?? []).length;
  if (opens <= closes) return lines[start]; // one-liner
  let end = start + 1;
  while (end < lines.length && !/^[}\]]/.test(lines[end])) end++;
  return lines.slice(start, end + 1).join('\n');
}

/** Everything the menu may display, plus a list of configured blocks that weren't found (renamed?). */
export function menuText(): { strings: string[]; missing: string[] } {
  const strings: string[] = [], missing: string[] = [];
  for (const s of MENU_SOURCES) {
    let src: string;
    try { src = readFileSync(path.join(ROOT, s.file), 'utf8'); } catch { missing.push(s.file); continue; }
    if (s.whole) strings.push(src);
    for (const b of s.blocks ?? []) { const t = sourceBlock(src, b); if (t) strings.push(t); else missing.push(`${s.file}#${b}`); }
    for (const re of s.lines ?? []) { const hit = src.split('\n').filter(l => re.test(l)); if (hit.length) strings.push(...hit); else missing.push(`${s.file}${re}`); }
  }
  // data shown on the menu: quotes / notices, rank + title on the licence card, the next shift, daily & weekly lines
  strings.push(...QUOTES, ...NOTICES, ...RANKS.map(r => r.name));
  for (const c of CHAPTERS) for (const sh of c.shifts) strings.push(sh.id, sh.title);
  for (const m of MAPS) strings.push(m.name);
  for (const d of Object.values(DAILY_MODS)) strings.push(d.name);
  for (const w of Object.values(WEEKLY_TWISTS)) strings.push(w.name, w.badge);
  const career = readFileSync(path.join(ROOT, 'shared/career.ts'), 'utf8');
  for (const m of career.matchAll(/\btitle\s*=\s*'([^']+)'/g)) strings.push(m[1]); // earned titles (終極打工人…)
  return { strings, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(menuText()));
}
