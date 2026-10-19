// Renders the app icon, splash screens and store graphics from SVG/HTML using headless Chromium.
// Usage: node store/src/make.mjs   (outputs into store/ and assets/)
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const fg = readFileSync(path.join(HERE, 'fg.svg'), 'utf8');
const BG = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset="1" stop-color="#c2255c"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#ffe066" stop-opacity=".55"/><stop offset="1" stop-color="#ffe066" stop-opacity="0"/></radialGradient></defs>
<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>`;
const TITLE = `<text x="512" y="930" text-anchor="middle" font-family="WenQuanYi Zen Hei, Noto Sans CJK TC, sans-serif" font-weight="900" font-size="150" fill="#fff" stroke="#862e9c" stroke-width="14" paint-order="stroke">奧客退散</text>`;
const svg = (body, w = 1024, h = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const icon = svg(BG + `<g transform="translate(0 -40)">${fg}</g>` + TITLE);
const iconFg = svg(`<g transform="translate(512 512) scale(.62) translate(-512 -540)">${fg}</g>`);
const iconBg = svg(BG);
const splash = (dark) => svg(`<rect width="2732" height="2732" fill="${dark ? '#141821' : '#fff4e6'}"/>
  <g transform="translate(1366 1250) scale(1.1) translate(-512 -512)">${BG.replace('<rect width="1024" height="1024" fill="url(#bg)"/>', '<rect width="1024" height="1024" rx="220" fill="url(#bg)"/>').replace('<rect width="1024" height="1024" fill="url(#glow)"/>', '<rect width="1024" height="1024" rx="220" fill="url(#glow)"/>')}<g transform="translate(0 -40)">${fg}</g>${TITLE}</g>
  <text x="1366" y="2000" text-anchor="middle" font-family="WenQuanYi Zen Hei, sans-serif" font-size="90" fill="${dark ? '#ced4da' : '#495057'}">FUCustomer</text>`, 2732, 2732);
// Steam library capsule art / store header (landscape)
const capsule = (w, h) => svg(`<defs><linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset="1" stop-color="#5f3dc4"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#bg2)"/>
  <g transform="translate(${w * 0.79} ${h * 0.55}) scale(${h / 1100}) translate(-512 -560)">${fg}</g>
  <text x="${w * 0.06}" y="${h * 0.48}" font-family="WenQuanYi Zen Hei, sans-serif" font-weight="900" font-size="${h * 0.26}" fill="#fff" stroke="#3b1f6e" stroke-width="${h * 0.02}" paint-order="stroke">奧客退散</text>
  <text x="${w * 0.065}" y="${h * 0.7}" font-family="sans-serif" font-weight="900" font-size="${h * 0.12}" fill="#ffe066" letter-spacing="${h * 0.01}">FUCustomer</text>`, w, h);

const jobs = [
  ['assets/icon-only.png', icon, 1024, 1024],
  ['assets/icon-foreground.png', iconFg, 1024, 1024],
  ['assets/icon-background.png', iconBg, 1024, 1024],
  ['assets/splash.png', splash(false), 2732, 2732],
  ['assets/splash-dark.png', splash(true), 2732, 2732],
  ['store/icon-512.png', icon, 512, 512],
  ['store/icon-1024.png', icon, 1024, 1024],
  ['store/steam-header-460x215.png', capsule(460, 215), 460, 215],
  ['store/steam-capsule-616x353.png', capsule(616, 353), 616, 353],
  ['store/steam-library-hero-3840x1240.png', capsule(3840, 1240), 3840, 1240],
  ['store/google-play-feature-1024x500.png', capsule(1024, 500), 1024, 500],
  ['client/public/icon-192.png', icon, 192, 192],
  ['client/public/icon-512.png', icon, 512, 512],
];
const browser = await pw.chromium.launch();
for (const [out, s, w, h] of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${s.replace(/width="\d+" height="\d+" viewBox/, `width="${w}" height="${h}" viewBox`)}</body></html>`);
  mkdirSync(path.dirname(path.join(ROOT, out)), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, out), omitBackground: true });
  await page.close();
  console.log('wrote', out);
}
await browser.close();
