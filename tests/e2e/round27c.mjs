// Round 27c: 雲端備份 (cloud save) in a real browser against a real Node game server — ONE machine, one browser
// (同一台電腦), not two real devices and not the Cloudflare deployment (tests/cf.test.mjs covers the worker locally).
// The script starts its own server (built client from STATIC_DIR, default ./dist) with a signed-in licence written to
// its licence folder beforehand: Google sign-in itself can't run in a test, so the "signed in" state is a seeded session.
//  (1) not signed in → the cloud section explains that it needs Google sign-in;
//  (2) signed in → 「☁ 上傳到雲端」, last-upload time shown, auto-upload toggle remembered;
//  (3) offline → a friendly error, local progress untouched;
//  (4) "new device": localStorage wiped except the sign-in → 「☁ 從雲端還原」 shows device vs cloud, double confirm,
//      progress restored, paid packs NOT granted, sign-in kept;
//  (5) 「刪除雲端存檔」 (double press) → restore then says there is no cloud save.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.OUT ?? '.';
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? path.join(ROOT, 'dist'));
const PORT = Number(process.env.R27C_PORT ?? 28000 + Math.floor(Math.random() * 1500));
const URL = `http://127.0.0.1:${PORT}/`;
const fail = m => { console.log('FAIL', m); process.exitCode = 1; };
const report = {};

// ---- own server with a seeded signed-in licence ----
const base = mkdtempSync(path.join(tmpdir(), 'bk-r27c-'));
const LIC = path.join(base, 'licenses'); mkdirSync(LIC);
const SESSION = 'r27c-session-' + PORT, NO = '2727-0027';
const sha = s => createHash('sha256').update(s).digest('hex');
const OWNER = sha('google:r27c-tester');
writeFileSync(path.join(LIC, OWNER + '.json'), JSON.stringify({ owner: OWNER, no: NO, sessions: [sha(SESSION)], createdAt: 1, updatedAt: 1, name: '雲端測試', level: 1, rank: '', title: '', avatar: '🧑', stars: 0, achievements: 0, storeName: '', quote: '' }));
if (!existsSync(path.join(STATIC_DIR, 'index.html'))) { console.log('FAIL no built client in', STATIC_DIR); process.exit(1); }
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), STATIC_DIR, DATA_DIR: path.join(base, 'rooms'), LICENSES_DIR: LIC, CLOUDSAVES_DIR: path.join(base, 'cloudsaves'), BK_CLOUDSAVE_MIN_S: '0', GOOGLE_CLIENT_ID: '' },
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server start timeout')), 20000);
  server.stdout.on('data', d => { if (String(d).includes('server on')) { clearTimeout(t); res(); } });
  server.stderr.on('data', d => process.stderr.write(d));
});

const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|accounts\.google|GSI/.test(m.text())) errors.push(m.text()); });
  const flags = JSON.stringify({ tutorialDone: true, seenKarens: [], seenMaps: ['convenience'] });
  const openBackup = async () => {
    await pg.waitForSelector('#m-settings', { timeout: 15000 });
    await pg.click('#m-settings'); await pg.click('#s-backup');
    await pg.waitForSelector('.card.bk', { timeout: 5000 });
  };
  const ls = k => pg.evaluate(k => localStorage.getItem(k), k);

  // (1) not signed in
  await pg.goto(URL);
  await pg.evaluate(f => { localStorage.clear(); localStorage.setItem('fucustomer.flags.v1', f); localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.5 })); }, flags);
  await pg.reload(); await openBackup();
  report.signedOut = (await pg.textContent('#bk-cloud-need').catch(() => '')) ?? '';
  if (!/Google 登入/.test(report.signedOut)) fail('signed-out explanation missing');
  if (await pg.$('#bk-up')) fail('upload button shown without sign-in');
  await pg.screenshot({ path: `${OUT}/r27c-signed-out.png` });

  // (2) signed in, some progress (and this device "owns" a paid pack)
  await pg.evaluate(([f, s, no]) => {
    localStorage.setItem('fucustomer.account.v1', JSON.stringify({ no, session: s }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 14, exp: 10, wallet: 4321, stars: {}, stats: { shifts: 9 }, shop: { owned: [], entitlements: ['pack_supporter'], equipped: {} } }));
    localStorage.setItem('fucustomer.avatar.v1', '🐱');
  }, [flags, SESSION, NO]);
  await pg.reload(); await openBackup();
  report.before = await pg.textContent('#bk-cloud-last');
  await pg.click('#bk-up');
  await pg.waitForFunction(() => /已上傳/.test(document.getElementById('bk-cres')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => fail('upload'));
  report.uploaded = await pg.textContent('#bk-cres');
  report.lastShown = await pg.textContent('#bk-cloud-last');
  if (!/上次上傳：.*Lv\.14/.test(report.lastShown ?? '')) fail('last upload time not shown: ' + report.lastShown);
  await pg.check('#bk-auto');
  report.autoPref = JSON.parse(await ls('fucustomer.cloud.v1')).auto;
  if (report.autoPref !== true) fail('auto toggle not remembered');
  await pg.screenshot({ path: `${OUT}/r27c-uploaded.png` });

  // (3) offline: friendly message, nothing on the device changes
  await pg.route('**/api/cloudsave', r => r.abort('internetdisconnected'));
  const careerBefore = await ls('fucustomer.career.v1');
  await pg.click('#bk-up');
  await pg.waitForFunction(() => /連不上雲端/.test(document.getElementById('bk-cres')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => fail('offline message'));
  report.offline = await pg.textContent('#bk-cres');
  if (await ls('fucustomer.career.v1') !== careerBefore) fail('offline upload changed local progress');
  await pg.unroute('**/api/cloudsave');

  // (4) "new device": everything wiped except the sign-in
  await pg.evaluate(([f, s, no]) => {
    localStorage.clear();
    localStorage.setItem('fucustomer.account.v1', JSON.stringify({ no, session: s }));
    localStorage.setItem('fucustomer.flags.v1', f);
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', renderScale: 0.5 }));
  }, [flags, SESSION, NO]);
  await pg.reload(); await openBackup();
  await pg.click('#bk-down');
  await pg.waitForSelector('#bk-capply', { timeout: 10000 }).catch(() => fail('restore view'));
  report.compare = (await pg.textContent('.bk-cmp').catch(() => ''))?.replace(/\s+/g, ' ');
  if (!/雲端存檔/.test(report.compare ?? '') || !/Lv\.14/.test(report.compare ?? '') || !/Lv\.1 /.test(report.compare ?? '')) fail('comparison table: ' + report.compare);
  await pg.screenshot({ path: `${OUT}/r27c-restore-compare.png` });
  await pg.click('#bk-capply');
  report.armed = await pg.textContent('#bk-capply');
  if (!/再按一次/.test(report.armed ?? '')) fail('no double confirm');
  if (JSON.parse((await ls('fucustomer.career.v1')) ?? 'null')?.level === 14) fail('restored after one press');
  await Promise.all([pg.waitForEvent('load', { timeout: 15000 }), pg.click('#bk-capply')]);
  await pg.waitForSelector('#m-settings', { timeout: 15000 });
  const career = JSON.parse((await ls('fucustomer.career.v1')) ?? 'null');
  report.restored = { level: career?.level, wallet: career?.wallet, entitlements: career?.shop?.entitlements, avatar: await ls('fucustomer.avatar.v1'), account: !!(await ls('fucustomer.account.v1')) };
  if (career?.level !== 14 || career?.wallet !== 4321) fail('progress not restored: ' + JSON.stringify(report.restored));
  if ((career?.shop?.entitlements ?? []).length) fail('cloud restore granted paid packs');
  if (!report.restored.account) fail('sign-in lost on restore');
  if (report.restored.avatar !== '🐱') fail('avatar not restored');

  // (5) delete (double press), then there is nothing to restore
  await openBackup();
  await pg.click('#bk-del');
  if (!/再按一次/.test((await pg.textContent('#bk-del')) ?? '')) fail('delete without double confirm');
  await pg.click('#bk-del');
  await pg.waitForFunction(() => /已刪除/.test(document.getElementById('bk-cres')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => fail('delete'));
  await pg.click('#bk-down');
  await pg.waitForFunction(() => /還沒有存檔/.test(document.getElementById('bk-cres')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => fail('after delete'));
  report.afterDelete = await pg.textContent('#bk-cres');
  await pg.screenshot({ path: `${OUT}/r27c-deleted.png` });
} catch (e) { fail(String(e)); }
finally {
  await browser.close();
  server.kill('SIGTERM');
}
if (errors.length) fail('page errors: ' + errors.join(' | '));
console.log(JSON.stringify({ report, errors }, null, 1));
console.log(process.exitCode ? 'round27c: FAIL' : 'round27c: OK');
