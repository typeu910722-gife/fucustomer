// Round 26: accessibility settings (色盲友善・字級・音效字幕・減少動態效果) — sanitizing, defaults, save-code export,
// and the caption queue's rate limiting / de-duplication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, sanitizeSettings } from '../client/src/storage.ts';
import { cleanSettings, TEXT_SCALES, exportSaveCode, parseSaveCode, applySave, K } from '../shared/savecode.ts';
import { CaptionQueue, CAPTION_TEXT, MAX_LINES, MIN_GAP_MS, SHOW_MS } from '../client/src/captions.ts';

test('defaults: palette off, 100% text, captions off; reduce motion follows the OS preference', () => {
  const d = defaultSettings(false, false);
  assert.equal(d.colorblind, 'off'); assert.equal(d.textScale, 1); assert.equal(d.captions, false); assert.equal(d.reduceMotion, false);
  assert.equal(defaultSettings(false, true).reduceMotion, true);
  // the OS preference is only a default: a stored choice wins
  assert.equal(sanitizeSettings({}, false, true).reduceMotion, true);
  assert.equal(sanitizeSettings({ reduceMotion: false }, false, true).reduceMotion, false);
  assert.equal(sanitizeSettings({ reduceMotion: true }, false, false).reduceMotion, true);
});

test('sanitize: valid values kept, junk falls back to defaults, text scale snaps to an offered size', () => {
  const s = sanitizeSettings({ colorblind: 'rg', textScale: 1.3, captions: true }, false, false);
  assert.equal(s.colorblind, 'rg'); assert.equal(s.textScale, 1.3); assert.equal(s.captions, true);
  assert.equal(sanitizeSettings({ colorblind: 'by' }, false, false).colorblind, 'by');
  const bad = sanitizeSettings({ colorblind: 'purple', textScale: 'huge', captions: 'yes' }, false, false);
  assert.equal(bad.colorblind, 'off'); assert.equal(bad.textScale, 1); assert.equal(bad.captions, false);
  for (const [v, want] of [[5, 1.3], [0.2, 1], [1.12, 1.15], [1.24, 1.3], [NaN, 1], [Infinity, 1]] as const) {
    assert.equal(sanitizeSettings({ textScale: v }, false, false).textScale, want, String(v));
  }
  assert.deepEqual([...TEXT_SCALES], [1, 1.15, 1.3]);
  assert.equal(cleanSettings({ colorblind: ['rg'] }).colorblind, undefined);
});

test('save code: accessibility settings travel to another device', () => {
  const store = { [K.settings]: JSON.stringify({ name: 'x', colorblind: 'by', textScale: 1.15, captions: true, reduceMotion: true }) };
  const r = parseSaveCode(exportSaveCode(store));
  assert.ok(r.ok); if (!r.ok) return;
  const st = JSON.parse(applySave(r.payload, {}).set[K.settings]);
  assert.equal(st.colorblind, 'by'); assert.equal(st.textScale, 1.15); assert.equal(st.captions, true); assert.equal(st.reduceMotion, true);
});

test('captions: known sounds only, de-duplicated with a count, rate-limited, at most MAX_LINES, expire', () => {
  const q = new CaptionQueue();
  assert.equal(q.push('step', 0), false, 'footsteps have no caption');
  assert.ok(q.push('angry', 0));
  assert.ok(q.push('angry', 100)); // same caption again: refresh + ×2, no new line
  assert.equal(q.lines.length, 1); assert.equal(q.lines[0].count, 2); assert.equal(q.lines[0].text, CAPTION_TEXT.angry);
  assert.equal(q.push('cash', 120), false, 'a second new line within MIN_GAP_MS is dropped');
  assert.ok(q.push('cash', 120 + MIN_GAP_MS));
  assert.ok(q.push('door', 1000)); assert.ok(q.push('mistake', 1400));
  assert.equal(q.lines.length, MAX_LINES);
  // important sounds (prio 3) bypass the gap and push out a less important line
  assert.ok(q.push('siren', 1401));
  assert.equal(q.lines.length, MAX_LINES);
  assert.ok(q.lines.some(l => l.text === '[警笛]'));
  assert.ok(q.lines.some(l => l.text === '[客人生氣]'), 'the important line stays');
  assert.ok(q.expire(1401 + SHOW_MS + 1)); assert.equal(q.lines.length, 0);
  // far-away sounds are marked
  q.push('crash', 99999, 30); assert.equal(q.lines[0].far, true);
});
