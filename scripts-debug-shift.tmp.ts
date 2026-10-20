import { Room } from './shared/room.ts';
import { Bot, botMessages } from './shared/bot.ts';
import { buildShiftConfig, newProfile, GEAR_IDS } from './shared/career.ts';
const id = process.argv[2], seed = Number(process.argv[3] ?? 2), lvl = Number(process.argv[4] ?? 30);
const p = newProfile(); p.level = lvl; const pts = lvl - 1; p.skills = { service: Math.ceil(pts / 3), body: Math.floor(pts / 3), crisis: pts - Math.ceil(pts / 3) - Math.floor(pts / 3) };
for (const g of GEAR_IDS) p.gear[g] = 3;
let t = 0; const room = new Room('S', null, { solo: true, now: () => t, shift: buildShiftConfig(p, id), seed });
const c: any = { snap: null, send(m: any) { if (m.type === 'snap') c.snap = m.s; if (m.type === 'welcome') c.pid = m.playerId; if (m.type === 'events') for (const e of m.list) if (e.e === 'toast') console.log(Math.round(t / 1000), e.text); }, close() {} };
room.join(c, 'bot', undefined); room.startGame();
const bot = new Bot('any', 0.3); let rid = 0;
for (let s = 0; s < 400; s += 0.05) {
  t += 50; room.update(0.05); const sn = c.snap; if (!sn) continue; if (sn.result) break;
  if (Math.round(s * 20) % 200 === 0) console.log(`  t=${s.toFixed(0)} chaos ${sn.chaos} spills ${sn.spills.length} rating ${sn.rating} cust ${sn.customers.length} karens ${sn.customers.filter((k: any) => k.kind !== 'normal' && !k.resolved).map((k: any) => k.kind + ':' + k.state).join(',')}`);
  for (const m of botMessages(bot.update(sn, sn.players[0], 0.05), () => 'r' + rid++)) room.handle(c.pid, m);
}
console.log(JSON.stringify(room.world!.result));
