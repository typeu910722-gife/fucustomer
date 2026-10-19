// Balance report: a simulated player at each chapter's expected level/skills/gear plays every shift.
import { Room } from './shared/room.ts';
import { Bot, botMessages } from './shared/bot.ts';
import { shiftPay, payTotal } from './shared/career.ts';
import { CHAPTERS, buildShiftConfig, buildDailyConfig, dailyPlan, newProfile, starsFor, GEAR_IDS, ENDLESS_ID, ShiftConfig } from './shared/career.ts';
const SEEDS = Number(process.env.SEEDS ?? 4);
function profileFor(ch: number, level: number) {
  const p = newProfile(); p.level = level;
  const pts = level - 1; p.skills = { service: Math.ceil(pts / 3), body: Math.floor(pts / 3), crisis: pts - Math.ceil(pts / 3) - Math.floor(pts / 3) };
  for (const g of GEAR_IDS) p.gear[g] = Math.min(3, Math.floor((ch - 1) * 0.6));
  return p;
}
function play(id: string | ShiftConfig, prof: ReturnType<typeof newProfile>, seed: number, maxT: number) {
  let t = 0; const room = new Room('S', null, { solo: true, now: () => t, shift: typeof id === 'string' ? buildShiftConfig(prof, id) : id, seed });
  const c: any = { snap: null, send(m: any) { if (m.type === 'snap') c.snap = m.s; if (m.type === 'welcome') c.pid = m.playerId; }, close() {} };
  room.join(c, 'bot', undefined); room.startGame();
  const bot = new Bot('any', 0.3); let rid = 0;
  for (let s = 0; s < maxT; s += 0.05) {
    t += 50; room.update(0.05); const sn = c.snap; if (!sn) continue; if (sn.result) break;
    const o = bot.update(sn, sn.players[0], 0.05);
    for (const m of botMessages(o, () => 'r' + rid++)) room.handle(c.pid, m);
  }
  if (!room.world!.result) room.handle(c.pid, { type: 'endShift' });
  return room.world!.result!;
}
const only = process.argv[2];
for (const ch of CHAPTERS) for (const sh of ch.shifts) {
  if (only && !sh.id.startsWith(only)) continue;
  const prof = profileFor(ch.n, ch.minLevel + 2);
  const rs = Array.from({ length: SEEDS }, (_, i) => play(sh.id, prof, i + 1, sh.length + 60));
  const avg = rs.reduce((a, r) => a + r.revenue, 0) / rs.length;
  const wins = rs.filter(r => r.won).length;
  const st = rs.map(r => starsFor(r)).join('');
  const fails = rs.filter(r => !r.won).map(r => r.failReason).join(' / ');
  const pay = rs.reduce((a, r) => a + payTotal(shiftPay(ch.n, r, starsFor(r))), 0) / rs.length;
  console.log(`${sh.id.padEnd(4)} goal ${String(sh.goal).padStart(4)} avg ${avg.toFixed(0).padStart(4)} (${(avg / sh.goal).toFixed(2)}x) win ${wins}/${rs.length} pay $${pay.toFixed(0)} stars ${st} chaos ${rs.map(r => r.chaos).join(',')} ${sh.boss ? 'boss:' + rs.map(r => r.bossDefeated ? 'Y' : 'N').join('') : ''} ${fails}`);
}
if (!only || only === 'endless') {
  const r = play(ENDLESS_ID, profileFor(7, 30), 1, 900);
  console.log('endless score', r.score, 'survived', r.survived, r.failReason);
}
if (!only || only === 'daily') {
  // daily challenge for a mid-game player (chapters 1-3 cleared, Lv18) over two weeks of dates
  const prof = profileFor(4, 18);
  for (const c of CHAPTERS.slice(0, 3)) for (const sh of c.shifts) prof.stars[sh.id] = 2;
  for (let d = 1; d <= 14; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`;
    const cfg = buildDailyConfig(prof, date), plan = dailyPlan(prof, date);
    const rs = Array.from({ length: SEEDS }, (_, i) => play(cfg, prof, i + 1, cfg.length + 60));
    const avg = rs.reduce((a, r) => a + r.revenue, 0) / rs.length;
    console.log(`daily ${date} ch${plan.difficulty} ${plan.mods.join('+').padEnd(18)} goal ${String(cfg.goal).padStart(4)} avg ${avg.toFixed(0).padStart(4)} (${(avg / cfg.goal).toFixed(2)}x) win ${rs.filter(r => r.won).length}/${rs.length}`);
  }
}
