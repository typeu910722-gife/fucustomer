// Entry point: main menu, solo / create / join flows, reconnect-to-last-room.
import { audio } from './audio.ts';
import { Game } from './game.ts';
import { LocalConnection, GameConnection } from './net.ts';
import type { Intent } from './net-ws.ts';
import {
  clearSoloSave, defaultServerUrl, detectPlatform, isTouch, loadCoopSave, loadLastSession, loadSettings, loadSoloSave, saveSettings,
} from './storage.ts';
import * as UI from './ui.ts';
import { careerScreen, loadProfile, resultScreen, saveProfile } from './career-ui.ts';
import { loadAccount, syncLicense } from './account.ts';
import { rankOf, dailyPlan, DAILY_MODS, DAILY_ID, ENDLESS_ID, applyResult, buildDailyConfig, buildShiftConfig, dailySeed, dailyUnlocked, endlessUnlocked, localDate, shiftUnlocked } from '../../shared/career.ts';
import type { ShiftResult } from '../../shared/career.ts';
import { updateAchievements } from '../../shared/achievements.ts';
import { CHAPTERS } from '../../shared/career.ts';
import { needsCourt, payFine } from '../../shared/court.ts';
import { SCENES, sceneAfter, sceneBefore } from '../../shared/story.ts';
import { courtScreen, playScene } from './story-ui.ts';
import { ownStoreConfig, settleStoreDay, staffPace } from '../../shared/ownstore.ts';
import { dayConfig } from '../../shared/sim.ts';
import { MAPS, getMap } from '../../shared/maps/index.ts';
import { OUTSIDE_SCORE, buildRaidConfig, raidReward } from '../../shared/raid.ts';
import { getStore, sendRaid, syncStore } from './friends.ts';
import { desktop, initPlatform, isApp, onAppPause, onBack, quitApp, reportAchievements } from './platform.ts';
import { effectiveLoadout, isSupporter, outfitOf, storeLocked, type Loadout } from '../../shared/shop.ts';
import { entitlementsFor } from './billing.ts';
import { setStoreDecor } from './cosmetics.ts';

let settings = loadSettings();
// 商城: stores from a paid pack are locked in free play / own store / hosting a room (never in the career story)
UI.setStoreLock(map => storeLocked(map, 'host', entitlementsFor(loadProfile())));
/** What you equipped in the 商城 (only items you really have). */
function myLoadout(): Loadout { const p = loadProfile(); return effectiveLoadout(p, entitlementsFor(p)); }
const myOutfit = () => outfitOf(myLoadout());
const platform = detectPlatform();
audio.setVolume(settings.volume);
audio.setMusicVolume(settings.music);
if (!isTouch) document.getElementById('rotate')!.classList.remove('enabled');

function serverUrl() { return settings.serverUrl || defaultServerUrl(); }
function playerName() { return settings.name || `店員${Math.floor(Math.random() * 900 + 100)}`; }

/** Each game gets a fresh canvas so the WebGL context is never shared between sessions. */
function freshCanvas() {
  const old = document.getElementById('view')!;
  const c = document.createElement('canvas'); c.id = 'view';
  old.replaceWith(c);
}

const LOADING_TIPS = [
  '奧客先失控、先推你，出手才算正當防衛。',
  '有背景的奧客（💼）打了一定有人報警，盡量別碰。',
  '貨架空了客人會不滿，補貨要趁早。',
  '小費是你自己的，薪水會被錢董硬凹。',
  '下班前記得鎖店門，不然好友會衝進來搗亂。',
  '抓不動的奧客，先揍暈或用拖把旋風轉暈再抓。',
  '充電霸王：拔兩次插頭，或請他喝杯咖啡。',
  '客製魔人一直改單？對他「複誦點單」。',
];

let current: Game | null = null;
let screenDepth = 0; // 0 = main menu; anything else = a sub screen (Android back button returns to the menu)

/** `decor`: 商城 store decorations to build (free play / your own store only). */
function startGame(make: () => GameConnection, onDone?: (reason?: string, result?: ShiftResult | null) => void, decor: Loadout | null = null) {
  audio.unlock();
  setStoreDecor(decor);
  freshCanvas();
  UI.show(`<div class="card loading"><div class="spinner">🛒</div><h2>開店準備中…</h2><p class="tip">💡 ${LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]}</p></div>`);
  tryFullscreenLandscape(); // needs the click that started the game
  (window as unknown as { __game: Game | null }).__game = null;
  // build the store on the next frame so the loading card paints and the click returns right away
  window.setTimeout(() => {
    const conn = make();
    current = new Game(conn, settings, isTouch, (reason, result) => { current = null; if (onDone) onDone(reason, result); else menu(reason); });
    (window as unknown as { __game: Game }).__game = current; // used by automated browser tests
  }, 30);
}

function tryFullscreenLandscape() {
  if (!isTouch) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try { void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.()); } catch { /* ignore */ }
  try { void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {}); } catch { /* ignore */ }
}

/** Server errors for a gone / full room, reworded for someone who just tapped an invite link. */
function friendlyJoinError(reason: string): string {
  if (/找不到房間/.test(reason)) return '😢 找不到這個房間：房主可能已經關房，或邀請連結過期了。請朋友重新開房、再傳一次邀請。';
  if (/房間已滿/.test(reason)) return `🈵 ${reason}：等有人離開再試，或請朋友另開一間。`;
  return reason;
}

/** Multiplayer code is fetched on demand, so solo players never download it. */
async function online(url: string, intent: Intent) {
  UI.show('<div class="card"><h2>連線中…</h2><p class="muted">正在連線到伺服器</p></div>');
  try {
    const { WsConnection, roomMap } = await import('./net-ws.ts');
    // build the 3D store for the room's store type
    if (intent.kind === 'join' && !intent.map) intent = { ...intent, map: await roomMap(url, intent.code) };
    startGame(() => new WsConnection(url, intent, platform), reason => (reason ? multiplayer(friendlyJoinError(reason)) : menu()));
  } catch { multiplayer('無法載入連線模組，請檢查網路'); }
}

// ---------------- career (single-player main story) ----------------
function career(tab?: Parameters<typeof careerScreen>[2], focus?: string) {
  screenDepth = 1;
  const p = loadProfile();
  // progress made before achievements existed counts too (no pop-ups for these)
  if (updateAchievements(p).length) saveProfile(p);
  careerScreen(p, {
    back: () => menu(), play: id => playShift(id), enterStore: () => playStore(),
    opened: () => sceneOnce('store-open', () => career('store')),
    raid: code => void raidFriend(code),
    freePlay: () => freePlay(),
  }, tab, focus);
}

/** Your own store: business days with an employee; every nightly save may end in bankruptcy. */
function playStore() {
  const p = loadProfile();
  if (!p.store) return career('store');
  const lock = storeLocked(p.store.map, 'own', entitlementsFor(p));
  if (lock) return career('shop', lock.id); // a store from a paid pack (e.g. opened during a QA unlock)
  const cfg = ownStoreConfig(p, dayConfig());
  const look = myLoadout();
  const st = p.store.staff;
  let conn: LocalConnection | null = null;
  let bankrupt = '';
  startGame(() => (conn = new LocalConnection(playerName(), p.store!.save, cfg, undefined, {
    // your employee wears the store uniform you picked in the 商城 (hat + apron; the name tag is yours)
    staff: st.quit ? undefined : { name: st.name, pace: staffPace(st.mood), outfit: outfitOf({ hat: look.hat, uniform: look.uniform }) },
    outfit: outfitOf(look),
    onSave: save => {
      const prof = loadProfile();
      const out = settleStoreDay(prof, save);
      saveProfile(prof);
      if (prof.store?.online) void syncStore(prof.store); // friends see today's shelves and rating
      if (out.quit) { conn?.dismissStaff(); cfg.staffWage = 0; current?.toast(`📋 員工受不了你的薪水，辭職了！`, 'bad', 5000); }
      else if (prof.store) conn?.setStaffPace(staffPace(prof.store.staff.mood));
      if (out.bankrupt) { bankrupt = out.reason; current?.toast(`💸 ${out.reason}……店撐不下去了`, 'bad', 5000); window.setTimeout(() => current?.exit(), 2500); }
    },
  })), () => {
    if (!bankrupt) return lockReminder();
    playScene('store-bankrupt', () => UI.message('倒閉了', `${bankrupt}。投入的錢全部賠光了，回去打工重新存吧。`, '回職涯', () => career('store')));
  }, look);
}

/** Leaving your own store with the door unlocked: friends could walk right in. */
function lockReminder() {
  const p = loadProfile();
  const on = p.store?.online;
  if (!p.store || !on || on.locked) return career('store');
  UI.show(`<div class="card"><h2>🔓 店門還沒鎖！</h2><p>下班不鎖門，好友可以衝進你的店搗亂。要鎖門嗎？</p>
    <div class="row"><button class="btn good" id="lk-yes">🔒 鎖門再走</button><button class="btn" id="lk-no">不用，就開著</button></div><div class="muted" id="lk-msg"></div></div>`);
  document.getElementById('lk-no')!.onclick = () => career('store');
  document.getElementById('lk-yes')!.onclick = async () => {
    on.locked = true; saveProfile(p);
    const r = await syncStore(p.store!);
    if (!r.ok) { on.locked = false; saveProfile(p); document.getElementById('lk-msg')!.textContent = r.error; return; }
    career('store');
  };
}

/** Raid a friend's store: 90 seconds as the troublemaker (or just trash at the door if it's locked). */
async function raidFriend(code: string) {
  screenDepth = 1;
  UI.show('<div class="card"><h2>找店中…</h2><p class="muted">正在查詢店碼</p></div>');
  const r = await getStore(code);
  if (!r.ok) return UI.message('去不了', r.error, '回職涯', () => career('store'));
  const v = r.data;
  const done = (title: string, body: string) => UI.message(title, body, '回職涯', () => career('store'));
  const pay = (score: number) => { const coins = raidReward(score); const p = loadProfile(); p.wallet += coins; saveProfile(p); return coins; };
  if (v.locked) {
    UI.show(`<div class="card"><h2>🔒 ${UI.esc(v.name)} 鎖門了</h2><p>店主下班有鎖門，進不去。你可以在門口丟一袋垃圾就走。</p>
      <div class="row"><button class="btn" id="rd-trash">🗑 在門口丟垃圾</button><button class="btn" id="rd-back">算了</button></div></div>`);
    document.getElementById('rd-back')!.onclick = () => career('store');
    document.getElementById('rd-trash')!.onclick = async () => {
      const s = await sendRaid(code, playerName(), OUTSIDE_SCORE, true);
      if (!s.ok) return done('沒丟成', s.error);
      done('丟完就跑 🏃', `你在 ${v.name} 門口丟了一袋垃圾。店主損失 $${s.data.money}。你拿到 $${pay(OUTSIDE_SCORE)} 零用錢。`);
    };
    return;
  }
  const cfg = buildRaidConfig(v);
  startGame(() => new LocalConnection(playerName(), null, cfg, undefined, { staff: { name: '店員', pace: 0.9 } }), async (_reason, result) => {
    if (!result) return career('store');
    const score = result.score ?? 0;
    const s = await sendRaid(code, playerName(), score, false);
    if (!s.ok) return done('搗亂結束', `分數 ${score}，但沒有送出：${s.error}`);
    done('搗亂結束 😈', `${getMap(v.map).icon} ${v.name}：分數 ${score}。店主損失 $${s.data.money}${s.data.rating ? `、口碑 −${s.data.rating}` : ''}。你拿到 $${pay(score)} 零用錢。`);
  });
}

function playShift(id: string) {
  const p = loadProfile();
  const ok = id === ENDLESS_ID ? endlessUnlocked(p) : id === DAILY_ID ? dailyUnlocked(p) : shiftUnlocked(p, id).ok;
  if (!ok) return career();
  const date = localDate();
  const cfg = id === DAILY_ID ? buildDailyConfig(p, date) : buildShiftConfig(p, id);
  const seed = id === DAILY_ID ? dailySeed(date) : undefined; // same customers for everyone on the same day
  // a story scene once, the first time a chapter starts
  const intro = sceneBefore(id);
  if (intro && SCENES[intro] && !p.story.includes(intro)) {
    p.story.push(intro); saveProfile(p);
    return playScene(intro, () => runShift(id, cfg, seed));
  }
  runShift(id, cfg, seed);
}

/** Plays a story scene once, then continues. */
function sceneOnce(sceneId: string | null, then: () => void, profile?: ReturnType<typeof loadProfile>) {
  const p = profile ?? loadProfile();
  if (!sceneId || !SCENES[sceneId] || p.story.includes(sceneId)) { then(); return; }
  p.story.push(sceneId); saveProfile(p);
  playScene(sceneId, then);
}

function runShift(id: string, cfg: ReturnType<typeof buildShiftConfig>, seed?: number) {
  startGame(() => new LocalConnection(playerName(), null, cfg, seed), (reason, result) => {
    if (!result) { if (reason) UI.message('提示', reason, '回職涯', career); else career(); return; }
    const prof = loadProfile();
    const reward = applyResult(prof, result);
    const fresh = updateAchievements(prof, result);
    saveProfile(prof);
    reportAchievements(prof.achievements);
    // after the last shift of a chapter: that chapter's ending scene, then carry on
    const lastOf: Record<number, string> = {}; for (const c of CHAPTERS) lastOf[c.n] = c.shifts[c.shifts.length - 1].id;
    const outro = result.won ? sceneAfter(result.shiftId, lastOf) : null;
    const then = (fn: () => void) => () => sceneOnce(outro, fn);
    const show = () => {
      resultScreen(result, reward, prof, fresh, { retry: then(() => playShift(id)), next: n => then(() => (n ? playShift(n) : career()))(), career: then(career) });
      audio.play(result.won ? 'win' : 'lose');
      if (reward.levels.length) window.setTimeout(() => audio.play('levelup'), 900);
      if (fresh.length) window.setTimeout(() => audio.play('achievement'), 1500);
    };
    if (!needsCourt(result.incidents)) return show();
    // someone called the police: interrogation before the pay slip
    sceneOnce('first-court', () => courtScreen(result.incidents!, cfg.chapter, cr => {
      const paid = payFine(prof, cr.fine, cr.extraCost);
      reward.court = { fine: paid, text: cr.text };
      saveProfile(prof);
      show();
    }), prof);
  });
}

/** Free play: choose a map, then run its business days (each map has its own save). */
function freePlay() {
  screenDepth = 1;
  const saves: Record<string, ReturnType<typeof loadSoloSave>> = {};
  for (const m of MAPS) saves[m.id] = loadSoloSave(m.id);
  UI.mapPicker(saves, {
    back: () => career(),
    pack: id => career('shop', id),
    play: (map, fresh) => {
      const p = loadProfile(), lock = storeLocked(map, 'free', entitlementsFor(p));
      if (lock) return career('shop', lock.id);
      if (fresh) clearSoloSave(map);
      const save = fresh ? null : loadSoloSave(map);
      const look = myLoadout();
      startGame(() => new LocalConnection(playerName(), save, undefined, undefined, { map, outfit: outfitOf(look) }), () => freePlay(), look);
    },
  });
}

function badge(): UI.CareerBadge {
  const p = loadProfile();
  const ents = entitlementsFor(p), look = effectiveLoadout(p, ents);
  return { level: p.level, rank: rankOf(p.level), title: p.title, stars: Object.values(p.stars).reduce((a, b) => a + b, 0), achievements: p.achievements.length, storeName: p.store?.name ?? '', hat: look.hat ?? '', supporter: isSupporter(p.shop.entitlements) };
}

function menu(error?: string) {
  screenDepth = 0;
  const last = loadLastSession();
  const canRejoin = last && Date.now() - last.at < 125_000 ? last.code : null;
  const account = loadAccount();
  const b = badge();
  if (account) void syncLicense({ name: playerName(), avatar: UI.loadAvatar(), level: b.level, rank: b.rank, title: b.title, stars: b.stars, achievements: b.achievements, storeName: b.storeName, hat: b.hat, supporter: b.supporter });
  audio.startMusic(8);
  const prof = loadProfile();
  let next: { id: string; title: string; map: string } | null = null;
  if (prof.stats.shifts > 0) for (const c of CHAPTERS) for (const sh of c.shifts) if (!next && !prof.stars[sh.id] && shiftUnlocked(prof, sh.id).ok) next = { id: sh.id, title: sh.title, map: (MAPS.find(m => m.id === (sh.map ?? 'convenience')) ?? MAPS[0]).icon };
  const today = localDate();
  const plan = dailyUnlocked(prof) ? dailyPlan(prof, today) : null;
  const daily = plan ? { map: `${(MAPS.find(m => m.id === plan.map) ?? MAPS[0]).icon} ${(MAPS.find(m => m.id === plan.map) ?? MAPS[0]).name}`, mods: plan.mods.map(m => DAILY_MODS[m].name).join('、'), done: prof.daily.date === today && prof.daily.rewarded } : null;
  UI.mainMenu(settings, {
    playNext: next ? () => playShift(next!.id) : undefined,
    playDaily: daily ? () => playShift(DAILY_ID) : undefined,
    setName: n => { settings = { ...settings, name: n }; saveSettings(settings); },
    career: () => career(),
    multiplayer: () => multiplayer(),
    rejoin: () => {
      const l = loadLastSession(); if (!l) return menu();
      online(l.url, { kind: 'join', code: l.code, name: playerName(), token: l.token, outfit: myOutfit() });
    },
    refresh: () => menu(),
    quit: isApp ? () => quitApp() : undefined,
    firstDay: loadProfile().stats.shifts === 0 ? () => playShift('1-1') : undefined,
    settings: () => { screenDepth = 1; return UI.settingsMenu(settings, s => { settings = s; saveSettings(s); audio.setVolume(s.volume); audio.setMusicVolume(s.music); menu(); }); },
  }, { coopSave: loadCoopSave(), canRejoin, server: serverUrl(), platform, error, badge: b, account, next, daily });
}

/** 打工人的號角: multiplayer with a store type and difficulty. */
function multiplayer(error?: string, code?: string) {
  screenDepth = 1;
  UI.multiplayerMenu({
    back: () => menu(),
    create: (cont, map, difficulty) => {
      const lock = storeLocked(map, 'host', entitlementsFor(loadProfile()));
      if (lock) return career('shop', lock.id);
      online(serverUrl(), { kind: 'create', name: playerName(), save: cont ? loadCoopSave() : null, map, difficulty, outfit: myOutfit() });
    },
    join: c => online(serverUrl(), { kind: 'join', code: c, name: playerName(), outfit: myOutfit() }),
    pack: id => career('shop', id),
  }, { coopSave: loadCoopSave(), error });
  if (code) { const el = document.getElementById('m-code') as HTMLInputElement | null; if (el) el.value = code; }
}

/** Invite link: confirm your name, then straight into the room (errors land on the 打工人的號角 screen). */
function inviteJoin(code: string) {
  screenDepth = 1;
  UI.inviteScreen(code, settings.name, {
    join: n => {
      if (n) { settings = { ...settings, name: n }; saveSettings(settings); }
      online(serverUrl(), { kind: 'join', code, name: playerName(), outfit: myOutfit() });
    },
    back: () => menu(),
  });
}

// Deep link: ?join=CODE (invite links, Steam rich-presence "connect" strings). Used once, then removed from the URL.
const params = new URLSearchParams(location.search);
const deepJoin = params.get('join');
if (deepJoin !== null) {
  params.delete('join');
  const q = params.toString();
  try { history.replaceState(history.state, '', location.pathname + (q ? `?${q}` : '') + location.hash); } catch { /* file:// etc. */ }
}
const inviteCode = UI.parseRoomCode(deepJoin);
if (inviteCode) inviteJoin(inviteCode);
else menu(deepJoin !== null ? '邀請連結的房間碼不正確，請朋友再傳一次。' : undefined);

// browsers only allow sound after the first tap/key: unlock, then start the menu music if we're still on a menu
const firstInput = () => { audio.unlock(); if (!current) audio.startMusic(8); };
window.addEventListener('pointerdown', firstInput, { once: true });
window.addEventListener('keydown', firstInput, { once: true });

// Offline support: cache the game files so solo play opens without a connection (web only).
if ('serviceWorker' in navigator && !isApp && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* optional */ }); });
}

// Native shells: back button, background pause, Steam "join game" → room code.
void initPlatform();
onBack(() => {
  if (current) { current.back(); return; }
  if (screenDepth === 0) quitApp(); else menu();
});
onAppPause(() => current?.appPaused());
desktop?.onJoinRequest(code => {
  const c = UI.parseRoomCode(code);
  if (current || !c) return;
  online(serverUrl(), { kind: 'join', code: c, name: playerName(), outfit: myOutfit() });
});
if (isApp) { const p = loadProfile(); updateAchievements(p); saveProfile(p); reportAchievements(p.achievements); }
