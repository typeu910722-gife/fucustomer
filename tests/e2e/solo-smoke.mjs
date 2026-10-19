// Browser smoke test: open the built client, start solo, walk, interact, screenshot.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const URL = process.env.GAME_URL ?? 'http://localhost:8787/';
const OUT = process.env.OUT ?? '.';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL);
await page.fill('#m-name', '測試店員');
await page.click('#m-solo-new');
await page.waitForFunction(() => window.__game?.started, null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/solo-start.png` });
// walk forward toward counter, then look around
await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
const st = await page.evaluate(() => ({ phase: window.__game.snap.phase, players: window.__game.snap.players.length, money: window.__game.snap.money }));
await page.screenshot({ path: `${OUT}/solo-walk.png` });
console.log(JSON.stringify({ st, errors }, null, 1));
await browser.close();
