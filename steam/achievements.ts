// Writes steam/achievements.csv: the achievement list to enter on the Steamworks site (same API names as the game).
// Usage: npx tsx steam/achievements.ts
import { writeFileSync, existsSync } from 'node:fs';
import { ACHIEVEMENTS } from '../shared/achievements.ts';
const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
const rows = [['API 名稱 (API Name)', '顯示名稱 (Name)', '說明 (Description)', '已達成圖示 (Achieved icon)', '未達成圖示 (Unachieved icon)', '隱藏 (Hidden)']];
for (const a of ACHIEVEMENTS) {
  const on = `store/steam/achievements/${a.id}.png`, off = `store/steam/achievements/${a.id}_locked.png`;
  if (!existsSync(on) || !existsSync(off)) throw new Error(`missing icon for ${a.id} — add it to store/src/steam-art.mjs (ACH) and re-run`);
  rows.push([a.id, a.name, a.desc, on, off, '否']);
}
writeFileSync('steam/achievements.csv', '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
console.log(`${ACHIEVEMENTS.length} achievements → steam/achievements.csv`);
