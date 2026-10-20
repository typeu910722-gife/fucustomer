// Shared helpers for offline audio QA: bundle the in-page harness, render in headless Chromium, analyse, write WAV.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function sfxNames() {
  const src = readFileSync(join(ROOT, 'client/src/audio.ts'), 'utf8');
  const body = src.slice(src.indexOf('play(name: string'), src.indexOf('procedural background music'));
  return [...new Set([...body.matchAll(/case '([a-z]+)':/g)].map(m => m[1]))];
}
export function storeIds() {
  const src = readFileSync(join(ROOT, 'client/src/audio.ts'), 'utf8');
  const body = src.slice(src.indexOf('const STORE_AMBIENCE'), src.indexOf('const STORE_EVENTS'));
  return [...body.matchAll(/^\s+([a-z]+): \{/gm)].map(m => m[1]);
}
export const MOODS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
export const MOOD_NAMES = { 0: '合作', 1: '第1章 陽光小店', 2: '第2章 深夜爵士', 3: '第3章 車站尖峰', 4: '第4章 觀光老街', 5: '第5章 跨年倒數', 6: 'Boss', 7: '無盡夜班', 8: '主選單' };

export async function launch({ audioPath } = {}) {
  const esbuild = require(join(ROOT, 'node_modules/esbuild'));
  const out = await esbuild.build({ entryPoints: [join(ROOT, 'tests/e2e/audio-harness.ts')], bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent',
    // optional: render another version of audio.ts (e.g. the previous commit's) for before/after comparisons
    plugins: audioPath ? [{ name: 'audio-src', setup(b) { b.onResolve({ filter: /client\/src\/audio$/ }, () => ({ path: audioPath })); } }] : [] });
  let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setContent('<!doctype html><html><body>audio qa</body></html>');
  await page.addScriptTag({ content: out.outputFiles[0].text });
  const sigKinds = await page.evaluate(() => window.__audioQA.sigKinds);
  return {
    browser, page, errors, sigKinds,
    async render(spec) {
      const b64 = await page.evaluate(s => window.__audioQA.render(s), spec);
      const b = Buffer.from(b64, 'base64');
      return { sr: spec.sr ?? 48000, x: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
    },
  };
}

export function writeWav(path, x, sr) {
  const n = x.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const v = Number.isFinite(x[i]) ? Math.max(-1, Math.min(1, x[i])) : 0; buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
  writeFileSync(path, buf);
}

const db = v => (v > 0 ? 20 * Math.log10(v) : -Infinity);
function biquad(x, b, a) {
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
/** BS.1770 K-weighting (coefficients for 48 kHz). */
function kweight(x) {
  const s1 = biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  return biquad(s1, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
}
function fftMag(re) { // in-place radix-2, returns magnitude^2 of the first half
  const n = re.length, im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  const p = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i]; return p;
}

export function analyze(x, sr) {
  let nan = 0, peak = 0, clip = 0, sum = 0;
  for (const v of x) { if (!Number.isFinite(v)) { nan++; continue; } const a = Math.abs(v); if (a > peak) peak = a; if (a >= 1) clip++; sum += v; }
  const thr = 1e-4; let first = -1, last = -1;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > thr) { if (first < 0) first = i; last = i; }
  const silent = first < 0;
  let ss = 0; if (!silent) for (let i = first; i <= last; i++) ss += x[i] * x[i];
  const rms = silent ? 0 : Math.sqrt(ss / (last - first + 1));
  // loudness
  const k = kweight(Array.from(x, v => (Number.isFinite(v) ? v : 0)));
  const blockLoud = (win, hop) => { const out = []; const W = Math.round(win * sr), H = Math.round(hop * sr);
    for (let s = 0; s + W <= Math.max(W, k.length); s += H) { let e = 0; for (let i = s; i < Math.min(s + W, k.length); i++) e += k[i] * k[i]; out.push(e / W); } return out; };
  const L = ms => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);
  const mom = blockLoud(0.4, 0.1); const mMax = L(Math.max(...mom));
  const st = blockLoud(3, 0.5); const sMax = L(Math.max(...st));
  const gated1 = mom.filter(m => L(m) > -70); const rel = L(gated1.reduce((p, q) => p + q, 0) / (gated1.length || 1)) - 10;
  const gated2 = gated1.filter(m => L(m) > rel); const integ = gated2.length ? L(gated2.reduce((p, q) => p + q, 0) / gated2.length) : -Infinity;
  // spectrum over active region
  const N = 2048; const spec = new Float64Array(N / 2); let frames = 0;
  if (!silent) for (let s = first; s + N <= last + N; s += N / 2) {
    const fr = new Float64Array(N); for (let i = 0; i < N; i++) { const v = x[s + i] ?? 0; fr[i] = (Number.isFinite(v) ? v : 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); }
    const p = fftMag(fr); for (let i = 0; i < N / 2; i++) spec[i] += p[i]; frames++;
  }
  let tot = 0, wsum = 0, hf = 0, sub = 0;
  for (let i = 1; i < N / 2; i++) { const f = i * sr / N; tot += spec[i]; wsum += spec[i] * f; if (f >= 6000) hf += spec[i]; if (f < 40) sub += spec[i]; }
  // clicks: largest jump in the first/last 1 ms of each note is hard to isolate; report the end-of-render sample and
  // the max first-difference relative to peak (high values = discontinuities or hard transients)
  let maxDiff = 0; for (let i = 1; i < x.length; i++) { const dd = Math.abs(x[i] - x[i - 1]); if (dd > maxDiff) maxDiff = dd; }
  return {
    dur: silent ? 0 : (last - first + 1) / sr, peakDb: db(peak), rmsDb: db(rms), lufsM: mMax, lufsS: sMax, lufsI: integ,
    clip, nan, dc: x.length ? sum / x.length : 0, centroid: tot ? wsum / tot : 0, hfPct: tot ? 100 * hf / tot : 0, subPct: tot ? 100 * sub / tot : 0,
    silent, maxStepDb: db(maxDiff), endDb: db(Math.abs(x[x.length - 1] ?? 0)),
  };
}
