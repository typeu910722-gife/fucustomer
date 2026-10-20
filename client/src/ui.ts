// DOM menus: main menu, lobby, settings, in-game overlays (pause, shop, summary, quick messages).
import { MAPS } from '../../shared/maps/index.ts';
import { KAREN_INFO, MAX_FILL_BOTS, MAX_PLAYERS, PRODUCT_INFO, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, PRODUCTS, UPGRADES, UPGRADE_IDS, shelfCapacity } from '../../shared/constants.ts';
import type { LobbyState, Snapshot, StoreSave } from '../../shared/protocol.ts';
import type { Settings } from './storage.ts';
import { DIFFICULTIES, DIFFICULTY_IDS, type Difficulty } from '../../shared/difficulty.ts';
import { getLicense, renderGoogleButton, signOut } from './account.ts';
import { weekBadge } from '../../shared/weekly.ts';
import { NOTICES, randomQuote } from './quotes.ts';
import { getCosmetic } from '../../shared/shop.ts';
import { backupScreen } from './backup-ui.ts';
import { desktop, isApp, isFullscreen, setFullscreen } from './platform.ts';
import { BTN, buttonGlyph, controlsLine } from './padmap.ts';
import { padStyle } from './pad.ts';
import { isTouch } from './storage.ts';
import { levelBarHtml } from './progress-ui.ts';
import type { StoreProg } from '../../shared/progression.ts';

// ---------- 打工人的號角: invite links ----------
/** Public address for invite links from the native apps (their own origin isn't reachable by friends). */
export const PUBLIC_GAME_URL = 'https://fucustomer.yzprojecttw.com/beta/';
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
/** Strict room-code check (server alphabet and length); returns the upper-cased code or null. */
export function parseRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return ROOM_CODE_RE.test(c) ? c : null;
}
/** This page + `?join=CODE` (web), or the public beta site inside the Android / Windows apps. */
export function inviteLink(code: string): string {
  const web = !isApp && /^https?:$/.test(location.protocol);
  const u = new URL(web ? location.origin + location.pathname : PUBLIC_GAME_URL);
  u.searchParams.set('join', code);
  return u.toString();
}
const inviteText = (code: string) => `📯 一起來《奧客退散》顧店！房間碼 ${code}`;
async function copyText(text: string, fallbackInput?: HTMLInputElement | null): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* insecure context / no permission */ }
  try { if (fallbackInput) { fallbackInput.select(); return document.execCommand('copy'); } } catch { /* ignore */ }
  return false;
}

/** 商城: which paid pack (if any) blocks a store in free play / own store / hosting a room. Set by main.ts. */
type StoreLock = (mapId: string) => { id: string; name: string; icon: string } | null;
let storeLock: StoreLock = () => null;
export function setStoreLock(fn: StoreLock) { storeLock = fn; }
const lockBadge = (mapId: string) => { const k = storeLock(mapId); return k ? `<i class="lockbadge" title="${esc(k.name)}">🔒</i>` : ''; };

const root = () => document.getElementById('ui')!;
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const PLATFORM_ICON: Record<string, string> = { ios: '📱iOS', android: '📱Android', 'steam-pc': '🖥Steam', web: '🌐網頁', 'web-mobile': '📱網頁', solo: '' };

export function show(html: string, cls = 'screen') {
  root().innerHTML = `<div class="${cls}" id="screen">${html}</div>`;
  return root().firstElementChild as HTMLElement;
}
export function hide() { root().innerHTML = ''; }
export function isOpen() { return root().childElementCount > 0; }
function on(id: string, ev: string, fn: (e: Event) => void) { document.getElementById(id)?.addEventListener(ev, fn); }
function val(id: string) { return (document.getElementById(id) as HTMLInputElement).value; }

export interface MainMenuHandlers {
  career(): void;
  /** 打工人的號角: multiplayer screen (map, difficulty, create/join). */
  multiplayer(): void;
  rejoin(): void; settings(): void;
  quit?(): void;
  /** First launch: jump straight into career shift 1-1. */
  firstDay?(): void;
  setName(n: string): void;
  /** Re-render the menu (after signing in/out). */
  refresh(): void;
  /** Jump straight into the next career shift / today's daily challenge. */
  playNext?(): void;
  playDaily?(): void;
  /** This week's 每週挑戰. */
  playWeekly?(): void;
}
export interface CareerBadge { level: number; rank: string; title: string; stars: number; achievements: number; storeName: string; hat?: string; supporter?: boolean; /** 每週挑戰 badges (newest last): icon + name. */ weekBadges?: { icon: string; name: string }[] }

const AVATARS = ['🧑', '👩', '👨', '🧑‍🍳', '🧑‍💼', '🧔', '👩‍🦰', '👱', '🧑‍🎤', '🥷', '🐱', '🐶'];
const AVATAR_KEY = 'fucustomer.avatar.v1';
export function loadAvatar() { try { const a = localStorage.getItem(AVATAR_KEY); return a && AVATARS.includes(a) ? a : AVATARS[0]; } catch { return AVATARS[0]; } }
function saveAvatar(a: string) { try { localStorage.setItem(AVATAR_KEY, a); } catch { /* ignore */ } }

/** The 高級社畜證照 card (also used to show a friend's card). */
export function licenseHtml(c: { name: string; avatar: string; level: number; rank: string; title?: string; no?: string | null; stars: number; achievements: number; storeName?: string; hat?: string; supporter?: boolean; weekBadges?: { icon: string; name: string }[]; weekBadgeCount?: number }, editable: boolean) {
  const wb = Array.isArray(c.weekBadges) ? c.weekBadges : [];
  const wbn = Math.max(wb.length, typeof c.weekBadgeCount === 'number' ? c.weekBadgeCount : 0);
  const hat = getCosmetic(c.hat);
  return `<div class="license ${c.supporter ? 'supporter' : ''}">
    <div class="lic-head"><span>🪪 高級社畜證照</span><small>CERTIFIED WAGE WORKER</small></div>
    <div class="lic-body">
      ${editable ? `<button class="lic-photo" id="m-avatar" title="換頭像">${c.avatar}</button>` : `<div class="lic-photo">${esc(c.avatar)}</div>`}${hat ? `<span class="lic-hat" title="${esc(hat.name)}">${hat.icon}</span>` : ''}
      <div class="lic-info">
        ${editable ? `<label class="lic-name">姓名<input type="text" id="m-name" maxlength="16" placeholder="你的名字" value="${esc(c.name)}"></label>` : `<div class="lic-name">姓名 <b>${esc(c.name)}</b></div>`}
        <div class="lic-row"><span class="lic-lv">Lv.${c.level}</span><b>${esc(c.rank)}</b>${c.title ? `<span class="tag ok">${esc(c.title)}</span>` : ''}${c.supporter ? '<span class="tag gold">💛 贊助者</span>' : ''}</div>
        <div class="lic-row muted">證號 <b class="lic-no">${c.no ? esc(c.no) : '未登入・只存在這台裝置'}</b></div>
        <div class="lic-row muted">★ ${c.stars}・🏆 ${c.achievements}${c.storeName ? `・🏪 ${esc(c.storeName)}` : ''}</div>
        ${wbn ? `<div class="lic-row lic-badges" id="lic-badges" title="每週挑戰週章">🏅 週章 ×${wbn} ${wb.slice(-6).map(x => `<span title="${esc(x.name)}">${esc(x.icon)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="lic-stamp">認證<br>社畜</div>
    </div>
  </div>`;
}

export function mainMenu(s: Settings, h: MainMenuHandlers, info: { coopSave: StoreSave | null; canRejoin: string | null; server: string; platform: string; error?: string; badge: CareerBadge; account: { no: string } | null; next?: { id: string; title: string; map: string } | null; daily?: { map: string; mods: string; done: boolean } | null; weekly?: { title: string; goals: number; done: number; week: string } | null }) {
  const floaters = ['🧃', '🍙', '🥤', '🧋', '🍗', '👕', '🛒', '🧾', '🍞', '☕', '📦', '🧹'];
  const b = info.badge;
  show(`
    <div class="bgfx">${floaters.map((f, i) => `<span style="left:${(i * 83) % 100}%;animation-duration:${14 + (i * 7) % 11}s;animation-delay:-${(i * 5) % 14}s">${f}</span>`).join('')}</div>
    <div class="street" aria-hidden="true">
      <div class="shopfront"><div class="awning"></div><div class="shopsign">🏪 奧客退散 24H</div>
        <div class="windows"><span>🧃🥤🧋</span><span class="door"></span><span>🍙🍞🍗</span></div></div>
      <div class="sidewalk"></div>
      <div class="walker w1">🚶</div><div class="walker w2">🧍‍♀️</div><div class="walker w3 karen">😤<i>我要找店長！</i></div><div class="walker w4">🧑‍🦯</div><div class="walker w5 karen">🤳<i>直播中～</i></div><div class="walker w6">🛵</div>
    </div>
    <div class="ts">
      <div class="ts-left">
        <div class="logo"><span class="l1">奧客</span><span class="l2">退散！</span><small>FUCUSTOMER</small></div>
        <button class="tagline" id="m-quote" title="再來一句">「${esc(randomQuote())}」</button>
        ${licenseHtml({ name: s.name, avatar: loadAvatar(), level: b.level, rank: b.rank, title: b.title, no: info.account?.no ?? null, stars: b.stars, achievements: b.achievements, storeName: b.storeName, hat: b.hat, supporter: b.supporter, weekBadges: b.weekBadges }, true)}
        <div class="lic-actions">
          ${info.account ? '<button class="btn small" id="m-signout">登出</button>' : '<div id="m-google" class="gbtn"></div>'}
          <button class="btn small" id="m-friend">🔍 查好友證照</button>
        </div>
        <div class="muted lic-msg" id="m-licmsg"></div>
      </div>
      <div class="card">
        ${info.canRejoin ? `<button class="btn good" id="m-rejoin">🔌 重新連線到房間 ${esc(info.canRejoin)}</button>` : ''}
        ${h.firstDay ? `<div class="welcome"><b>👋 第一次來上班？</b><span>按下去就開店，邊做邊教，不用先看說明。</span><button class="btn good hero first-go" id="m-first">▶ 開始第一天上班</button></div>` : ''}
        ${info.next ? `<button class="btn good continue" id="m-next"><span class="cont-tag">繼續上班</span>▶ ${esc(info.next.id)}・${esc(info.next.title)} <span class="cont-map">${esc(info.next.map)}</span></button>` : ''}
        <button class="btn primary ${h.firstDay ? '' : 'hero'}" id="m-career">🧑‍💼 開工${h.firstDay ? '' : '<span class="sub">主線：從工讀生一路升到開自己的店</span>'}</button>
        <button class="btn warn hero" id="m-mp">📯 打工人的號角<span class="sub">多人遊玩・選地圖、選難度</span></button>
        ${info.daily || info.weekly ? `<div class="chal-row">
          ${info.daily ? `<button class="daily-mini" id="m-daily"><span class="dm-icon">📅</span><span class="dm-text"><b>今日挑戰</b><small>${esc(info.daily.map)}・${esc(info.daily.mods)}</small></span><span class="tag ${info.daily.done ? 'ok' : ''}">${info.daily.done ? '✅ 已領' : '🎁 未領'}</span></button>` : ''}
          ${info.weekly ? `<button class="daily-mini weekly-mini" id="m-weekly"><span class="dm-icon">🗓</span><span class="dm-text"><b>每週挑戰・${esc(info.weekly.week)}</b><small>${esc(info.weekly.title)}</small></span><span class="tag ${info.weekly.done >= info.weekly.goals ? 'ok' : ''}">${info.weekly.done >= info.weekly.goals ? '🏅 週章到手' : `🎯 ${info.weekly.done}/${info.weekly.goals}`}</span></button>` : ''}
        </div>` : ''}
        <div class="notice"><span class="pin">📋 店內公告</span><div class="notice-text" id="m-notice">${esc(NOTICES[Math.floor(Math.random() * NOTICES.length)])}</div></div>
        <div class="err" id="m-err">${esc(info.error ?? '')}</div>
        <div class="ts-foot">
          <button class="btn small" id="m-settings">⚙ 設定</button>
          ${h.quit ? '<button class="btn small" id="m-quit">離開</button>' : ''}
          <span class="muted">伺服器 ${esc(info.server)}・${esc(info.platform)}</span>
        </div>
      </div>
    </div>`, 'screen title-bg');
  const name = () => { const n = val('m-name').trim(); h.setName(n); return n; };
  on('m-name', 'change', name);
  on('m-quote', 'click', () => { const q = document.getElementById('m-quote')!; q.textContent = `「${randomQuote(q.textContent?.slice(1, -1))}」`; });
  on('m-avatar', 'click', () => { const el = document.getElementById('m-avatar')!; const next = AVATARS[(AVATARS.indexOf(el.textContent ?? '') + 1) % AVATARS.length]; el.textContent = next; saveAvatar(next); });
  on('m-career', 'click', () => { name(); h.career(); });
  on('m-next', 'click', () => { name(); h.playNext?.(); });
  on('m-daily', 'click', () => { name(); h.playDaily?.(); });
  on('m-weekly', 'click', () => { name(); h.playWeekly?.(); });
  // the notice board rotates while the menu is open
  const nt = document.getElementById('m-notice');
  if (nt) { let i = NOTICES.indexOf(nt.textContent ?? ''); const timer = window.setInterval(() => { if (!nt.isConnected) { clearInterval(timer); return; } i = (i + 1) % NOTICES.length; nt.classList.remove('flip'); void nt.offsetWidth; nt.textContent = NOTICES[i]; nt.classList.add('flip'); }, 5000); }
  on('m-mp', 'click', () => { name(); h.multiplayer(); });
  on('m-rejoin', 'click', () => { name(); h.rejoin(); });
  on('m-settings', 'click', () => h.settings());
  on('m-quit', 'click', () => h.quit?.());
  on('m-first', 'click', () => { name(); h.firstDay?.(); });
  on('m-friend', 'click', () => friendLicenseScreen(() => h.refresh()));
  const msg = (t: string) => { const el = document.getElementById('m-licmsg'); if (el) el.textContent = t; };
  on('m-signout', 'click', () => { void signOut().then(() => h.refresh()); });
  const g = document.getElementById('m-google');
  if (g) void renderGoogleButton(g, () => h.refresh(), m => { g.innerHTML = `<span class="muted" title="${esc(m)}">🔒 Google 登入（尚未開放）</span>`; if (!/還沒設定/.test(m)) msg(m); });
}

/** Multiplayer (打工人的號角): store type + difficulty, create a room or join one. */
export function multiplayerMenu(h: { create(cont: boolean, map: string, difficulty: Difficulty): void; join(code: string): void; back(): void; pack?(packId: string): void }, info: { coopSave: StoreSave | null; error?: string }) {
  show(`<div class="card wide mpcard">
    <div class="row" style="align-items:center"><h2>📯 打工人的號角</h2><button class="btn small" id="mp-back" style="flex:0">← 主選單</button></div>
    ${info.error ? `<div class="mp-banner" id="mp-banner">${esc(info.error)}</div>` : ''}
    <p class="muted">最多 ${MAX_PLAYERS} 人一起顧店。多人模式還在測試，可能會有問題，歡迎回報。</p>
    <div class="sectlabel">① 選店面</div>
    <div class="pickgrid">${MAPS.map((m, i) => `<label class="pick ${storeLock(m.id) ? 'locked' : ''}"><input type="radio" name="mp-map" value="${m.id}" ${i === 0 ? 'checked' : ''}><span>${m.icon}</span><b>${esc(m.name)}</b>${lockBadge(m.id)}</label>`).join('')}</div>
    <div class="muted" id="mp-lockmsg"></div>
    <div class="sectlabel">② 選難度</div>
    <div class="pickgrid">${DIFFICULTY_IDS.map(d => `<label class="pick"><input type="radio" name="mp-diff" value="${d}" ${d === 'normal' ? 'checked' : ''}><span>${DIFFICULTIES[d].icon}</span><b>${DIFFICULTIES[d].name}</b><small>${esc(DIFFICULTIES[d].desc)}</small></label>`).join('')}</div>
    ${info.coopSave ? `<label class="muted"><input type="checkbox" id="m-coop-cont" checked> 延續上次合作店面（第 ${info.coopSave.day} 天）</label>` : ''}
    <div class="row" style="margin-top:6px"><button class="btn info" id="m-create">📯 建立房間</button></div>
    <div class="sectlabel">或加入朋友的房間</div>
    <div class="row"><input type="text" class="code" id="m-code" maxlength="5" placeholder="房間碼" autocomplete="off" autocapitalize="characters"><button class="btn" id="m-join" style="flex:0 0 140px">加入</button></div>
    <div class="err" id="m-err"></div>
  </div>`);
  const pick = (n: string) => (document.querySelector(`input[name="${n}"]:checked`) as HTMLInputElement | null)?.value;
  on('mp-back', 'click', () => h.back());
  // 🔒 stores from a paid pack: say which pack (joining a friend's room stays free)
  document.querySelectorAll<HTMLInputElement>('input[name="mp-map"]').forEach(r => r.addEventListener('change', () => {
    const k = storeLock(r.value), el = document.getElementById('mp-lockmsg');
    if (el) el.innerHTML = k ? `🔒 這家店在「${esc(k.icon)} ${esc(k.name)}」裡：開房要先解鎖（加入朋友的房間免費、主線上班也免費）。<button class="btn small purple" id="mp-pack">🛍 看擴充包</button>` : '';
    if (k) on('mp-pack', 'click', () => h.pack?.(k.id));
  }));
  on('m-create', 'click', () => { const k = storeLock(pick('mp-map') ?? 'convenience'); if (k && h.pack) { h.pack(k.id); return; } h.create(!!(document.getElementById('m-coop-cont') as HTMLInputElement | null)?.checked, pick('mp-map') ?? 'convenience', (pick('mp-diff') ?? 'normal') as Difficulty); });
  on('m-join', 'click', () => { const c = parseRoomCode(val('m-code')); if (!c) { document.getElementById('m-err')!.textContent = `請輸入 ${ROOM_CODE_LENGTH} 碼房間碼（英文字母和數字）`; return; } h.join(c); });
  on('m-code', 'keydown', e => { if ((e as KeyboardEvent).key === 'Enter') document.getElementById('m-join')!.click(); });
}

/** Opened from an invite link (?join=CODE): confirm your name, then join that room. */
export function inviteScreen(code: string, name: string, h: { join(name: string): void; back(): void }) {
  show(`<div class="card invitecard">
    <h2>📯 朋友找你一起顧店！</h2>
    <p class="muted">你收到「打工人的號角」邀請，房間碼：</p>
    <div class="bigcode" id="iv-code">${esc(code)}</div>
    <label class="field">你的名字<input type="text" id="iv-name" maxlength="16" placeholder="你的名字" value="${esc(name)}"></label>
    <button class="btn good" id="iv-join">🚪 加入房間</button>
    <button class="btn small" id="iv-back">← 先回主選單</button>
  </div>`);
  on('iv-join', 'click', () => h.join(val('iv-name').trim()));
  on('iv-name', 'keydown', e => { if ((e as KeyboardEvent).key === 'Enter') document.getElementById('iv-join')!.click(); });
  on('iv-back', 'click', () => h.back());
}

/** Look up a friend's licence card by its number. */
export function friendLicenseScreen(onBack: () => void) {
  show(`<div class="card"><h2>🔍 查好友證照</h2>
    <p class="muted">輸入好友的證號（登入 Google 後才會有證號）。</p>
    <div class="row"><input type="text" id="fl-no" maxlength="9" placeholder="1234-5678" autocomplete="off" inputmode="numeric"><button class="btn info" id="fl-go" style="flex:0 0 110px">查詢</button></div>
    <div id="fl-out"></div>
    <button class="btn" id="fl-back">← 返回</button></div>`);
  on('fl-back', 'click', onBack);
  const go = async () => {
    const raw = val('fl-no').replace(/\D/g, ''); const no = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : val('fl-no').trim();
    const out = document.getElementById('fl-out')!; out.innerHTML = '<p class="muted">查詢中…</p>';
    const r = await getLicense(no);
    out.innerHTML = r.ok ? licenseHtml({ ...r.data, weekBadges: (r.data.weekBadges ?? []).map(w => weekBadge(w)), weekBadgeCount: r.data.weekBadgeCount }, false) + (r.data.quote ? `<p class="muted">「${esc(r.data.quote)}」</p>` : '') : `<p class="err">${esc(r.error)}</p>`;
  };
  on('fl-go', 'click', () => void go());
  on('fl-no', 'keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void go(); });
}

export function settingsMenu(s: Settings, onDone: (s: Settings) => void, overlay = false) {
  const fsNow = isFullscreen();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  show(`
    <div class="card wide settings">
      <div class="row" style="align-items:center"><h2>⚙ 設定</h2><button class="btn small" id="s-ok2" style="flex:0" data-back>← 完成</button></div>
      <div class="setgrid">
        <section><h3>🖥 畫面</h3>
          ${isTouch ? '' : `<label class="chk"><input type="checkbox" id="s-full" ${fsNow ? 'checked' : ''}> 全螢幕${desktop ? '（F11 也可切換）' : ''}</label>`}
          <label class="field">畫質（手機建議「低」，玩法完全相同）
            <select id="s-q"><option value="low">低（省電）</option><option value="medium">中</option><option value="high">高（陰影）</option></select></label>
          <label class="field">解析度比例 <span id="s-scale-v"></span><input type="range" id="s-scale" min="0.5" max="1" step="0.05" value="${s.renderScale}"></label>
          <label class="chk"><input type="checkbox" id="s-adapt" ${s.adaptive ? 'checked' : ''}> 自動調整解析度（卡頓時自動降低）</label>
          <label class="field">幀率上限
            <select id="s-fps-cap"><option value="0">不限制（跟隨螢幕更新率／垂直同步）</option><option value="144">144 FPS</option><option value="120">120 FPS</option><option value="60">60 FPS</option><option value="40">40 FPS（Steam Deck 省電）</option><option value="30">30 FPS（手機省電）</option></select></label>
          <label class="field">視野 FOV <span id="s-fov-v"></span><input type="range" id="s-fov" min="60" max="100" step="1" value="${s.fov}"></label>
          <label class="chk"><input type="checkbox" id="s-fps" ${s.showFps ? 'checked' : ''}> 顯示 FPS</label>
          <label class="chk"><input type="checkbox" id="s-shake" ${s.shake !== false ? 'checked' : ''}> 畫面震動（丟奧客、出手、全店退散）</label>
          <label class="chk"><input type="checkbox" id="s-rmotion" ${s.reduceMotion ? 'checked' : ''}> 減少動態效果（關閉震動、慢動作、閃光）</label>
        </section>
        <section><h3>🔊 聲音</h3>
          <label class="field">主音量 <span id="s-master-v"></span><input type="range" id="s-master" min="0" max="1" step="0.05" value="${s.master}"></label>
          <label class="field">音樂音量 <span id="s-music-v"></span><input type="range" id="s-music" min="0" max="1" step="0.05" value="${s.music}"></label>
          <label class="field">音效音量 <span id="s-vol-v"></span><input type="range" id="s-vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
          <h3>🎮 操作</h3>
          <label class="field">滑鼠靈敏度 <span id="s-sens-v"></span><input type="range" id="s-sens" min="0.2" max="3" step="0.1" value="${s.sensitivity}"></label>
          <label class="chk"><input type="checkbox" id="s-inv" ${s.invertY ? 'checked' : ''}> 滑鼠反轉 Y 軸</label>
          <label class="field">手把視角靈敏度 <span id="s-pad-v"></span><input type="range" id="s-pad" min="0.2" max="3" step="0.1" value="${s.padSens}"></label>
          <label class="chk"><input type="checkbox" id="s-pinv" ${s.padInvertY ? 'checked' : ''}> 手把反轉 Y 軸</label>
          <label class="chk"><input type="checkbox" id="s-rumble" ${s.rumble ? 'checked' : ''}> 手把震動（被推、送走奧客、全店退散）</label>
        </section>
      </div>
      <label class="field">自訂伺服器（留空使用預設）<input type="text" id="s-url" placeholder="wss://example.com/ws" value="${esc(s.serverUrl)}"></label>
      ${overlay ? '' : '<button class="btn info" id="s-backup">💾 存檔備份（換裝置）<span class="sub">匯出／匯入存檔碼，網頁、Android、Windows 互通</span></button>'}
      <button class="btn primary" id="s-ok">完成</button>
    </div>`, overlay ? 'screen overlay' : 'screen');
  (document.getElementById('s-q') as HTMLSelectElement).value = s.quality;
  (document.getElementById('s-fps-cap') as HTMLSelectElement).value = String(s.fpsCap ?? 0);
  const upd = () => {
    const t = (id: string, v: string) => { document.getElementById(id)!.textContent = v; };
    t('s-sens-v', val('s-sens')); t('s-fov-v', val('s-fov')); t('s-pad-v', val('s-pad'));
    t('s-scale-v', pct(Number(val('s-scale')))); t('s-master-v', pct(Number(val('s-master')))); t('s-music-v', pct(Number(val('s-music')))); t('s-vol-v', pct(Number(val('s-vol'))));
  };
  upd();
  for (const id of ['s-sens', 's-fov', 's-pad', 's-scale', 's-master', 's-music', 's-vol']) on(id, 'input', upd);
  const chk = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;
  let fullscreen = s.fullscreen;
  on('s-full', 'change', () => { const want = chk('s-full'); void setFullscreen(want).then(st => { fullscreen = want; const el = document.getElementById('s-full') as HTMLInputElement | null; if (el) el.checked = st; }); });
  const collect = (): Settings => ({
    ...s, quality: val('s-q') as Settings['quality'], sensitivity: Number(val('s-sens')), fov: Number(val('s-fov')), volume: Number(val('s-vol')), music: Number(val('s-music')),
    master: Number(val('s-master')), fpsCap: Number(val('s-fps-cap')), adaptive: chk('s-adapt'), renderScale: Number(val('s-scale')),
    invertY: chk('s-inv'), showFps: chk('s-fps'), padSens: Number(val('s-pad')), padInvertY: chk('s-pinv'), rumble: chk('s-rumble'), fullscreen, shake: chk('s-shake'), reduceMotion: chk('s-rmotion'),
    serverUrl: val('s-url').trim(),
  });
  on('s-backup', 'click', () => backupScreen(() => settingsMenu(collect(), onDone, overlay)));
  on('s-ok', 'click', () => onDone(collect()));
  on('s-ok2', 'click', () => onDone(collect()));
}

/** Lobby share/copy feedback survives lobby redraws (someone readying up re-renders the screen) for ~2 s. */
let lobbyNote: { text: string; until: number } | null = null;
const LOBBY_NOTE_DEFAULT = '朋友點連結就會直接進這個房間。';

/** Shows a short note in the lobby (the share-message line), e.g. 「你現在是房主」. */
export function lobbyFlash(text: string) {
  lobbyNote = { text, until: Date.now() + 4000 };
  const el = document.getElementById('l-sharemsg'); if (el) el.textContent = text;
}
/** Connection line in the lobby (「重新連線中…」 with the countdown; empty hides it). */
export function lobbyNet(text: string) {
  const el = document.getElementById('l-net'); if (!el) return;
  el.textContent = text; el.classList.toggle('hidden', !text);
}
const LOBBY_CSS = `
.players .lp { flex-wrap: wrap; row-gap: 4px; }
.players .lp.off { opacity: .6; }
.tag.ping { font-variant-numeric: tabular-nums; }
.tag.ping.good { background: #d3f9d8; } .tag.ping.mid { background: #fff3bf; } .tag.ping.bad { background: #ffc9c9; }
.tag.rdy { font-size: 14px; padding: 3px 10px; } .tag.rdy.ok { background: #8ce99a; } .tag.rdy.wait { background: #ffe066; }
.lp-ctl { display: flex; gap: 4px; flex-basis: 100%; justify-content: flex-end; }
.lp-ctl .btn { width: auto; flex: 0 0 auto; margin: 0; padding: 4px 10px; font-size: 13px; min-height: 0; }
.lp-ctl .btn.armed { background: #ff8787; }
#l-net { background: #ffe066; border: 3px solid var(--ink); border-radius: 12px; padding: 6px 10px; font-weight: 900; white-space: pre-line; text-align: center; }
.readysum { font-weight: 900; }
`;
/** Lobby update where only the pings changed: patch the ping tags in place (a full redraw would reset a half-confirmed kick). */
export function lobbyPings(l: LobbyState) {
  for (const p of l.players) {
    const el = document.querySelector<HTMLElement>(`.lp[data-pid="${CSS.escape(p.id)}"] .tag.ping`); if (!el) continue;
    el.className = `tag ping ${p.ping === undefined ? '' : pingClass(p.ping)}`;
    el.textContent = `📶 ${p.ping === undefined ? '…' : `${p.ping} ms`}`;
  }
}
const pingClass = (ms: number) => (ms < 90 ? 'good' : ms < 200 ? 'mid' : 'bad');

export function lobbyScreen(l: LobbyState, selfId: string, h: { ready(r: boolean): void; start(): void; leave(): void; copy(): void; config?(map: string, difficulty: string, bots: boolean): void; kick?(id: string): void; makeHost?(id: string): void }, reconnecting = false) {
  if (!document.getElementById('lobby-css')) { const st = document.createElement('style'); st.id = 'lobby-css'; st.textContent = LOBBY_CSS; document.head.appendChild(st); }
  const me = l.players.find(p => p.id === selfId);
  const isHost = l.hostId === selfId;
  const others = l.players.filter(p => p.id !== l.hostId && p.connected);
  const canStart = others.every(p => p.ready);
  const waitingFor = others.filter(p => !p.ready).map(p => p.name);
  const link = inviteLink(l.code);
  const lineUrl = `https://line.me/R/share?text=${encodeURIComponent(`${inviteText(l.code)}\n${link}`)}`;
  const canShare = typeof navigator.share === 'function';
  show(`
    <div class="card wide lobbycard">
      <h2>等候室</h2>
      <div class="lobbycols"><div class="invite">
      <div class="muted" style="text-align:center">房間碼（手機、電腦、Steam 都輸入這組）</div>
      <div class="bigcode" id="l-code">${esc(l.code)}</div>
      <div class="sharebtns">
        <button class="btn small" id="l-copy">📋 複製房號</button>
        <button class="btn small info" id="l-link">🔗 複製邀請連結</button>
        <a class="btn small line" id="l-line" href="${esc(lineUrl)}" target="_blank" rel="noopener">LINE 分享</a>
        ${canShare ? '<button class="btn small purple" id="l-share">📤 分享…</button>' : ''}
      </div>
      <input type="text" class="invitelink" id="l-invite" readonly value="${esc(link)}" aria-label="邀請連結">
      <div class="muted" id="l-sharemsg">${esc(lobbyNote && lobbyNote.until > Date.now() ? lobbyNote.text : LOBBY_NOTE_DEFAULT)}</div>
      </div><div class="lobbyside">
      <div class="muted">人數 ${l.players.length}/${l.max}・第 ${l.day} 天</div>
      ${l.map ? (() => {
        const m = MAPS.find(x => x.id === l.map) ?? MAPS[0];
        const d = DIFFICULTIES[(l.difficulty ?? 'normal') as Difficulty] ?? DIFFICULTIES.normal;
        return isHost && h.config
          ? `<div class="lobbycfg"><label>🏪 店面<select id="l-map">${MAPS.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''} ${storeLock(x.id) && x.id !== m.id ? 'disabled' : ''}>${storeLock(x.id) ? '🔒' : x.icon} ${esc(x.name)}</option>`).join('')}</select></label>
             <label>🎚 難度<select id="l-diff">${DIFFICULTY_IDS.map(k => `<option value="${k}" ${k === (l.difficulty ?? 'normal') ? 'selected' : ''}>${DIFFICULTIES[k].icon} ${DIFFICULTIES[k].name}</option>`).join('')}</select></label>
             <label class="botfill"><input type="checkbox" id="l-bots" ${l.bots ? 'checked' : ''}> 🤖 電腦店員補位<span class="muted">（空位補最多 ${MAX_FILL_BOTS} 位，有人加入就讓位）</span></label></div>
             <div class="muted">換店面或難度後，其他人要重新按「準備」。</div>`
          : `<div class="lobbycfg ro"><span class="tag">${m.icon} ${esc(m.name)}</span><span class="tag">${d.icon} ${d.name}・${esc(d.desc)}</span>${l.bots ? '<span class="tag">🤖 電腦店員補位</span>' : ''}</div>`;
      })() : ''}
      <div id="l-net" class="${reconnecting ? '' : 'hidden'}">${reconnecting ? '重新連線中…' : ''}</div>
      <div class="muted readysum" id="l-readysum">${others.length ? (waitingFor.length ? `⏳ 等待準備：${esc(waitingFor.join('、'))}（${others.length - waitingFor.length}/${others.length} 已準備）` : `✅ 全員準備好了（${others.length}/${others.length}）`) : '只有你一個人：可以直接開始，或等朋友加入'}</div>
      <ul class="players">
        ${l.players.map(p => `<li class="lp ${p.connected ? '' : 'off'}" data-pid="${esc(p.id)}"><span class="dot" style="background:${hex(p.color)}"></span><b style="flex:1">${esc(p.name)}${p.id === selfId ? '（你）' : ''}</b>
          ${p.id === l.hostId ? '<span class="tag">👑 房主</span>' : ''}<span class="tag">${p.bot ? '電腦店員' : PLATFORM_ICON[p.platform] ?? esc(p.platform)}</span>
          ${p.bot || !p.connected ? '' : `<span class="tag ping ${p.ping === undefined ? '' : pingClass(p.ping)}" title="延遲">📶 ${p.ping === undefined ? '…' : `${p.ping} ms`}</span>`}
          ${!p.connected ? '<span class="tag off">斷線中</span>' : p.id === l.hostId ? '<span class="tag rdy ok">房主</span>' : p.ready ? '<span class="tag rdy ok">✅ 已準備</span>' : '<span class="tag rdy wait">⏳ 未準備</span>'}
          ${isHost && h.kick && p.id !== selfId && !p.bot ? `<span class="lp-ctl">${p.connected ? `<button class="btn small" data-mkhost="${esc(p.id)}">👑 交給他</button>` : ''}<button class="btn small" data-kick="${esc(p.id)}">🚪 請他離開</button></span>` : ''}</li>`).join('')}
      </ul>
      ${isHost
        ? `<button class="btn primary" id="l-start" ${canStart ? '' : 'disabled'}>${canStart ? '開始營業' : '等待所有人準備…'}</button>`
        : `<button class="btn ${me?.ready ? '' : 'good'}" id="l-ready">${me?.ready ? '取消準備' : '準備'}</button>`}
      <button class="btn" id="l-leave">離開房間</button>
      </div></div>
    </div>`);
  const shareMsg = (t: string) => {
    const el = document.getElementById('l-sharemsg'); if (el) el.textContent = t;
    const note = { text: t, until: Date.now() + 2200 };
    lobbyNote = note;
    window.setTimeout(() => { if (lobbyNote !== note) return; lobbyNote = null; const e2 = document.getElementById('l-sharemsg'); if (e2 && e2.textContent === t) e2.textContent = LOBBY_NOTE_DEFAULT; }, 2300);
  };
  on('l-link', 'click', () => { void copyText(link, document.getElementById('l-invite') as HTMLInputElement | null).then(ok => shareMsg(ok ? '✅ 已複製邀請連結，貼給朋友就行！' : '複製失敗：請長按上面的連結自己複製。')); });
  on('l-invite', 'focus', e => (e.target as HTMLInputElement).select());
  on('l-share', 'click', () => { void navigator.share({ title: '奧客退散', text: inviteText(l.code), url: link }).catch(() => { /* cancelled */ }); });
  on('l-start', 'click', () => h.start());
  on('l-ready', 'click', () => h.ready(!me?.ready));
  on('l-leave', 'click', () => h.leave());
  on('l-copy', 'click', () => { void copyText(l.code).then(ok => shareMsg(ok ? `✅ 已複製房間碼 ${l.code}` : `複製失敗：房間碼是 ${l.code}`)); });
  // host controls: both need a second press (in-page confirm, works where dialogs are blocked)
  document.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach(b => { b.onclick = () => confirmTwice(b, '再按一次：確定請他離開', () => h.kick?.(b.dataset.kick!)); });
  document.querySelectorAll<HTMLButtonElement>('[data-mkhost]').forEach(b => { b.onclick = () => confirmTwice(b, '再按一次：交出房主', () => h.makeHost?.(b.dataset.mkhost!)); });
  const cfg = () => h.config?.(val('l-map'), val('l-diff'), (document.getElementById('l-bots') as HTMLInputElement | null)?.checked ?? false);
  on('l-map', 'change', cfg); on('l-diff', 'change', cfg); on('l-bots', 'change', cfg);
}

export function message(title: string, body: string, btn = '確定', onOk?: () => void) {
  show(`<div class="card"><h2>${esc(title)}</h2><p>${esc(body)}</p><button class="btn primary" id="msg-ok">${esc(btn)}</button></div>`);
  on('msg-ok', 'click', () => { hide(); onOk?.(); });
}

export function pauseMenu(solo: boolean, code: string, h: { resume(): void; settings(): void; leave(): void; help(): void; endShift?: () => void }) {
  show(`
    <div class="card">
      <h2>選單</h2>
      ${solo ? '<p class="muted">單人遊戲已暫停。</p>' : `<p class="muted">⚠ 多人營業中：開選單<b>不會暫停</b>，隊友與顧客持續行動。房間碼 <b>${esc(code)}</b></p>`}
      <button class="btn primary" id="p-resume">回到遊戲</button>
      ${h.endShift ? '<button class="btn good" id="p-end">🌙 下班結算分數</button>' : ''}
      <button class="btn" id="p-help">玩法說明</button>
      <button class="btn" id="p-settings">設定</button>
      <button class="btn" id="p-leave">${solo ? '離開（本班不結算）' : '離開房間'}</button>
    </div>`, 'screen overlay');
  on('p-resume', 'click', () => h.resume());
  if (h.endShift) on('p-end', 'click', () => h.endShift!());
  on('p-settings', 'click', () => h.settings());
  on('p-leave', 'click', () => h.leave());
  on('p-help', 'click', () => h.help());
}

export function helpScreen(onBack: () => void) {
  show(`
    <div class="card wide">
      <h2>玩法說明</h2>
      <p><b>營業循環：</b>開店準備（採購、補貨、升級）→ 開門營業 08:00–22:00 → 打烊 → 日結 → 升級 → 下一天。</p>
      <div class="grid2">
        <div class="shopitem"><b>💳 收銀</b>走到櫃台內側面對收銀機按互動。顧客耐心用完會生氣離開、扣評價。</div>
        <div class="shopitem"><b>☕ 咖啡</b>在咖啡機互動煮咖啡，拿去「取餐區」交給等咖啡的顧客。</div>
        <div class="shopitem"><b>📦 補貨</b>倉庫（左上）拿貨箱，對同類貨架互動上架。貨架空了顧客會不滿。倉庫存貨不夠要採購（B）。</div>
        <div class="shopitem"><b>🧹 清潔</b>西側牆拿拖把，對地上髒污互動。髒污會持續拉低評價。</div>
      </div>
      <h3>奧客事件</h3>
      <div class="grid2">
        ${Object.values(KAREN_INFO).map(k => `<div class="shopitem"><b>${k.name}</b>${k.hint}<br><span class="muted">處理：${k.how}</span></div>`).join('')}
      </div>
      <h3>操作</h3>
      <p class="muted">電腦：WASD 移動、Shift 跑（耗體力）、滑鼠視角、左鍵/E 互動、右鍵/F 次要、G 放下、空白鍵 抓起/丟出、X 出手、Q 拖把旋風、R 全店退散、V 標記、T 快捷訊息輪盤（1–8 直接喊話）、B 採購、Enter 準備、Esc/P 選單。<br>
      手把：${esc(controlsLine('pad', padStyle()))}・十字← 跳過教學。選單裡：十字鍵／左搖桿 移動、${buttonGlyph(BTN.A, padStyle())} 確定、${buttonGlyph(BTN.B, padStyle())} 返回、${buttonGlyph(BTN.LB, padStyle())}/${buttonGlyph(BTN.RB, padStyle())} 切換分頁、左右 調整滑桿。<br>
      手機：左半邊拖曳＝搖桿、右半邊拖曳＝視角，右側按鈕互動／放下／抓丟／旋風／退散。</p>
      <p class="muted">抓起奧客後轉向發光出口丟出去，飛過門線才算送走；誤丟一般顧客會大扣分。混亂度滿 100% 或口碑歸零就提早下班。</p>
      <button class="btn primary" id="h-back">返回</button>
    </div>`, 'screen overlay');
  on('h-back', 'click', onBack);
}

/** Shop: stock purchases any time; upgrades only during prep/summary. Re-rendered on snapshot changes. */
export function shopHtml(s: Snapshot, allowUpgrades: boolean) {
  const cap = shelfCapacity(s.upgrades.shelves);
  return `
    <h3>📦 採購貨箱（每箱 6 個，送到倉庫）　💰 $${s.money}</h3>
    <div class="grid2">${PRODUCTS.map(p => `<div class="shopitem"><b>${PRODUCT_INFO[p].name}</b>
      <span class="muted">售價 $${PRODUCT_INFO[p].price}/個・倉庫 ${s.backstock[p]}・貨架 ${s.shelves[p]}/${cap}</span>
      <button class="btn small" data-buy="stock_${p}" ${s.money < PRODUCT_INFO[p].boxCost ? 'disabled' : ''}>買一箱 $${PRODUCT_INFO[p].boxCost}</button></div>`).join('')}</div>
    <h3>🏗 店面升級（用店裡的錢）${allowUpgrades ? '<span class="muted">・開店前或日結時施工，升級跟著這間店的存檔</span>' : '<span class="muted">（營業中無法施工，開店前或日結時可升級）</span>'}</h3>
    <div class="grid2 upgpanel" id="upg-panel">${UPGRADE_IDS.map(u => {
      const d = UPGRADES[u]; const lv = s.upgrades[u] ?? 0; const max = lv >= d.costs.length; const cost = d.costs[lv];
      const now = lv > 0 && d.levels ? `<span class="upg-now">✅ 目前：${esc(d.levels[lv - 1])}</span>` : '';
      const next = !max && d.levels ? `<span class="upg-next">⬆ 下一級：${esc(d.levels[lv])}</span>` : '';
      return `<div class="shopitem upg ${lv > 0 ? 'owned' : ''}" data-upg-card="${u}"><b>${d.icon} ${esc(d.name)} <span class="tag">Lv ${lv}/${d.costs.length}</span></b><span class="muted">${esc(d.desc)}</span>${now}${next}
        <button class="btn small" data-upg="${u}" data-lv="${lv}" ${max || !allowUpgrades || s.money < cost ? 'disabled' : ''}>${max ? '已滿級' : `升級 $${cost}`}</button></div>`;
    }).join('')}</div>`;
}

/** 店面等級 panel in the nightly summary (free play / your own store / a branch); set by main.ts, null elsewhere. */
let summaryExtra: (() => string) | null = null;
export function setSummaryExtra(fn: (() => string) | null) { summaryExtra = fn; }
/** Redraws the 店面等級 panel if the summary is already on screen (the nightly save can arrive after it). */
export function refreshSummaryExtra() { const el = document.getElementById('sum-prog'); if (el && summaryExtra) el.innerHTML = summaryExtra(); }

export function summaryHtml(s: Snapshot, selfId: string) {
  const d = s.dayStats;
  const me = s.players.find(p => p.id === selfId);
  const ratingDelta = s.rating - d.ratingStart;
  return `
    <h2>🌙 第 ${s.day} 天日結</h2>
    <div class="grid2">
      <div>
        <div class="stat"><span>營業收入</span><b>$${d.revenue}</b></div>
        <div class="stat"><span>　其中小費</span><b>$${d.tips}</b></div>
        <div class="stat"><span>每日獎勵（評價＋奧客處理）</span><b>+$${d.bonus}</b></div>
        <div class="stat"><span>支出（進貨＋租金＋員工薪水）</span><b>-$${d.expenses}</b></div>
        ${d.wage ? `<div class="stat"><span>　其中店員日薪</span><b>-$${d.wage}</b></div>` : ''}
        <div class="stat"><span>現金</span><b>$${s.money}</b></div>
      </div>
      <div>
        <div class="stat"><span>服務顧客</span><b>${d.served}</b></div>
        <div class="stat"><span>生氣離開</span><b>${d.angryLeft}</b></div>
        <div class="stat"><span>奧客處理 成功/失敗</span><b>${d.karensResolved} / ${d.karensFailed}</b></div>
        <div class="stat"><span>清潔髒污</span><b>${d.spillsCleaned}</b></div>
        <div class="stat"><span>評價</span><b>★${s.rating.toFixed(2)} (${ratingDelta >= 0 ? '+' : ''}${ratingDelta.toFixed(2)})</b></div>
      </div>
    </div>
    <h3>隊伍</h3>
    <div>${s.players.map(p => `<span class="tag" style="margin:2px;display:inline-block"><span class="dot" style="display:inline-block;width:10px;height:10px;background:${hex(p.color)}"></span> ${esc(p.name)} ${p.ready ? '✅' : '⏳'}</span>`).join('')}</div>
    ${summaryExtra ? `<div id="sum-prog" class="sumprog">${summaryExtra()}</div>` : ''}
    <div id="sum-shop"></div>
    <button class="btn ${me?.ready ? '' : 'primary'}" id="sum-ready">${me?.ready ? '等待隊友…（取消準備）' : `準備開始第 ${s.day + 1} 天`}</button>`;
}

/** Free play: pick a store type. Each map keeps its own save. */
export function mapPicker(saves: Record<string, StoreSave | null>, h: { play(map: string, fresh: boolean): void; back(): void; pack?(packId: string): void; records?(): void; hire?: { wage: number; hired: Record<string, boolean>; set(map: string, on: boolean): void } }, progs: Record<string, StoreProg> = {}) {
  show(`<div class="card wide"><div class="row" style="align-items:center"><h2 style="flex:1;margin:0">選擇店面</h2>${h.records ? '<button class="btn small" id="mp-records" style="flex:0">🏆 我的紀錄</button>' : ''}<button class="btn small" id="mp-back" style="flex:0">← 返回</button></div>
    <p class="muted">每種店賣的東西、擺設和工作站都不一樣。各自有獨立的存檔。每撐過一天，店面就會累積名聲（Lv1–10），解鎖免費小獎勵。</p>
    <div class="grid2">${MAPS.map(m => {
      const sv = saves[m.id];
      const foods = [m.coffee && `${m.coffee.icon}${m.coffee.food}`, m.meal && `${m.meal.icon}${m.meal.food}`].filter(Boolean).join('、') || '不賣吃的';
      const k = storeLock(m.id);
      if (k) return `<div class="shopitem mapcard locked-pack" style="--mc:${hex(m.theme.accent)}"><b class="mapname"><span class="mapicon">${m.icon}</span>${esc(m.name)}${lockBadge(m.id)}</b>
        <span class="muted">${esc(m.desc)}</span><span class="muted">🔒 ${esc(k.icon)} ${esc(k.name)}・主線上班可以免費玩到</span>
        <div class="row"><button class="btn purple" data-map-pack="${k.id}">🛍 看擴充包</button></div></div>`;
      return `<div class="shopitem mapcard" style="--mc:${hex(m.theme.accent)}"><b class="mapname"><span class="mapicon">${m.icon}</span>${esc(m.name)}</b>
        <span class="muted">${esc(m.desc)}</span>
        ${progs[m.id]?.days || sv ? levelBarHtml(progs[m.id], false, true) : ''}
        <span class="muted">商品：${[m.products.drinks, m.products.snacks, m.products.bento, m.products.extra].filter(Boolean).map(p => esc(p!.name)).join('、')}・現做：${esc(foods)}</span>
        ${h.hire ? `<label class="hirebox"><input type="checkbox" data-hire="${m.id}" ${h.hire.hired[m.id] ? 'checked' : ''}> 🧑‍💼 雇用小陳（日薪 $${h.hire.wage}，從當天營收扣）</label>` : ''}
        <div class="row">${sv ? `<button class="btn primary" data-map-cont="${m.id}">繼續（第 ${sv.day} 天）</button>` : ''}
        <button class="btn ${sv ? '' : 'primary'}" data-map="${m.id}">${sv ? '重新開店' : '開店營業'}</button></div></div>`;
    }).join('')}</div></div>`);
  document.getElementById('mp-back')!.onclick = () => h.back();
  on('mp-records', 'click', () => h.records?.());
  document.querySelectorAll<HTMLButtonElement>('[data-map-pack]').forEach(b => { b.onclick = () => h.pack?.(b.dataset.mapPack!); });
  document.querySelectorAll<HTMLInputElement>('[data-hire]').forEach(c => { c.onchange = () => h.hire?.set(c.dataset.hire!, c.checked); });
  document.querySelectorAll<HTMLButtonElement>('[data-map-cont]').forEach(b => { b.onclick = () => h.play(b.dataset.mapCont!, false); });
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => {
    b.onclick = () => (saves[b.dataset.map!] ? confirmTwice(b, '再按一次：覆蓋這間店的進度', () => h.play(b.dataset.map!, true)) : h.play(b.dataset.map!, true));
  });
}

/** In-page confirmation (works where dialogs are blocked): the first press arms the button, the second one acts. */
export function confirmTwice(btn: HTMLButtonElement, armedLabel: string, act: () => void) {
  if (btn.dataset.armed === '1') { act(); return; }
  btn.dataset.armed = '1'; btn.dataset.label = btn.textContent ?? '';
  btn.textContent = armedLabel; btn.classList.add('armed');
  window.setTimeout(() => { if (btn.isConnected && btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label ?? ''; btn.classList.remove('armed'); } }, 4000);
}
