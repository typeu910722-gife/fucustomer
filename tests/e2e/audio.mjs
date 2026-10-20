// Audio QA smoke test: renders a handful of sounds from client/src/audio.ts offline (OfflineAudioContext in
// headless Chromium, the real mix chain incl. limiter) and checks: no NaN/Infinity, peak ≤ −0.5 dBFS, not silent,
// a worst-case pile-up stays under the ceiling, and every SFX has a level trim. Needs no game server.
// This is a numeric check only — a human still has to listen (docs/AUDIO.md).
import { readFileSync } from 'node:fs';
import { launch, analyze, sfxNames } from './audio-lib.mjs';

const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok', m);
const R = await launch();
const cases = [
  ['sfx hit', { dur: 0.8, steps: [{ t: 0, call: 'play', name: 'hit' }] }],
  ['sfx cash', { dur: 0.8, steps: [{ t: 0, call: 'play', name: 'cash' }] }],
  ['sfx slap', { dur: 0.6, steps: [{ t: 0, call: 'play', name: 'slap' }] }],
  ['sfx bassdrop', { dur: 1.6, steps: [{ t: 0, call: 'play', name: 'bassdrop' }] }],
  ['sfx ultimate', { dur: 1.2, steps: [{ t: 0, call: 'play', name: 'ultimate' }] }],
  ['sfx step', { dur: 0.3, steps: [{ t: 0, call: 'play', name: 'step' }] }],
  ['karen alarm + sting (boss)', { dur: 1.5, steps: [{ t: 0, call: 'karen', name: 'boss' }] }],
  ['music mood 6 (boss)', { dur: 3, steps: [{ t: 0, call: 'music', mood: 6 }] }],
  ['ambience breakfast', { dur: 3, steps: [{ t: 0, call: 'amb', name: 'breakfast' }] }],
  ['rapid repeats: slap ×40', { dur: 1.6, steps: Array.from({ length: 40 }, (_, i) => ({ t: i * 0.03, call: 'play', name: 'slap' })) }],
  ['pile-up: everything at once', { dur: 2.5, steps: [{ t: 0, call: 'music', mood: 6 }, { t: 0, call: 'amb', name: 'gym' },
    ...['ultimate', 'bassdrop', 'crash', 'eject', 'slap', 'impact', 'hit', 'stamp', 'achievement', 'levelup', 'cash', 'whoosh'].map(name => ({ t: 0.5, call: 'play', name })),
    { t: 0.55, call: 'karen', name: 'boss' }] }],
];
cases.push(['pile-up at 100% 音效/主音量/音樂', { ...cases.at(-1)[1], volume: 1, master: 1, music: 1 }]);
for (const [label, spec] of cases) {
  const { x, sr } = await R.render(spec);
  const a = analyze(x, sr);
  const desc = `${label}: peak ${a.peakDb.toFixed(1)} dBFS, M-max ${a.lufsM.toFixed(1)} LUFS`;
  if (a.nan) fail(`${desc} — ${a.nan} NaN/Infinity samples`);
  else if (a.silent || a.peakDb < -40) fail(`${desc} — silent`);
  else if (a.peakDb > -0.5) fail(`${desc} — peak above −0.5 dBFS`);
  else if (Math.abs(a.dc) > 1e-3) fail(`${desc} — DC offset ${a.dc}`);
  else ok(desc);
}
const src = readFileSync(new URL('../../client/src/audio.ts', import.meta.url), 'utf8');
const trim = src.slice(src.indexOf('const TRIM'), src.indexOf('};', src.indexOf('const TRIM')));
const missing = sfxNames().filter(n => !new RegExp(`\\b${n}:`).test(trim));
if (missing.length) fail(`SFX without a level trim: ${missing.join(', ')}`); else ok(`all ${sfxNames().length} SFX have a level trim`);
if (R.errors.length) fail(`page errors: ${R.errors.join(' | ')}`);
await R.browser.close();
console.log(process.exitCode ? 'audio test FAILED' : 'audio test passed');
