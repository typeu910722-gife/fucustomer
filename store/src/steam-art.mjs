// Steam store / library graphics at the exact sizes Steamworks asks for, composed in HTML and rendered with
// headless Chromium. Characters are drawn as SVG in the same chibi style as the in-game 3D models; backgrounds
// are blurred real screenshots from store/steam/screenshots (run steam-screens.mjs first).
// Usage: node store/src/steam-art.mjs   → store/steam/*.png and store/steam/achievements/*.png
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'store/steam');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(path.join(OUT, 'achievements'), { recursive: true });

// Full Open Huninn font (SIL OFL) – the same face the game UI uses. Downloaded once into .cache/ (not committed).
const FONT = path.join(ROOT, '.cache/jf-openhuninn-2.1.ttf');
if (!existsSync(FONT)) execFileSync('python3', ['-c', `import urllib.request,os;os.makedirs(os.path.dirname(${JSON.stringify(FONT)}),exist_ok=True);urllib.request.urlretrieve('https://github.com/justfont/open-huninn-font/releases/download/v2.1/jf-openhuninn-2.1.ttf',${JSON.stringify(FONT)})`]);
const fontB64 = readFileSync(FONT).toString('base64');
const shotB64 = name => { const f = path.join(OUT, 'screenshots', name); return existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString('base64')}` : ''; };

const INK = '#2a1f3d';
const CSS = `@font-face { font-family: Huninn; src: url(data:font/ttf;base64,${fontB64}); }
* { box-sizing: border-box; margin: 0; }
body { font-family: Huninn, "Noto Color Emoji", sans-serif; background: transparent; }
.art { position: relative; overflow: hidden; }
.bgshot { position: absolute; inset: -4%; background-size: cover; background-position: center; filter: blur(var(--blur, 6px)) saturate(1.15); }
.tint { position: absolute; inset: 0; background: linear-gradient(115deg, rgba(44,35,80,.94) 0%, rgba(95,67,196,.78) 42%, rgba(255,93,93,.55) 100%); }
.stripes { position: absolute; inset: 0; background: repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 var(--sw, 26px), transparent var(--sw, 26px) calc(var(--sw, 26px) * 2)); }
.glow { position: absolute; border-radius: 50%; background: radial-gradient(circle, rgba(255,194,61,.55), rgba(255,194,61,0) 70%); }
.logo { position: absolute; display: flex; flex-direction: column; align-items: center; transform: rotate(-4deg); }
.logo .l { font-weight: 900; line-height: .98; color: #fff; -webkit-text-stroke: calc(var(--fs) * .14) ${INK}; paint-order: stroke fill; text-shadow: 0 calc(var(--fs) * .07) 0 ${INK}; font-size: var(--fs); letter-spacing: .02em; white-space: nowrap; }
.logo .l2 { color: #ff5d5d; margin-left: .9em; }
.logo .pill { margin-top: calc(var(--fs) * .14); font-size: calc(var(--fs) * .22); font-weight: 900; letter-spacing: .28em; padding: .12em .5em .12em .78em; background: #ffc23d; color: ${INK}; border: calc(var(--fs) * .035) solid ${INK}; border-radius: 99px; box-shadow: 0 calc(var(--fs) * .045) 0 ${INK}; white-space: nowrap; }
.logo.one { flex-direction: column; } .logo.one .row { display: flex; align-items: baseline; }
.logo.one .l2 { margin-left: 0; }
.center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; } .center .logo { position: relative; }
.chars { position: absolute; }
.chars svg { position: absolute; overflow: visible; }
.bubble { position: absolute; background: #fff; color: ${INK}; border: calc(var(--bs) * .09) solid ${INK}; border-radius: calc(var(--bs) * .6); padding: .18em .55em; font-size: var(--bs); font-weight: 900; white-space: nowrap; box-shadow: 0 calc(var(--bs) * .12) 0 ${INK}; }
.bubble::after { content: ''; position: absolute; bottom: calc(var(--bs) * -.42); left: 22%; width: calc(var(--bs) * .5); height: calc(var(--bs) * .5); background: #fff; border-right: calc(var(--bs) * .09) solid ${INK}; border-bottom: calc(var(--bs) * .09) solid ${INK}; transform: rotate(45deg) skew(8deg, 8deg); }
.bubble.r::after { left: auto; right: 22%; }
.bubble.red { background: #ff5d5d; color: #fff; } .bubble.red::after { background: #ff5d5d; }
`;

// ---------- chibi characters (SVG, 240×360 box, feet at y≈350) ----------
const SK = { a: '#ffd8b5', b: '#f1b98a', c: '#c98b5e', d: '#8d5a3b' };
function chibi(o) {
  const { skin = SK.a, hair = '#3b2a20', shirt = '#48a6ff', pants = '#3d4466', shoes = '#2a1f3d', mood = 'happy', apron = null, style = 'short',
    armL = 20, armR = -20, legL = 0, legR = 0, prop = '', hat = '', cheeks = true, glasses = false } = o;
  const st = `stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;
  const arm = (x, ang, side) => `<g transform="rotate(${ang} ${x} 200)"><rect x="${x - 15}" y="192" width="30" height="74" rx="15" fill="${shirt}" ${st}/><circle cx="${x}" cy="270" r="17" fill="${skin}" ${st}/>${side === 'R' && prop ? prop : ''}</g>`;
  const leg = (x, ang) => `<g transform="rotate(${ang} ${x} 270)"><rect x="${x - 17}" y="262" width="34" height="66" rx="12" fill="${pants}" ${st}/><rect x="${x - 23}" y="318" width="46" height="26" rx="13" fill="${shoes}" ${st}/></g>`;
  const hairs = {
    short: `<path d="M44 108 C40 40 100 18 132 24 C186 30 206 70 198 112 C186 84 160 70 128 74 C100 76 70 70 44 108Z" fill="${hair}" ${st}/>`,
    bob: `<path d="M38 140 C26 50 90 16 128 20 C190 22 214 76 204 142 C196 120 194 92 178 80 C150 92 104 92 66 78 C52 96 48 118 38 140Z" fill="${hair}" ${st}/>`,
    curly: `<g fill="${hair}" ${st}><circle cx="62" cy="76" r="28"/><circle cx="96" cy="48" r="30"/><circle cx="140" cy="44" r="30"/><circle cx="176" cy="70" r="28"/><circle cx="190" cy="104" r="22"/><circle cx="50" cy="108" r="20"/></g>`,
    spiky: `<path d="M46 110 L40 60 L70 70 L76 26 L106 54 L124 14 L144 52 L176 28 L178 70 L208 62 L196 112 C170 84 80 84 46 110Z" fill="${hair}" ${st}/>`,
    bun: `<g><circle cx="122" cy="20" r="26" fill="${hair}" ${st}/><path d="M42 118 C34 44 96 30 122 32 C170 32 210 60 200 118 C186 88 160 74 120 74 C84 76 56 90 42 118Z" fill="${hair}" ${st}/></g>`,
    bald: `<path d="M50 120 C44 104 46 92 52 84 M192 120 C198 104 196 92 190 84" fill="none" stroke="${hair}" stroke-width="16" stroke-linecap="round"/>`,
  };
  const eyes = {
    happy: `<path d="M84 122 q12 -14 24 0 M136 122 q12 -14 24 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M98 148 q24 26 48 0 Z" fill="#c63a3a" ${st}/>`,
    grin: `<circle cx="96" cy="120" r="9" fill="${INK}"/><circle cx="148" cy="120" r="9" fill="${INK}"/><path d="M80 98 l28 6 M164 98 l-28 6" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M96 146 q26 22 52 0 Z" fill="#fff" ${st}/>`,
    angry: `<path d="M78 96 l34 16 M166 96 l-34 16" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><circle cx="98" cy="124" r="8" fill="${INK}"/><circle cx="146" cy="124" r="8" fill="${INK}"/><ellipse cx="122" cy="158" rx="22" ry="17" fill="#7a1f2b" ${st}/><path d="M108 152 h28" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`,
    shock: `<circle cx="96" cy="118" r="13" fill="#fff" ${st}/><circle cx="148" cy="118" r="13" fill="#fff" ${st}/><circle cx="96" cy="120" r="5" fill="${INK}"/><circle cx="148" cy="120" r="5" fill="${INK}"/><ellipse cx="122" cy="160" rx="12" ry="16" fill="#7a1f2b" ${st}/>`,
    smug: `<path d="M82 116 h26 M136 116 h26" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M80 98 l26 -6 M164 98 l-26 -6" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M104 150 q22 12 36 -6" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
  };
  const apronSvg = apron ? `<path d="M84 196 h72 v62 q-36 12 -72 0 Z" fill="${apron}" ${st}/><rect x="104" y="214" width="32" height="20" rx="5" fill="#fff" opacity=".85"/>` : '';
  const red = mood === 'angry' ? `<ellipse cx="122" cy="116" rx="76" ry="70" fill="#ff3b3b" opacity=".22"/>` : '';
  return `<g>
    ${leg(102, legL)}${leg(140, legR)}
    ${Math.abs(armL) <= 90 ? arm(76, armL, 'L') : ''}
    <rect x="78" y="182" width="86" height="92" rx="26" fill="${shirt}" ${st}/>${apronSvg}
    ${Math.abs(armR) <= 90 ? arm(166, armR, 'R') : ''}
    <circle cx="122" cy="114" r="80" fill="${skin}" ${st}/>${red}
    ${hairs[style] ?? ''}${hat}
    ${cheeks ? `<ellipse cx="78" cy="146" rx="13" ry="8" fill="#ff7a7a" opacity=".55"/><ellipse cx="166" cy="146" rx="13" ry="8" fill="#ff7a7a" opacity=".55"/>` : ''}
    ${eyes[mood] ?? eyes.happy}
    ${Math.abs(armL) > 90 ? arm(76, armL, 'L') : ''}${Math.abs(armR) > 90 ? arm(166, armR, 'R') : ''}
    ${glasses ? `<g fill="none" stroke="${INK}" stroke-width="6"><circle cx="96" cy="120" r="18"/><circle cx="148" cy="120" r="18"/><path d="M114 120 h16"/></g>` : ''}
  </g>`;
}
const anger = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#ff3b3b" stroke-width="9" stroke-linecap="round" fill="none"><path d="M-14 -4 q10 0 10 -10 M14 -4 q-10 0 -10 -10 M-14 4 q10 0 10 10 M14 4 q-10 0 -10 10"/></g>`;
const speed = (x, y, s = 1, col = '#fff') => `<g transform="translate(${x} ${y}) scale(${s})" stroke="${col}" stroke-width="10" stroke-linecap="round" opacity=".9"><path d="M0 0 h-90 M10 36 h-130 M-6 72 h-80"/></g>`;
const phone = `<g transform="translate(166 262) rotate(-20)"><rect x="-12" y="-46" width="30" height="50" rx="6" fill="${INK}"/><rect x="-7" y="-40" width="20" height="34" rx="3" fill="#48a6ff"/><circle cx="3" cy="-23" r="5" fill="#ff5d5d"/></g>`;
const receipt = `<g transform="translate(166 280) rotate(10)"><path d="M-14 -40 h34 v52 l-6 -5 -6 5 -6 -5 -6 5 -5 -5 -6 5 Z" fill="#fff" stroke="${INK}" stroke-width="5"/><path d="M-6 -28 h18 M-6 -18 h18 M-6 -8 h12" stroke="#85789b" stroke-width="4"/></g>`;
const mop = `<g transform="translate(166 270) rotate(30)"><rect x="-5" y="-150" width="10" height="190" rx="5" fill="#cf8f00" stroke="${INK}" stroke-width="5"/><path d="M-30 36 h60 l8 34 h-76 Z" fill="#48a6ff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/></g>`;
const cap = col => `<path d="M48 76 C60 22 186 22 196 76 Z" fill="${col}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M150 72 h66 q8 0 6 8 l-4 6 h-70 Z" fill="${col}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
const crown = `<path d="M70 40 l20 30 l32 -40 l32 40 l20 -30 l-8 50 h-88 Z" fill="#ffc23d" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;

// The cast: our clerk throwing a karen out, plus a few store-signature karens.
const CAST = {
  clerk: (o = {}) => chibi({ skin: SK.b, hair: '#2a1f3d', style: 'spiky', shirt: '#fff6e5', apron: '#39c96b', pants: '#4a3d63', mood: 'grin', armL: -150, armR: 160, legL: -14, legR: 18, hat: cap('#39c96b'), ...o }),
  flyer: (o = {}) => chibi({ skin: SK.a, hair: '#c8a26a', style: 'bob', shirt: '#ff5d5d', pants: '#2a1f3d', mood: 'shock', armL: 140, armR: -140, legL: 30, legR: -36, prop: receipt, ...o }),
  boss: (o = {}) => chibi({ skin: SK.c, hair: '#5b3a29', style: 'curly', shirt: '#8f6bff', pants: '#2a1f3d', mood: 'angry', armL: 40, armR: -120, prop: receipt, hat: crown, ...o }),
  streamer: (o = {}) => chibi({ skin: SK.a, hair: '#ff8fc7', style: 'bun', shirt: '#ffc23d', pants: '#48a6ff', mood: 'smug', armL: 10, armR: -150, prop: phone, glasses: true, ...o }),
  uncle: (o = {}) => chibi({ skin: SK.b, hair: '#85789b', style: 'bald', shirt: '#22b8cf', pants: '#5f43c4', mood: 'angry', armL: 30, armR: -100, ...o }),
  buddy: (o = {}) => chibi({ skin: SK.d, hair: '#1b1430', style: 'short', shirt: '#fff6e5', apron: '#48a6ff', pants: '#4a3d63', mood: 'happy', armL: 30, armR: -60, prop: mop, hat: cap('#48a6ff'), ...o }),
};
/** Places a character: (x, y) = feet centre in px, h = height in px, r = rotation, flip = mirror. */
const put = (svg, x, y, h, r = 0, flip = false, extra = '') => {
  const s = h / 340;
  return `<svg style="left:${x - 120 * s}px; top:${y - 350 * s}px" width="${240 * s}" height="${360 * s}" viewBox="0 0 240 360"><g transform="rotate(${r} 120 200)${flip ? ' translate(240 0) scale(-1 1)' : ''}">${svg}</g>${extra}</svg>`;
};

/** The action group in a box H px tall and ~H px wide whose bottom-right corner is at (x, y). */
function scene(x, y, H, { bubbles = true, crowd = true } = {}) {
  const x0 = x - H;
  let s = '';
  if (crowd) s += put(CAST.streamer({ armR: -150 }), x0 + 0.86 * H, y - 0.01 * H, 0.46 * H, 4, true) + put(CAST.uncle({ armR: -60 }), x0 + 0.02 * H, y - 0.01 * H, 0.42 * H, -6);
  s += put(CAST.clerk({ armL: 140, armR: -140 }), x0 + 0.36 * H, y, 0.6 * H);
  // the karen flying out over the clerk's head
  s += put(CAST.flyer(), x0 + 0.62 * H, y - 0.5 * H, 0.46 * H, 52, false, speed(-14, 150, 1.1, '#fff'));
  s += `<svg style="left:${x0 + 0.40 * H}px; top:${y - 0.86 * H}px" width="${H * 0.12}" height="${H * 0.12}" viewBox="0 0 100 100" overflow="visible">${anger(50, 50, 2.4)}</svg>`;
  let b = '';
  if (bubbles) {
    const bs = H * 0.062;
    b += `<div class="bubble red r" style="--bs:${bs}px; right:${(W_ - x) + 0.02 * H}px; top:${y - 1.0 * H}px">叫你們店長出來！</div>`;
    b += `<div class="bubble r" style="--bs:${bs}px; right:${(W_ - x) + 0.66 * H}px; top:${y - 0.66 * H}px">慢走不送～</div>`;
  }
  return `<div class="chars" style="left:0; top:0">${s}</div>${b}`;
}
let W_ = 0; // width of the page being rendered (for right-anchored bubbles)

const bg = (W, H, shot = '02-rush.png', blur = 6) => `<div class="bgshot" style="background-image:url(${shotB64(shot)}); --blur:${blur}px"></div><div class="tint"></div><div class="stripes" style="--sw:${Math.max(10, H * 0.05)}px"></div>`;
const logo = (x, y, fs, { pill = true, oneLine = false } = {}) => oneLine
  ? `<div class="logo one" style="--fs:${fs}px; left:${x}px; top:${y}px"><div class="row"><span class="l">奧客</span><span class="l l2">退散</span></div>${pill ? '<div class="pill">FUCUSTOMER</div>' : ''}</div>`
  : `<div class="logo" style="--fs:${fs}px; left:${x}px; top:${y}px"><span class="l">奧客</span><span class="l l2">退散</span>${pill ? '<div class="pill">FUCUSTOMER</div>' : ''}</div>`;
const page = (W, H, inner) => `<div class="art" style="width:${W}px; height:${H}px">${inner}</div>`;

// ---------- layouts ----------
const landscape = (W, H, { logoScale = 1, sceneScale = 1, shot } = {}) => page(W, H,
  bg(W, H, shot) +
  `<div class="glow" style="left:${W * 0.5}px; top:${H * -0.1}px; width:${H * 1.3}px; height:${H * 1.3}px"></div>` +
  logo(W * 0.045, H * 0.14, H * 0.24 * logoScale) +
  scene(W * 0.99, H * 0.99, H * 0.86 * sceneScale, { bubbles: H >= 300 }));

const JOBS = {
  // Store
  'header_capsule_920x430.png': [920, 430, () => landscape(920, 430)],
  'small_capsule_462x174.png': [462, 174, () => page(462, 174, bg(462, 174) + logo(18, 10, 62, { oneLine: true }) + scene(462, 176, 168, { bubbles: false, crowd: false }))],
  'main_capsule_1232x706.png': [1232, 706, () => landscape(1232, 706)],
  'vertical_capsule_748x896.png': [748, 896, () => page(748, 896, bg(748, 896, '04-coop.png') +
    `<div class="glow" style="left:${-150}px; top:${200}px; width:1000px; height:1000px"></div>` + logo(160, 30, 140) + scene(740, 884, 470))],
  'page_background_1438x810.png': [1438, 810, () => page(1438, 810, `<div class="bgshot" style="background-image:url(${shotB64('03-signature.png')}); --blur:10px"></div><div class="tint"></div><div style="position:absolute; inset:0; background:linear-gradient(180deg, rgba(27,20,48,.55), rgba(27,20,48,.9))"></div><div class="stripes" style="--sw:40px; opacity:.5"></div>`)],
  // Library
  'library_capsule_600x900.png': [600, 900, () => page(600, 900, bg(600, 900, '04-coop.png') +
    `<div class="glow" style="left:-200px; top:260px; width:1000px; height:1000px"></div>` + logo(100, 50, 128) + scene(596, 890, 470))],
  'library_header_920x430.png': [920, 430, () => landscape(920, 430)],
  'library_hero_3840x1240.png': [3840, 1240, () => page(3840, 1240, bg(3840, 1240, '02-rush.png', 14) +
    `<div class="glow" style="left:1300px; top:-200px; width:1600px; height:1600px"></div>` + scene(2600, 1180, 1080, { bubbles: false }) +
    `<div class="chars" style="left:0; top:0">${put(CAST.boss(), 3150, 1150, 640, 4, true) + put(CAST.buddy(), 1130, 1160, 600, -4) + put(CAST.uncle({ mood: 'shock' }), 3560, 1170, 480, -8)}</div>`)],
  'library_logo_1280x720.png': [1280, 720, () => page(1280, 720, `<div class="center">${logo(0, 0, 250)}</div>`)],
  // Community
  'community_icon_184x184.png': [184, 184, () => page(184, 184, `<div style="position:absolute; inset:0; background:linear-gradient(135deg,#5f43c4,#2c2350)"></div><div class="stripes" style="--sw:10px"></div>` +
    `<div class="center"><div class="logo" style="--fs:60px"><span class="l">奧客</span><span class="l l2" style="margin-left:.3em">退散</span></div></div>`)],
};

// Achievement icons (256×256): unlocked = colour, locked = grey. One glyph per achievement API name.
const ACH = {
  FIRST_SHIFT: ['🪪', '#39c96b'], FIRST_THROW: ['🚪', '#ff5d5d'], CH1: ['1', '#48a6ff'], CH2: ['2', '#48a6ff'], CH3: ['3', '#5f43c4'],
  CH4: ['4', '#5f43c4'], CH5: ['5', '#8f6bff'], BOSS: ['👑', '#ffc23d'], ATLAS: ['🗺️', '#22b8cf'], DEX_ALL: ['📖', '#22b8cf'],
  LV10: ['10', '#39c96b'], LV20: ['20', '#48a6ff'], LV30: ['30', '#ff5d5d'], KARENS_100: ['💯', '#ff5d5d'], SERVED_1000: ['🛒', '#39c96b'],
  STARS_60: ['⭐', '#ffc23d'], PERFECT: ['🌟', '#ffc23d'], COMBO_5: ['💨', '#ff8fc7'], ENDLESS_1600: ['🌙', '#5f43c4'], ENDLESS_PLAYED: ['☕', '#8f6bff'],
  DAILY_FIRST: ['🎯', '#48a6ff'], DAILY_STREAK_3: ['🔥', '#ff5d5d'],
  ARC_AUNTIE: ['🎫', '#ffa94d'], ARC_KAI: ['🔴', '#ff5d5d'], ARC_ZHANG: ['✅', '#39c96b'], ARC_VICKY: ['🔌', '#48a6ff'], WEEKLY_BADGE: ['🏅', '#ffc23d'], WEEKLY_BADGE_4: ['📆', '#8f6bff'],
  STORE_LV5: ['5', '#48a6ff'], STORE_LV10: ['🌟', '#ffc23d'], BRANCH_1: ['🏬', '#39c96b'], BRANCH_3: ['🏙', '#8f6bff'], STREAK_7: ['7', '#ff8fc7'], STREAK_30: ['30', '#ff5d5d'],
};
const badge = (glyph, col, locked) => {
  const isNum = /^\d+$/.test(glyph);
  const inner = isNum ? `<div style="font-size:${glyph.length > 1 ? 104 : 128}px; font-weight:900; color:${col}; -webkit-text-stroke:16px ${INK}; paint-order:stroke fill; text-shadow:0 7px 0 ${INK}">${glyph}</div>`
    : `<div style="font-size:112px; filter:drop-shadow(0 6px 0 ${INK}) drop-shadow(0 -2px 0 ${INK}) drop-shadow(3px 0 0 ${INK}) drop-shadow(-3px 0 0 ${INK})">${glyph}</div>`;
  return page(256, 256, `<div style="position:absolute; inset:0; background:${locked ? '#3a3448' : `linear-gradient(145deg, ${col}, ${INK} 140%)`}"></div>
    <div class="stripes" style="--sw:14px"></div>
    <div style="position:absolute; left:28px; top:28px; width:200px; height:200px; border-radius:50%; background:${locked ? '#5b546a' : '#fff6e5'}; border:12px solid ${INK}; box-shadow:0 10px 0 ${INK}; display:flex; align-items:center; justify-content:center; ${locked ? 'filter:grayscale(1) brightness(.75) contrast(.8);' : ''}">${inner}</div>
    ${locked ? `<div style="position:absolute; right:14px; bottom:12px; font-size:54px; filter:grayscale(1) drop-shadow(0 3px 0 ${INK})">🔒</div>` : ''}`);
};
for (const [id, [g, c]] of Object.entries(ACH)) {
  JOBS[`achievements/${id}.png`] = [256, 256, () => badge(g, c, false)];
  JOBS[`achievements/${id}_locked.png`] = [256, 256, () => badge(g, c, true)];
}

const browser = await pw.chromium.launch();
for (const [name, [W, H, html]] of Object.entries(JOBS)) {
  if (ONLY && !ONLY.some(o => name.includes(o))) continue;
  const pg = await browser.newPage({ viewport: { width: W, height: H } });
  W_ = W;
  await pg.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body>${html()}</body></html>`);
  await pg.evaluate(() => document.fonts.ready);
  const transparent = name.startsWith('library_logo');
  await pg.screenshot({ path: path.join(OUT, name), omitBackground: transparent, clip: { x: 0, y: 0, width: W, height: H } });
  await pg.close();
  console.log('wrote', name);
}
await browser.close();
