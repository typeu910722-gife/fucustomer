// Friend stores: owner gets a store code and locks/unlocks; a friend (second browser) raids the unlocked store,
// then finds it locked; the owner collects the damage report. Needs the local game server (npm run build && npm start).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const out = {};
const stars = {}; for (let c = 1; c <= 6; c++) for (let i = 1; i <= 5; i++) stars[`${c}-${i}`] = 2;
async function page(name, store) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(name + ': ' + String(e)));
  await pg.goto(URL);
  await pg.evaluate(([name, stars, store]) => {
    localStorage.setItem('fucustomer.settings.v1', JSON.stringify({ quality: 'low', name }));
    localStorage.setItem('fucustomer.flags.v1', JSON.stringify({ tutorialDone: true, seenKarens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'] }));
    localStorage.setItem('fucustomer.career.v1', JSON.stringify({ version: 1, level: 28, wallet: 100, stars, clears: { ...stars }, stats: { shifts: 40, wins: 40 }, store }));
  }, [name, stars, store]);
  await pg.reload();
  await pg.click('#m-career');
  await pg.click('[data-tab="store"]');
  return pg;
}
const save = { day: 3, money: 3000, rating: 4, backstock: { drinks: 20, snacks: 20, bento: 20 }, shelves: { drinks: 8, snacks: 8, bento: 6 }, upgrades: { shelves: 0, register2: 0, coffee: 0, scanner: 0, camera: 0 }, totalRevenue: 0 };
const owner = await page('店長阿明', { name: '阿明手搖', invested: 2500, save, days: 2, negDays: 0, staff: { name: '小陳', mood: 70, quit: false }, wage: 'fair', bestDay: 0, withdrawn: 0, map: 'boba' });
await owner.click('#st-upload');
await owner.waitForSelector('#st-lock', { timeout: 10000 });
const code = await owner.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).store.online.code);
out.code = code;
out.unlockedText = await owner.evaluate(() => document.getElementById('c-body').innerText.includes('沒鎖門'));
await owner.screenshot({ path: `${OUT}/r12-owner.png` });

// the friend raids the unlocked store
const friend = await page('小華', null);
await friend.fill('#st-raid-code', code);
await friend.click('#st-raid');
await friend.waitForFunction(() => window.__game?.started && window.__game.snap, null, { timeout: 25000 });
out.raidTitle = await friend.evaluate(() => window.__game.snap.shift.title);
await friend.keyboard.press('Enter');
await friend.waitForFunction(() => window.__game.snap.phase === 'open', null, { timeout: 25000 });
await friend.keyboard.press('g'); // litter
await friend.waitForTimeout(800);
out.hint = await friend.evaluate(() => document.getElementById('hintbar')?.innerText ?? '');
await friend.screenshot({ path: `${OUT}/r12-raid.png` });
out.litter = await friend.evaluate(() => window.__game.conn.room.world.raid.litter);
await friend.evaluate(() => { const w = window.__game.conn.room.world; w.raid.score += 300; w.phaseLeft = 0.3; });
await friend.waitForFunction(() => /搗亂結束/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
const btn = await friend.$('#sum-ok, #res-ok');
if (btn && !/搗亂結束/.test(await friend.evaluate(() => document.body.innerText))) { await btn.click(); await friend.waitForFunction(() => /搗亂結束/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {}); }
out.raidMsg = await friend.evaluate(() => document.querySelector('.card')?.innerText ?? '');
out.friendWallet = await friend.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).wallet);
await friend.screenshot({ path: `${OUT}/r12-raid-done.png` });

// owner locks the door; now the friend only gets the locked-door screen
await owner.click('#st-lock');
await owner.waitForFunction(() => document.getElementById('c-body').innerText.includes('店門已鎖'), null, { timeout: 10000 });
await friend.click('#msg-ok');
await friend.fill('#st-raid-code', code);
await friend.click('#st-raid');
await friend.waitForSelector('#rd-trash', { timeout: 10000 });
out.lockedScreen = await friend.evaluate(() => document.querySelector('.card').innerText.slice(0, 30));
// owner collects the report: money and rating go down
const before = await owner.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).store.save.money);
await owner.click('#st-reports');
await owner.waitForFunction(() => /小華/.test(document.getElementById('st-msg')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => {});
out.report = await owner.evaluate(() => document.getElementById('st-msg')?.innerText ?? '');
out.loss = before - await owner.evaluate(() => JSON.parse(localStorage.getItem('fucustomer.career.v1')).store.save.money);
await owner.screenshot({ path: `${OUT}/r12-report.png` });
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
if (errors.length || !/^[A-Z0-9]{6}$/.test(code) || !out.unlockedText || !/搗亂/.test(out.raidTitle) || out.litter < 1 || !/搗亂結束/.test(out.raidMsg) || !(out.friendWallet > 100) || !/鎖門/.test(out.lockedScreen) || !/小華/.test(out.report) || !(out.loss > 0)) process.exitCode = 1;
await browser.close();
