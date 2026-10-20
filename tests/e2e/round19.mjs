// Round 19: 打工人的號角 invite links. Browser A creates a room and copies the invite link from the lobby UI
// (clipboard), browser B opens that link, confirms its name and lands in the same lobby. Also checks that
// the ?join param is stripped, a bad code is rejected, and a gone room gives a friendly error.
// Two browser contexts on ONE machine — not real devices.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = m => { console.log('FAIL', m, JSON.stringify(errors)); process.exitCode = 1; };
const origin = new globalThis.URL(URL).origin;

const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
await hostCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const host = await hostCtx.newPage();
host.on('pageerror', e => errors.push('A: ' + e));
await host.goto(URL);
await host.fill('#m-name', '房主A');
await host.click('#m-mp'); await host.click('#m-create');
await host.waitForSelector('#l-code');
const code = (await host.textContent('#l-code')).trim();
for (const id of ['#l-copy', '#l-link', '#l-line', '#l-invite']) if (!(await host.$(id))) fail('lobby is missing ' + id);
const lineHref = await host.getAttribute('#l-line', 'href');
if (!lineHref.startsWith('https://line.me/R/share?text=') || !decodeURIComponent(lineHref).includes(`?join=${code}`)) fail('bad LINE link ' + lineHref);
await host.click('#l-link');
await host.waitForFunction(() => /已複製/.test(document.getElementById('l-sharemsg')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => fail('no copy confirmation'));
let link = await host.evaluate(() => navigator.clipboard.readText()).catch(() => '');
const shown = await host.inputValue('#l-invite');
if (link !== shown) console.log('clipboard', JSON.stringify(link), 'differs from the shown link; using the shown one');
link ||= shown;
if (!link.includes(`join=${code}`)) fail('invite link has no code: ' + link);
await host.screenshot({ path: `${OUT}/r19-lobby-desktop.png` });

// B: a phone-sized touch context opens the invite link
const phoneCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const phone = await phoneCtx.newPage();
phone.on('pageerror', e => errors.push('B: ' + e));
await phone.goto(link);
await phone.waitForSelector('#iv-join');
if ((await phone.textContent('#iv-code')).trim() !== code) fail('invite screen shows the wrong code');
if (/join=/.test(await phone.evaluate(() => location.search))) fail('?join was not stripped from the URL');
await phone.screenshot({ path: `${OUT}/r19-invite-phone.png` });
await phone.fill('#iv-name', '手機B');
await phone.click('#iv-join');
await phone.waitForSelector('#l-ready', { timeout: 20000 });
const phoneCode = (await phone.textContent('#l-code')).trim();
await host.waitForFunction(() => document.querySelectorAll('.players li').length === 2, null, { timeout: 10000 }).catch(() => fail('host does not see B'));
const names = await host.$$eval('.players li b', els => els.map(e => e.textContent));
if (phoneCode !== code || !names.some(n => n.includes('手機B'))) fail(`B landed in ${phoneCode}, host sees ${names}`);
await host.waitForTimeout(700); // the lobby card pops in again on every lobby update
await host.screenshot({ path: `${OUT}/r19-lobby-desktop-2p.png` });
await phone.screenshot({ path: `${OUT}/r19-lobby-phone.png` });
await host.setViewportSize({ width: 844, height: 390 }); await host.waitForTimeout(300);
await host.screenshot({ path: `${OUT}/r19-lobby-host-phone.png` });
const fits = await host.evaluate(() => { const r = document.getElementById('l-start')?.getBoundingClientRect(); return !!r && r.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth; });
if (!fits) console.log('note: host lobby at 844x390 needs scrolling to reach 開始營業');

// a malformed code never connects; it lands on the menu with a message
const bad = await phoneCtx.newPage();
await bad.goto(new globalThis.URL('?join=AB<1', URL).toString());
await bad.waitForSelector('#m-err');
const badMsg = await bad.textContent('#m-err');
if (!/房間碼不正確/.test(badMsg) || /join=/.test(await bad.evaluate(() => location.search))) fail('bad code not handled: ' + badMsg);

// a room that doesn't exist (all codes use the server alphabet; ZZZZZ is very unlikely to be live)
const gone = await phoneCtx.newPage();
await gone.goto(new globalThis.URL(`?join=${code === 'ZZZZZ' ? 'YYYYY' : 'ZZZZZ'}`, URL).toString());
await gone.click('#iv-join');
await gone.waitForFunction(() => /找不到這個房間/.test(document.getElementById('mp-banner')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => fail('no friendly gone-room error'));
const bannerTop = await gone.$eval('#mp-banner', el => el.getBoundingClientRect().bottom);
if (bannerTop > 390) fail('gone-room error is off-screen on a phone');
await gone.screenshot({ path: `${OUT}/r19-gone-phone.png` });

console.log(JSON.stringify({ code, link, phoneCode, names, badMsg: badMsg.trim(), errors }, null, 1));
if (errors.length) process.exitCode = 1;
await browser.close();
