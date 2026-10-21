// Main-story balance harness (主線平衡測試). A simulated player bot (模擬玩家, not a human) plays every main-story
// shift at three skill levels with several seeds and records pass rate, stars, revenue vs target, time-to-target,
// chaos / rating extremes, customers lost, karens (which kinds, back-to-back repeats) and idle time.
//
//   node --import tsx scripts/balance.ts                 # all shifts, prints a markdown report
//   node --import tsx scripts/balance.ts --only 6-3      # shift ids starting with "6-3"
//   node --import tsx scripts/balance.ts --seeds 8 --json out.json --md out.md
//   node --import tsx scripts/balance.ts --proper ...    # 照規矩處理: no grab-and-throw (except a violent karen), see BotStyle
//   node --import tsx scripts/balance.ts --gen [--proper] # daily-style: chapter 3–6 third shift + one general karen
//   node --import tsx scripts/balance.ts --gen --solo --proper [--kinds cutter,rager]  # one karen kind only, every 30 s
//   node --import tsx scripts/balance.ts --weekly [--proper] # the weekly challenges from 2026-W44 on
//
// Bots are not humans: they never mis-aim or get lost, but they also follow a fixed priority list, so the numbers
// are a consistency check of the data, not a substitute for play-testing.
import { Room } from '../shared/room.ts';
import { Bot, botMessages } from '../shared/bot.ts';
import { CHAPTERS, GEAR_IDS, STAR_CHAOS, STAR_RATING, STAR_REVENUE, buildShiftConfig, modsFor, newProfile, starsFor, type CareerProfile, type ShiftConfig } from '../shared/career.ts';
import { buildSpecialConfig } from '../shared/specialdays.ts';
import { SPECIAL_DAYS, SPECIAL_IDS } from '../shared/genkarens.ts';
import { GEN_KINDS, KAREN_INFO, type KarenKind } from '../shared/constants.ts';
import { WEEKLY_TWISTS, buildWeeklyConfig, weeklyPlan } from '../shared/weekly.ts';
import type { Snapshot } from '../shared/protocol.ts';
import { writeFileSync } from 'node:fs';

export type Skill = 'weak' | 'average' | 'strong';
export const SKILL_IDS: Skill[] = ['weak', 'average', 'strong'];
export const SKILL_NAMES: Record<Skill, string> = { weak: '新手', average: '一般', strong: '高手' };
/**
 * How each skill level is modelled.
 * - pace: walking speed multiplier on top of the profile's shoes/body bonus.
 * - hesitate: chance per second to stop and look around for `freeze` seconds (a human reading the screen / deciding).
 * - level/gear: how far ahead of the chapter's minimum level the player is, and gear relative to the expected gear.
 */
export const SKILL_MODEL: Record<Skill, { pace: number; hesitate: number; freeze: number; level: number; gear: number; changeErr: number; think: number }> = {
  weak: { pace: 0.8, hesitate: 0.3, freeze: 1.0, level: 0, gear: -1, changeErr: 0.25, think: 2.0 },
  average: { pace: 0.92, hesitate: 0.15, freeze: 0.7, level: 2, gear: 0, changeErr: 0.10, think: 1.2 },
  strong: { pace: 1.05, hesitate: 0, freeze: 0, level: 4, gear: 1, changeErr: 0.03, think: 0.6 },
};
/** - changeErr / think: 找零計較姐 quick-time in --proper mode (chance to pick a wrong handful, seconds to read it). */
/** How each karen ended: handled by its own action, thrown out by the player (grabbed), shown out by the 保全 / 全店退散 (ejected without a grab), failed (it got away with it), or other (closing time / still there). */
export type Outcome = { n: number; ok: number; thrown: number; guard: number; failed: number; other: number };
const noOutcome = (): Outcome => ({ n: 0, ok: 0, thrown: 0, guard: 0, failed: 0, other: 0 });

export function profileFor(chapter: number, minLevel: number, skill: Skill): CareerProfile {
  const m = SKILL_MODEL[skill];
  const p = newProfile();
  p.level = Math.min(30, minLevel + m.level);
  const pts = p.level - 1;
  p.skills = { service: Math.ceil(pts / 3), body: Math.floor(pts / 3), crisis: pts - Math.ceil(pts / 3) - Math.floor(pts / 3) };
  const base = Math.min(3, Math.floor((chapter - 1) * 0.6));
  for (const g of GEAR_IDS) p.gear[g] = Math.max(0, Math.min(3, base + m.gear));
  return p;
}

export interface Run {
  id: string; skill: Skill; seed: number; won: boolean; stars: number; revenue: number; goal: number; failReason: string;
  /** Seconds after opening when revenue reached the goal (null = never). */
  timeToTarget: number | null;
  chaosPeak: number; ratingMin: number; lost: number; karensFailed: number; bossDefeated?: boolean;
  /** Final rating / chaos, and which star conditions were met (see starsFor in shared/career.ts). */
  rating: number; chaos: number; starRating: boolean; starRevenue: boolean;
  karens: string[]; repeats: number;
  /** Seconds the bot had nothing to do while the store was open, and how much of that was in the first 30 s. */
  idle: number; idleEarly: number; openTime: number;
  /** Per karen kind (toilet followers not counted separately). */
  outcomes: Record<string, Outcome>;
}

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function playShift(id: string, skill: Skill, seed: number, proper = false): Run {
  const found = CHAPTERS.find(c => c.shifts.some(s => s.id === id));
  if (!found) throw new Error('unknown shift ' + id);
  return playConfig(id, found.n, found.minLevel, skill, seed, prof => buildShiftConfig(prof, id), proper);
}

/**
 * Plays any shift config (special days, daily-style configs) with the skill model of a chapter: the profile has
 * cleared every earlier chapter, so progress-based configs (daily / 特殊營業日) pick that chapter's difficulty.
 */
export function playConfig(id: string, chapter: number, minLevel: number, skill: Skill, seed: number, build: (p: CareerProfile) => ShiftConfig, proper = false): Run {
  const prof = profileFor(chapter, minLevel, skill);
  for (const c of CHAPTERS) if (c.n < chapter) for (const s of c.shifts) prof.stars[s.id] = 1;
  const cfg = build(prof);
  const model = SKILL_MODEL[skill];
  let t = 0;
  const room = new Room('B', null, { solo: true, now: () => t, shift: cfg, seed });
  const c: { snap: Snapshot | null; pid: string; send(m: any): void; close(): void } = {
    snap: null, pid: '', send(m) { if (m.type === 'snap') c.snap = m.s; if (m.type === 'welcome') c.pid = m.playerId; }, close() {},
  };
  room.join(c, 'bot', undefined); room.startGame();
  const r = rng(seed * 7919 + skill.length);
  const bot = new Bot('any', r(), proper ? { proper: true, changeErr: model.changeErr, think: model.think } : {});
  bot.pace = modsFor(prof).speed * model.pace;
  // spy on the bot's goal choice to measure idle time (no goal at all = nothing to do)
  let noGoal = false;
  const orig = (bot as any).pickGoal.bind(bot);
  (bot as any).pickGoal = (s: Snapshot, me: any) => { const g = orig(s, me); noGoal = !g; return g; };
  const w = () => room.world!;
  const seen = new Set<number>();
  const karens: string[] = [];
  const track = new Map<number, { kind: string; how: string; held: boolean }>(), outcomes: Record<string, Outcome> = {};
  let prevFailed = 0, prevHandled = 0;
  let rid = 0, freeze = 0, timeToTarget: number | null = null, chaosPeak = 0, ratingMin = 5, idle = 0, idleEarly = 0;
  const dt = 0.05, maxT = cfg.length + 80;
  for (let s = 0; s < maxT; s += dt) {
    t += 50; room.update(dt);
    const world = w();
    if (world.result) break;
    const open = world.phase === 'open' || world.phase === 'closing';
    if (open) {
      chaosPeak = Math.max(chaosPeak, world.chaos); ratingMin = Math.min(ratingMin, world.rating);
      if (timeToTarget === null && world.dayStats.revenue >= cfg.goal) timeToTarget = Math.round(world.time - world.openTime);
      for (const cu of world.customers) if (!seen.has(cu.id)) { seen.add(cu.id); if (cu.kind !== 'normal') karens.push(cu.kind); }
    }
    // how each karen ended (attributed on the tick it was resolved)
    {
      let df = world.dayStats.karensFailed - prevFailed, dh = Object.values(world.handled).reduce((a, b) => a + b, 0) - prevHandled;
      prevFailed += df; prevHandled += dh;
      for (const cu of world.customers) {
        if (cu.kind === 'normal' || cu.kind === 'boss' || cu.leader != null) continue;
        const o = (outcomes[cu.kind] ??= noOutcome());
        if (!track.has(cu.id)) { track.set(cu.id, { kind: cu.kind, how: 'open', held: false }); o.n++; }
        const tr = track.get(cu.id)!;
        if (cu.heldBy || cu.fly) tr.held = true;
        if (tr.how !== 'open' || !cu.resolved) continue;
        const how = cu.ejected ? (tr.held ? 'thrown' : 'guard') : df > 0 ? 'failed' : dh > 0 ? 'ok' : 'other';
        if (how === 'failed') df--; else if (dh > 0 && how !== 'other') dh--;
        tr.how = how; o[how]++;
      }
    }
    const sn = c.snap; if (!sn) continue;
    const me = sn.players[0];
    if (open && freeze <= 0 && model.hesitate > 0 && r() < model.hesitate * dt) freeze = model.freeze * (0.5 + r());
    if (freeze > 0) { freeze -= dt; continue; } // standing still: the server keeps the last position
    noGoal = false;
    const o = bot.update(sn, me, dt);
    if (open && world.phase === 'open' && noGoal && !o.act && !me.busy) {
      idle += dt;
      if (world.time - world.openTime < 30) idleEarly += dt;
    }
    for (const m of botMessages(o, () => 'r' + rid++)) room.handle(c.pid, m);
  }
  if (!w().result) room.handle(c.pid, { type: 'endShift' } as any);
  const res = w().result!;
  for (const tr of track.values()) if (tr.how === 'open') outcomes[tr.kind].other++;
  const ks = karens.filter(k => k !== 'boss');
  let repeats = 0; for (let i = 1; i < ks.length; i++) if (ks[i] === ks[i - 1]) repeats++;
  return {
    id, skill, seed, won: res.won, stars: starsFor(res), revenue: res.revenue, goal: res.goal, failReason: res.failReason,
    timeToTarget, chaosPeak: Math.round(chaosPeak), ratingMin: Math.round(ratingMin * 100) / 100, lost: res.angryLeft, karensFailed: res.karensFailed,
    bossDefeated: res.bossDefeated, rating: res.rating, chaos: res.chaos,
    starRating: res.rating >= STAR_RATING && res.chaos < STAR_CHAOS, starRevenue: res.revenue >= res.goal * STAR_REVENUE && res.karensFailed === 0 && res.angryLeft <= 1, karens, repeats, idle: Math.round(idle * 10) / 10, idleEarly: Math.round(idleEarly * 10) / 10, openTime: cfg.length, outcomes,
  };
}

export interface Row {
  id: string; title: string; chapter: number; skill: Skill; n: number; pass: number; stars: [number, number, number, number]; avgStars: number;
  revRatio: number; ttt: number | null; chaosPeak: number; ratingMin: number; lost: number; karens: number; kinds: Record<string, number>;
  repeatPct: number; idlePct: number; idleEarly: number; fails: string[];
  rating: number; starRating: number; starRevenue: number; karensFailed: number;
}

const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function median(a: number[]) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

export function summarize(runs: Run[]): Row {
  const r0 = runs[0];
  const ch = CHAPTERS.find(c => c.shifts.some(s => s.id === r0.id))!;
  const stars: [number, number, number, number] = [0, 0, 0, 0];
  for (const r of runs) stars[r.stars]++;
  const kinds: Record<string, number> = {};
  for (const r of runs) for (const k of r.karens) kinds[k] = (kinds[k] ?? 0) + 1;
  const pairs = runs.reduce((a, r) => a + Math.max(0, r.karens.filter(k => k !== 'boss').length - 1), 0);
  return {
    id: r0.id, title: ch.shifts.find(s => s.id === r0.id)!.title, chapter: ch.n, skill: r0.skill, n: runs.length,
    pass: runs.filter(r => r.stars > 0).length / runs.length, stars, avgStars: mean(runs.map(r => r.stars)),
    revRatio: mean(runs.map(r => r.revenue / r.goal)), ttt: median(runs.filter(r => r.timeToTarget !== null).map(r => r.timeToTarget!)),
    chaosPeak: mean(runs.map(r => r.chaosPeak)), ratingMin: mean(runs.map(r => r.ratingMin)), lost: mean(runs.map(r => r.lost)),
    karens: mean(runs.map(r => r.karens.length)), kinds, repeatPct: pairs ? runs.reduce((a, r) => a + r.repeats, 0) / pairs : 0,
    idlePct: mean(runs.map(r => r.idle / r.openTime)), idleEarly: mean(runs.map(r => r.idleEarly)),
    rating: mean(runs.map(r => r.rating)), starRating: mean(runs.map(r => +r.starRating)), starRevenue: mean(runs.map(r => +r.starRevenue)),
    karensFailed: mean(runs.map(r => r.karensFailed)),
    fails: [...new Set(runs.filter(r => !r.won).map(r => r.failReason.replace(/\$\d+/, '$')))],
  };
}

/** Main-story shift ids. `only` is a comma list of shift ids ("6-3") or chapter numbers ("6"). */
export function mainShiftIds(only = ''): string[] {
  const want = only.split(',').filter(Boolean);
  return CHAPTERS.flatMap(c => c.shifts.map(s => s.id)).filter(id => !want.length || want.some(p => p.includes('-') ? id === p : id.startsWith(p + '-')));
}

export function runAll(ids: string[], seeds: number, skills: Skill[] = SKILL_IDS, log?: (s: string) => void, sink?: Run[], seedBase = 1000, proper = false): Row[] {
  const rows: Row[] = [];
  for (const id of ids) for (const sk of skills) {
    const runs = Array.from({ length: seeds }, (_, i) => playShift(id, sk, seedBase + i * 17, proper));
    sink?.push(...runs);
    rows.push(summarize(runs));
    log?.(`${id} ${sk} pass ${(rows[rows.length - 1].pass * 100).toFixed(0)}% stars ${rows[rows.length - 1].stars.join('/')}`);
  }
  return rows;
}

// ---------------- markdown ----------------
const pct = (x: number) => `${Math.round(x * 100)}%`;
const f1 = (x: number) => x.toFixed(1);
const kname = (k: string) => (KAREN_INFO as Record<string, { name: string }>)[k]?.name ?? (k === 'boss' ? '奧客之王' : k);

/** Overview: one line per shift, pass rate and average stars for each skill level. */
export function overviewTable(rows: Row[]): string {
  const ids = [...new Set(rows.map(r => r.id))];
  const out = ['| 班次 | 標題 | 新手 過關 | 新手 ★ | 一般 過關 | 一般 ★ | 高手 過關 | 高手 ★ | 高手 3★ 比例 |', '|---|---|---|---|---|---|---|---|---|'];
  for (const id of ids) {
    const g = (s: Skill) => rows.find(r => r.id === id && r.skill === s);
    const cells = SKILL_IDS.flatMap(s => { const r = g(s); return r ? [pct(r.pass), r.avgStars.toFixed(2)] : ['–', '–']; });
    const st = g('strong');
    out.push(`| ${id} | ${rows.find(r => r.id === id)!.title} | ${cells.join(' | ')} | ${st ? pct(st.stars[3] / st.n) : '–'} |`);
  }
  return out.join('\n');
}

/** Detail for one skill level. */
export function detailTable(rows: Row[], skill: Skill): string {
  const out = ['| 班次 | 星數分布 0/1/2/3 | 營收/目標 | 達標時間(秒) | 混亂峰值 | 口碑最低 | 收班口碑 | 口碑星條件 | 營收星條件 | 流失客人 | 奧客失敗 | 奧客數 | 奧客種類 | 連續同種 | 閒置比例 | 開場30秒閒置 | 失敗原因 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows.filter(x => x.skill === skill)) {
    const kinds = Object.entries(r.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${kname(k)}×${f1(n / r.n)}`).join('、') || '—';
    out.push(`| ${r.id} | ${r.stars.join('/')} | ${r.revRatio.toFixed(2)} | ${r.ttt ?? '—'} | ${Math.round(r.chaosPeak)} | ${r.ratingMin.toFixed(2)} | ${r.rating.toFixed(2)} | ${pct(r.starRating)} | ${pct(r.starRevenue)} | ${f1(r.lost)} | ${f1(r.karensFailed)} | ${f1(r.karens)} | ${kinds} | ${pct(r.repeatPct)} | ${pct(r.idlePct)} | ${f1(r.idleEarly)}s | ${r.fails.join('；') || '—'} |`);
  }
  return out.join('\n');
}

/** Per chapter: pass rates and stars by skill level. */
export function chapterTable(rows: Row[]): string {
  const out = ['| 章 | 新手 過關 | 一般 過關 | 一般 平均★ | 高手 平均★ | 高手 3★ | 一般 營收/目標 | 一般 混亂峰值 | 一般 閒置 |', '|---|---|---|---|---|---|---|---|---|'];
  for (const c of CHAPTERS) {
    const rs = rows.filter(r => r.chapter === c.n);
    if (!rs.length) continue;
    const of = (s: Skill) => rs.filter(r => r.skill === s);
    const avg = (s: Skill, f: (r: Row) => number) => mean(of(s).map(f));
    out.push(`| ${c.n} ${c.title} | ${pct(avg('weak', r => r.pass))} | ${pct(avg('average', r => r.pass))} | ${avg('average', r => r.avgStars).toFixed(2)} | ${avg('strong', r => r.avgStars).toFixed(2)} | ${pct(avg('strong', r => r.stars[3] / r.n))} | ${avg('average', r => r.revRatio).toFixed(2)} | ${Math.round(avg('average', r => r.chaosPeak))} | ${pct(avg('average', r => r.idlePct))} |`);
  }
  return out.join('\n');
}

export function totals(rows: Row[]) {
  const of = (s: Skill) => rows.filter(r => r.skill === s);
  return Object.fromEntries(SKILL_IDS.map(s => [s, { pass: mean(of(s).map(r => r.pass)), stars: mean(of(s).map(r => r.avgStars)), three: mean(of(s).map(r => r.stars[3] / r.n)) }])) as Record<Skill, { pass: number; stars: number; three: number }>;
}

export function report(rows: Row[], seeds: number): string {
  const t = totals(rows);
  return [
    `每個班次 × 每種程度跑 ${seeds} 個種子（模擬玩家，非真人）。`,
    '',
    `整體：新手過關 ${pct(t.weak.pass)}、一般過關 ${pct(t.average.pass)}（平均 ${t.average.stars.toFixed(2)}★）、高手平均 ${t.strong.stars.toFixed(2)}★、高手 3★ ${pct(t.strong.three)}`,
    '', '#### 各章摘要', '', chapterTable(rows),
    '', '#### 各班次過關率與星數', '', overviewTable(rows),
    '', '#### 一般玩家細節', '', detailTable(rows, 'average'),
  ].join('\n');
}

// ---------------- CLI ----------------
/**
 * 特殊營業日 (round 27) next to the ordinary shift of the same difficulty: the free-play special-day config is built
 * from chapter n's third shift (like the daily challenge), so each row compares it with that shift scaled to 180 s.
 */
export function specialReport(seeds: number, chapters = [2, 3, 4, 5, 6], seedBase = 1000, log?: (s: string) => void, proper = false, sink?: Run[]): string {
  const out = ['| 難度（章） | 特殊營業日 | 新手 過關 | 一般 過關 | 一般 ★ | 高手 ★ | 一般 營收/目標 | 一般 收班口碑 | 一般 奧客失敗 | 同章第 3 班 一般 過關（對照） |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const n of chapters) {
    const ch = CHAPTERS[n - 1];
    const base = ch.shifts[Math.min(2, ch.shifts.length - 1)];
    const ref = Array.from({ length: seeds }, (_, i) => playShift(base.id, 'average', seedBase + i * 17, proper));
    for (const id of SPECIAL_IDS) {
      const rs = Object.fromEntries(SKILL_IDS.map(sk => [sk, Array.from({ length: seeds }, (_, i) => playConfig('sp-' + id, n, ch.minLevel, sk, seedBase + i * 17, p => buildSpecialConfig(p, id), proper))])) as Record<Skill, Run[]>;
      for (const sk of SKILL_IDS) sink?.push(...rs[sk]);
      const pass = (r: Run[]) => pct(r.filter(x => x.stars > 0).length / r.length);
      const av = rs.average;
      out.push(`| ${n} | ${id === 'typhoon' ? '🌀颱風夜' : '🎆跨年夜'} | ${pass(rs.weak)} | ${pass(av)} | ${mean(av.map(r => r.stars)).toFixed(2)} | ${mean(rs.strong.map(r => r.stars)).toFixed(2)} | ${mean(av.map(r => r.revenue / r.goal)).toFixed(2)} | ${mean(av.map(r => r.rating)).toFixed(2)} | ${mean(av.map(r => r.karensFailed)).toFixed(1)} | ${base.id} ${pass(ref)} |`);
      log?.(`ch${n} ${id} weak ${pass(rs.weak)} avg ${pass(av)}`);
    }
  }
  return out.join('\n');
}

/** How the karens of some runs ended, per kind (`kinds` = only these; default every kind seen). */
export function outcomeTable(runs: Run[], kinds?: string[]): string {
  const tot: Record<string, Outcome> = {};
  for (const r of runs) for (const [k, o] of Object.entries(r.outcomes)) {
    const t = (tot[k] ??= noOutcome());
    for (const f of Object.keys(t) as (keyof Outcome)[]) t[f] += o[f] ?? 0;
  }
  const out = ['| 奧客 | 出現 | 照規矩處理 | 玩家丟出門 | 保全／全店退散請走 | 失敗（被他得逞） | 其他（收班時還在等） |', '|---|---|---|---|---|---|---|'];
  for (const [k, o] of Object.entries(tot).filter(([k]) => !kinds || kinds.includes(k)).sort((a, b) => b[1].n - a[1].n)) {
    const q = (x: number) => (o.n ? pct(x / o.n) : '–');
    out.push(`| ${kname(k)} | ${o.n} | ${q(o.ok)} | ${q(o.thrown)} | ${q(o.guard)} | ${q(o.failed)} | ${q(o.other)} |`);
  }
  return out.join('\n');
}

const passOf = (r: Run[]) => pct(r.filter(x => x.stars > 0).length / r.length);
/** One general karen's outcome over runs, "處理 x%／丟 y%／失敗 z%" (how it ended for that kind only). */
function genCell(runs: Run[], k: string) {
  const o = runs.reduce((a, r) => { const x = r.outcomes[k]; if (x) for (const f of Object.keys(a) as (keyof Outcome)[]) a[f] += x[f] ?? 0; return a; }, noOutcome());
  return o.n ? `${(o.n / runs.length).toFixed(1)} 次：處理 ${pct(o.ok / o.n)}／丟 ${pct(o.thrown / o.n)}／保全 ${pct(o.guard / o.n)}／失敗 ${pct(o.failed / o.n)}` : '沒出現';
}

/**
 * Daily-challenge style (每日挑戰的基準): chapter n's third shift (no boss) with and without one general karen added to
 * the karen pool — the same comparison as docs/BALANCE.md「第四輪」.
 * `solo` (壓力測試): the shift's karens are only that one kind, every 30 s from 15 s on — about five per shift, so each
 * kind's own cost shows (run it with `kinds` = old karens too for a reference band).
 */
export function genReport(seeds: number, chapters = [3, 4, 5, 6], seedBase = 3000, log?: (s: string) => void, proper = false, sink?: Run[], solo = false, kinds: string[] = GEN_KINDS): string {
  const out = ['| 班次 | 加入的新奧客 | 新手 過關 | 一般 過關 | 高手 過關 | 一般 ★ | 一般 營收/目標 | 一般 奧客失敗 | 新奧客結果（三種程度合計，每局次數） |', '|---|---|---|---|---|---|---|---|---|'];
  for (const n of chapters) {
    const ch = CHAPTERS[n - 1];
    const base = ch.shifts[Math.min(2, ch.shifts.length - 1)];
    for (const gen of ['', ...kinds]) {
      const rs = Object.fromEntries(SKILL_IDS.map(sk => [sk, Array.from({ length: seeds }, (_, i) => playConfig(base.id, n, ch.minLevel, sk, seedBase + i * 17, p => {
        const cfg = buildShiftConfig(p, base.id); cfg.boss = false;
        if (gen) cfg.karens = solo ? [gen as KarenKind] : [...new Set([...cfg.karens, gen as KarenKind])];
        if (solo) { cfg.firstKaren = 15; cfg.karenEvery = 30; }
        return cfg;
      }, proper))])) as Record<Skill, Run[]>;
      const all = SKILL_IDS.flatMap(sk => rs[sk]); sink?.push(...all);
      const av = rs.average;
      out.push(`| ${base.id}${n === 6 ? '（不含王）' : ''} | ${gen ? kname(gen) + (solo ? '（只有這種）' : '') : solo ? '（原奧客池，每 30 秒）' : '（無）'} | ${passOf(rs.weak)} | ${passOf(av)} | ${passOf(rs.strong)} | ${mean(av.map(r => r.stars)).toFixed(2)} | ${mean(av.map(r => r.revenue / r.goal)).toFixed(2)} | ${mean(av.map(r => r.karensFailed)).toFixed(2)} | ${gen ? genCell(all, gen) : '—'} |`);
      log?.(`${base.id} ${gen || '-'} weak ${passOf(rs.weak)} avg ${passOf(av)} strong ${passOf(rs.strong)}`);
    }
  }
  return out.join('\n');
}

/** Weekly challenges (ROUND27_WEEK on: each brings one general karen, some are a 特殊營業日) at chapter n difficulty. */
export function weeklyReport(seeds: number, weeks: string[], chapters = [3, 5], seedBase = 5000, log?: (s: string) => void, proper = false, sink?: Run[]): string {
  const out = ['| 週次 | 難度（章） | 變化 | 新奧客 | 新手 過關 | 一般 過關 | 高手 過關 | 一般 營收/目標 | 新奧客結果（三種程度合計） |', '|---|---|---|---|---|---|---|---|---|'];
  for (const wk of weeks) for (const n of chapters) {
    const plan = weeklyPlan(wk), ch = CHAPTERS[n - 1];
    const rs = Object.fromEntries(SKILL_IDS.map(sk => [sk, Array.from({ length: seeds }, (_, i) => playConfig('weekly', n, ch.minLevel, sk, seedBase + i * 17, p => buildWeeklyConfig(p, wk), proper))])) as Record<Skill, Run[]>;
    const all = SKILL_IDS.flatMap(sk => rs[sk]); sink?.push(...all);
    const sp = plan.special ? `・${SPECIAL_DAYS[plan.special].icon}${SPECIAL_DAYS[plan.special].name}` : '';
    out.push(`| ${wk} | ${n} | ${WEEKLY_TWISTS[plan.twist].icon}${WEEKLY_TWISTS[plan.twist].name}${sp} | ${plan.gen ? kname(plan.gen) : '—'} | ${passOf(rs.weak)} | ${passOf(rs.average)} | ${passOf(rs.strong)} | ${mean(rs.average.map(r => r.revenue / r.goal)).toFixed(2)} | ${plan.gen ? genCell(all, plan.gen) : '—'} |`);
    log?.(`${wk} ch${n} weak ${passOf(rs.weak)} avg ${passOf(rs.average)}`);
  }
  return out.join('\n');
}

if (process.argv[1]?.endsWith('scripts/balance.ts')) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
  const proper = process.argv.includes('--proper');
  const log = (s: string) => process.stderr.write(s + '\n');
  const extra = (runs: Run[], md: string, kinds?: string[]) => md + '\n\n#### 奧客怎麼結束的' + (proper ? '（照規矩處理模式）' : '') + '\n\n' + outcomeTable(runs, kinds);
  const emit = (md: string) => { if (arg('--md')) writeFileSync(arg('--md')!, md + '\n'); else console.log(md); };
  if (process.argv.includes('--special')) {
    const runs: Run[] = [];
    const chs = arg('--chapters')?.split(',').map(Number);
    emit(extra(runs, specialReport(Number(arg('--seeds') ?? 6), chs, Number(arg('--seed-base') ?? 1000), log, proper, runs)));
    if (arg('--runs')) writeFileSync(arg('--runs')!, JSON.stringify(runs));
    process.exit(0);
  }
  if (process.argv.includes('--gen')) {
    const runs: Run[] = [];
    const chs = arg('--chapters')?.split(',').map(Number);
    const kinds = arg('--kinds')?.split(',') ?? GEN_KINDS;
    emit(extra(runs, genReport(Number(arg('--seeds') ?? 6), chs, Number(arg('--seed-base') ?? 3000), log, proper, runs, process.argv.includes('--solo'), kinds), kinds));
    process.exit(0);
  }
  if (process.argv.includes('--weekly')) {
    const runs: Run[] = [];
    const weeks = arg('--weeks')?.split(',') ?? ['2026-W44', '2026-W45', '2026-W46', '2026-W47', '2026-W48', '2026-W49', '2026-W50', '2026-W51', '2026-W52', '2026-W53', '2027-W01', '2027-W02'];
    const chs = arg('--chapters')?.split(',').map(Number);
    emit(extra(runs, weeklyReport(Number(arg('--seeds') ?? 4), weeks, chs, Number(arg('--seed-base') ?? 5000), log, proper, runs), GEN_KINDS));
    process.exit(0);
  }
  const seeds = Number(arg('--seeds') ?? 6);
  const ids = mainShiftIds(arg('--only') ?? '');
  const skills = (arg('--skills')?.split(',') as Skill[] | undefined) ?? SKILL_IDS;
  const t0 = Date.now();
  const all: Run[] = [];
  const rows = runAll(ids, seeds, skills, log, all, Number(arg('--seed-base') ?? 1000), proper);
  if (arg('--runs')) writeFileSync(arg('--runs')!, JSON.stringify(all));
  const md = proper ? extra(all, report(rows, seeds)) : report(rows, seeds);
  if (arg('--json')) writeFileSync(arg('--json')!, JSON.stringify(rows, null, 1));
  if (arg('--md')) writeFileSync(arg('--md')!, md + '\n');
  else console.log(md);
  process.stderr.write(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
