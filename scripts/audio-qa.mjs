// Offline audio QA: renders every SFX / music mood / store ambience / karen sting from client/src/audio.ts in
// headless Chromium (OfflineAudioContext), writes WAVs and prints a measurement table.
//   node scripts/audio-qa.mjs [label=after] [outDir=/tmp/claude-0/audio25]
//   AUDIO_SRC=/abs/path/old-audio.ts node scripts/audio-qa.mjs before   (render another version, e.g. git show HEAD:client/src/audio.ts)
// Writes <outDir>/<label>/*.wav, <outDir>/<label>.json and <outDir>/<label>.md. With label "after" also reel.wav (REEL=1: reel-<label>.wav).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, analyze, writeWav, sfxNames, storeIds, MOODS, MOOD_NAMES } from '../tests/e2e/audio-lib.mjs';

const label = process.argv[2] ?? 'after';
const OUT = process.argv[3] ?? '/tmp/claude-0/audio25';
const dir = join(OUT, label); mkdirSync(dir, { recursive: true });
const R = await launch({ audioPath: process.env.AUDIO_SRC });
const KAREN_BASE = ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'custom', 'fickle', 'tryhard', 'boss', 'lottery', 'change', 'bagman', 'toilet'];
const jobs = [];
for (const n of sfxNames()) jobs.push({ group: 'sfx', name: n, spec: { dur: 2.6, steps: [{ t: 0, call: 'play', name: n }] } });
for (const m of MOODS) jobs.push({ group: 'music', name: `mood${m}`, desc: MOOD_NAMES[m], spec: { dur: 10, steps: [{ t: 0, call: 'music', mood: m }] } });
for (const s of storeIds()) jobs.push({ group: 'amb', name: s, spec: { dur: 12, steps: [{ t: 0, call: 'amb', name: s }] } });
for (const k of [...KAREN_BASE, ...R.sigKinds]) jobs.push({ group: 'karen', name: k, spec: { dur: 1.6, steps: [{ t: 0, call: 'karen', name: k }] } });
// stress: rapid repeats (ignoring nothing — the game's own rate limits apply) and a worst-case pile-up
const rapid = (n, every, dur = 1.2) => Array.from({ length: Math.floor(dur / every) }, (_, i) => ({ t: i * every, call: 'play', name: n }));
jobs.push({ group: 'stress', name: 'rapid-hit', desc: 'hit ×40 每 30ms', spec: { dur: 1.8, steps: rapid('hit', 0.03) } });
jobs.push({ group: 'stress', name: 'rapid-cash', desc: 'cash ×40 每 30ms', spec: { dur: 1.8, steps: rapid('cash', 0.03) } });
jobs.push({ group: 'stress', name: 'rapid-slap', desc: 'slap ×40 每 30ms', spec: { dur: 1.8, steps: rapid('slap', 0.03) } });
jobs.push({ group: 'stress', name: 'mixed-burst', desc: '12 種音效同時 ×3', spec: { dur: 2.5, steps: [0, 0.1, 0.2].flatMap(t => ['hit', 'impact', 'crash', 'slap', 'stamp', 'eject', 'throw', 'whoosh', 'splat', 'knock', 'cash', 'grab'].map(n => ({ t: t + Math.random() * 0.05, call: 'play', name: n }))) } });
jobs.push({ group: 'stress', name: 'chaos', desc: '大絕+崩潰+重低音+音樂+環境音', spec: { dur: 4, steps: [
  { t: 0, call: 'music', mood: 6 }, { t: 0, call: 'amb', name: 'gym' },
  { t: 1, call: 'play', name: 'ultimate' }, { t: 1, call: 'play', name: 'bassdrop' }, { t: 1.02, call: 'play', name: 'crash' }, { t: 1.05, call: 'play', name: 'eject' },
  { t: 1.1, call: 'play', name: 'slap' }, { t: 1.1, call: 'play', name: 'impact' }, { t: 1.2, call: 'karen', name: 'boss' }, { t: 1.3, call: 'play', name: 'achievement' }, { t: 1.3, call: 'play', name: 'levelup' }] } });

const rows = [];
for (const j of jobs) {
  const fin = await R.render(j.spec);
  const raw = await R.render({ ...j.spec, bypassLimiter: true });
  writeWav(join(dir, `${j.group}-${j.name}.wav`), fin.x, fin.sr);
  const a = analyze(fin.x, fin.sr), b = analyze(raw.x, raw.sr);
  rows.push({ group: j.group, name: j.name, desc: j.desc, ...a, rawPeakDb: b.peakDb, rawClip: b.clip });
  process.stdout.write('.');
}
console.log();
// reel: every SFX in sequence (then one karen sting)
if (label === 'after' || process.env.REEL) {
  const steps = []; let t = 0.3;
  const len = { ultimate: 1.1, bassdrop: 1.4, trombone: 1.9, ooh: 0.9, siren: 1.2, brew: 1, levelup: 0.8, achievement: 1.1, win: 1, lose: 1, rise: 0.7, outage: 0.7, open: 0.7, spin: 0.6, crash: 0.7 };
  for (const n of sfxNames()) { steps.push({ t, call: 'play', name: n }); t += (len[n] ?? 0.45) + 0.35; }
  for (const k of ['rager', 'boss']) { steps.push({ t, call: 'karen', name: k }); t += 1.5; }
  const reel = await R.render({ dur: t + 0.5, steps });
  writeWav(join(OUT, label === 'after' ? 'reel.wav' : `reel-${label}.wav`), reel.x, reel.sr);
  const ra = analyze(reel.x, reel.sr);
  console.log(`reel.wav ${(t + 0.5).toFixed(1)} s peak ${ra.peakDb.toFixed(2)} dBFS, ${sfxNames().length} SFX`);
}
await R.browser.close();
if (R.errors.length) console.log('page errors:', R.errors);
writeFileSync(join(OUT, `${label}.json`), JSON.stringify(rows, null, 1));
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');
const md = ['| 類別 | 名稱 | 長度 s | 峰值 dBFS | 限幅前峰值 | RMS dBFS | LUFS M-max | LUFS S-max | 削波 | DC | 重心 Hz | >6k % | <40Hz % | 旗標 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const r of rows) {
  const flags = [];
  if (r.nan) flags.push('NaN'); if (r.silent) flags.push('無聲'); if (r.clip) flags.push('削波'); if (r.peakDb > -0.5) flags.push('峰值過高');
  if (r.rawClip) flags.push('限幅前削波'); if (r.hfPct > 15) flags.push('高頻刺耳'); if (r.subPct > 10) flags.push('超低頻'); if (Math.abs(r.dc) > 1e-3) flags.push('DC');
  md.push(`| ${r.group} | ${r.name}${r.desc ? ` (${r.desc})` : ''} | ${f(r.dur, 2)} | ${f(r.peakDb)} | ${f(r.rawPeakDb)} | ${f(r.rmsDb)} | ${f(r.lufsM)} | ${f(r.lufsS)} | ${r.clip} | ${r.dc.toExponential(1)} | ${Math.round(r.centroid)} | ${f(r.hfPct)} | ${f(r.subPct)} | ${flags.join(' ') || '—'} |`);
}
writeFileSync(join(OUT, `${label}.md`), md.join('\n') + '\n');
const bad = rows.filter(r => r.nan || r.silent || r.clip || r.peakDb > -0.5);
console.log(`${rows.length} renders, ${bad.length} with NaN/silence/clipping/peak>-0.5 dBFS: ${bad.map(r => r.name).join(', ')}`);
