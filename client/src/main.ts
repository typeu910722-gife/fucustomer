// Entry point: main menu, solo / create / join flows, reconnect-to-last-room.
import { audio } from './audio.ts';
// the 3D game (three.js) and the local simulation are loaded on demand: see loadGame()
import type { Game } from './game.ts';
import type { LocalConnection, GameConnection } from './net.ts';
import type { Intent } from './net-ws.ts';
import {
  clearSoloSave, loadFreeplayHires, saveFreeplayHire, saveSoloSave, defaultServerUrl, detectPlatform, isTouch, loadCoopSave, loadLastSession, loadSettings, loadSoloSave, saveSettings,
} from './storage.ts';
import * as UI from './ui.ts';
import { careerScreen, loadProfile, resultScreen, saveProfile } from './career-ui.ts';
import { loadAccount, syncLicense } from './account.ts';
import { CARD_WEEK_BADGES_MAX } from '../../shared/license-card.ts';
import { rankOf, dailyPlan, DAILY_MODS, DAILY_ID, ENDLESS_ID, applyResult, buildDailyConfig, buildShiftConfig, dailySeed, dailyUnlocked, endlessUnlocked, localDate, shiftUnlocked } from '../../shared/career.ts';
import type { ShiftResult } from '../../shared/career.ts';
import { updateAchievements } from '../../shared/achievements.ts';
import { CHAPTERS } from '../../shared/career.ts';
import { needsCourt, payFine } from '../../shared/court.ts';
import { CAST, SCENES, sceneAfter, sceneBefore } from '../../shared/story.ts';
import { courtScreen, playScene } from './story-ui.ts';
import { WEEKLY_ID, WEEKLY_TWISTS, applyWeekly, buildWeeklyConfig, isoWeek, weekBadge, weeklyPlan, weeklySeed, weeklyUnlocked } from '../../shared/weekly.ts';
import { applySpecialResult, buildSpecialConfig, specialOfShift, specialShiftId, specialUnlocked } from '../../shared/specialdays.ts';
import { SPECIAL_DAYS, SPECIAL_IDS } from '../../shared/genkarens.ts';
import { type ArcLine, type ArcPick, arcConfig, arcSpeaker, finishArc, pickArc, takePreScene } from '../../shared/regulars.ts';
import { setShiftRegular, setShiftStory, setStoreDecor } from './shift-ctx.ts';
import { getCosmetic } from '../../shared/shop.ts';
import { FREEPLAY_STAFF_WAGE, branchConfig, ownStoreConfig, settleStoreDay, staffPace } from '../../shared/ownstore.ts';
import { dayConfig, defaultSave } from '../../shared/sim.ts';
import { applyReportToSave, grantLevelCosmetics, newProg, payBranches, recordDay, SUPPLIER_BOX, type BranchPay, type DayReport, type StoreProg } from '../../shared/progression.ts';
import { summaryProgHtml } from './progress-ui.ts';
import { ALL_PRODUCTS } from '../../shared/constants.ts';
import type { StoreSave } from '../../shared/protocol.ts';
import type { CareerProfile } from '../../shared/career.ts';
import { MAPS, getMap } from '../../shared/maps/index.ts';
import { OUTSIDE_SCORE, buildRaidConfig, raidReward } from '../../shared/raid.ts';
import { getStore, sendRaid, syncStore } from './friends.ts';
import { desktop, initPlatform, isApp, onAppPause, onBack, quitApp, reportAchievements } from './platform.ts';
import { effectiveLoadout, isSupporter, outfitOf, storeLocked, type Loadout } from '../../shared/shop.ts';
import { entitlementsFor } from './billing.ts';
import { setPadBack, startPadNav } from './padnav.ts';
import { applyA11y } from './a11y.ts';
import { loadUiFonts } from './fonts.ts';

let settings = loadSettings();
applyA11y(settings); // 色盲友善・字級・音效字幕・減少動態效果
// 商城: stores from a paid pack are locked in free play / own store / hosting a room (never in the career story)
UI.setStoreLock(map => storeLocked(map, 'host', entitlementsFor(loadProfile())));
/** What you equipped in the 商城 (only items you really have). */
function myLoadout(): Loadout { const p = loadProfile(); return effectiveLoadout(p, entitlementsFor(p)); }
const myOutfit = () => outfitOf(myLoadout());
const platform = detectPlatform();
audio.setMaster(settings.master);
audio.setVolume(settings.volume);
audio.setMusicVolume(settings.music);
// desktop app opens full screen; honour 設定 → 全螢幕 off
if (desktop && settings.fullscreen === false) desktop.setFullscreen(false);
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

/**
 * Code splitting: the main menu needs none of the 3D code, so three.js, the renderer / store models and the local
 * simulation are fetched on demand (and warmed while the menu is idle, see the end of this file), which makes the
 * menu show up much sooner on slow phones and networks. The service worker caches the chunks for offline play.
 */
type GameMods = { G: typeof import('./game.ts'); N: typeof import('./net.ts') };
let gameMods: GameMods | null = null;
let gameLoading: Promise<GameMods> | null = null;
function loadGame() {
  return (gameLoading ??= Promise.all([import('./game.ts'), import('./net.ts')])
    .then(([G, N]) => (gameMods = { G, N }))
    .catch(e => { gameLoading = null; throw e; }));
}
/** Only called from a startGame() `make` callback, i.e. after loadGame() resolved. */
function localConn(...args: ConstructorParameters<typeof LocalConnection>): LocalConnection { return new gameMods!.N.LocalConnection(...args); }

/** `decor`: 商城 store decorations to build (free play / your own store only). */
function startGame(make: () => GameConnection, onDone?: (reason?: string, result?: ShiftResult | null) => void, decor: Loadout | null = null) {
  audio.unlock();
  setStoreDecor(decor);
  freshCanvas();
  UI.show(`<div class="card loading"><div class="spinner">🛒</div><h2>開店準備中…</h2><p class="tip">💡 ${LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]}</p></div>`);
  tryFullscreenLandscape(); // needs the click that started the game
  (window as unknown as { __game: Game | null }).__game = null;
  const t0 = performance.now();
  loadGame().then(({ G }) => {
    // build the store on the next frame so the loading card paints and the click returns right away
    window.setTimeout(() => {
      const conn = make();
      current = new G.Game(conn, settings, isTouch, (reason, result) => { current = null; if (onDone) onDone(reason, result); else menu(reason); });
      (window as unknown as { __game: Game }).__game = current; // used by automated browser tests
    }, Math.max(0, 30 - (performance.now() - t0)));
  }, () => menu('⚠ 遊戲檔案載入失敗，請檢查網路後再試一次。'));
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
    startGame(() => new WsConnection(url, intent, platform), reason => (reason?.startsWith('👋') ? menu(reason) : reason ? multiplayer(friendlyJoinError(reason)) : menu()));
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
    branch: i => playBranch(i),
  }, tab, focus);
}

// ---------------- 店面等級 (progression.ts) ----------------
/** What the nightly summary's 店面等級 panel shows (null outside free play / own store / branches). */
let night: { prog: StoreProg; r: DayReport | null; own: boolean; pays: BranchPay[] } | null = null;
function showStoreLevel(prog: StoreProg, own: boolean) {
  night = { prog: { ...prog }, r: null, own, pays: [] };
  UI.setSummaryExtra(() => (night ? summaryProgHtml(night.prog, night.r, night.own, night.pays) : ''));
}
function endStoreLevel() { night = null; UI.setSummaryExtra(null); }

/**
 * One closed business day of a store you run (free play, your own store or a branch): XP and records, tonight's event
 * and the 廠商熟客 box (also put into the running store), free level cosmetics, achievements, and the other branches'
 * income. Returns the save with the rewards applied.
 */
function storeNight(prof: CareerProfile, prog: StoreProg, save: StoreSave, prev: StoreSave, map: string, conn: LocalConnection | null, own: boolean, skipBranch?: string): StoreSave {
  const ds = conn?.dayStats();
  const input = {
    revenue: ds?.revenue ?? Math.max(0, save.totals.revenue - prev.totals.revenue),
    karens: ds?.karensResolved ?? Math.max(0, save.totals.karens - prev.totals.karens), rating: save.rating,
  };
  const products = ALL_PRODUCTS.filter(p => p !== 'extra' || !!getMap(map).products.extra);
  const r = recordDay(prog, input, { own, key: `${map}|${own ? 'own' : 'free'}|${save.day}|${save.totals.served}`, backstock: save.backstock, products });
  conn?.grant(r.event?.money ?? 0, r.event?.rating ?? 0, r.supplier ? { product: r.supplier, qty: SUPPLIER_BOX } : undefined);
  const gifts = grantLevelCosmetics(prof, r.level);
  const pays = payBranches(prof, localDate(), `${map}|${save.day}|${Date.now()}`, skipBranch);
  const fresh = updateAchievements(prof);
  night = { prog: { ...prog }, r, own, pays };
  UI.refreshSummaryExtra();
  if (r.levels.length) { current?.toast(`🎉 店面升級！Lv${r.level}${r.unlocked.length ? `・解鎖 ${r.unlocked.map(u => u.icon + u.name).join('、')}` : ''}`, 'good', 5000); audio.play('levelup'); }
  if (gifts.length) current?.toast('🎁 免費店面裝飾已放進商城，可以擺上了！', 'good', 4000);
  for (const a of fresh) current?.toast(`🏆 成就解鎖：${a.name}`, 'good', 4000);
  if (fresh.length) reportAchievements(prof.achievements);
  return applyReportToSave(save, r);
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
  showStoreLevel(p.store.prog ?? newProg(), true);
  let conn: LocalConnection | null = null;
  let bankrupt = '';
  startGame(() => (conn = localConn(playerName(), p.store!.save, cfg, undefined, {
    // your employee wears the store uniform you picked in the 商城 (hat + apron; the name tag is yours)
    staff: st.quit ? undefined : { name: st.name, pace: staffPace(st.mood), outfit: outfitOf({ hat: look.hat, uniform: look.uniform }) },
    outfit: outfitOf(look),
    onSave: (save, kind) => {
      const prof = loadProfile();
      // bought something between days: just keep the till / upgrades (no settlement)
      if (kind === 'purchase') { if (prof.store) { prof.store.save = save; saveProfile(prof); } return; }
      if (prof.store) save = storeNight(prof, (prof.store.prog ??= newProg()), save, prof.store.save, prof.store.map, conn, true);
      const out = settleStoreDay(prof, save);
      saveProfile(prof);
      if (prof.store?.online) void syncStore(prof.store); // friends see today's shelves and rating
      if (out.quit) { conn?.dismissStaff(); cfg.staffWage = 0; current?.toast(`📋 員工受不了你的薪水，辭職了！`, 'bad', 5000); }
      else if (prof.store) conn?.setStaffPace(staffPace(prof.store.staff.mood));
      if (out.bankrupt) { bankrupt = out.reason; current?.toast(`💸 ${out.reason}……店撐不下去了`, 'bad', 5000); window.setTimeout(() => current?.exit(), 2500); }
    },
  })), () => {
    endStoreLevel();
    // hit someone today? the police were waiting outside (the store's 監視器 footage goes with the case)
    const incidents = conn?.incidents() ?? [];
    const after = () => {
      if (!bankrupt) return lockReminder();
      playScene('store-bankrupt', () => UI.message('倒閉了', `${bankrupt}。投入的錢全部賠光了，回去打工重新存吧。`, '回職涯', () => career('store')));
    };
    if (!needsCourt(incidents)) return after();
    const prof = loadProfile();
    sceneOnce('first-court', () => courtScreen(incidents, ownStoreChapter(prof.level), cr => {
      const paid = payFine(prof, cr.fine, cr.extraCost);
      saveProfile(prof);
      UI.message('⚖ 審訊結束', paid ? `罰款從存款扣了 $${paid}。下次出手前，先看看是誰先失控。` : '無罪！一毛都不用付，回店裡繼續拚。', '好', after);
    }), prof);
  }, look);
}
/** How heavy the fines are for your own store (same scale as the career chapters). */
const ownStoreChapter = (level: number) => Math.max(1, Math.min(7, Math.ceil(level / 5)));

/** Visit one of your 分店: a business day like the flagship (the manager helps; no wage, no bankruptcy). */
function playBranch(i: number) {
  const p = loadProfile();
  const b = p.store?.branches?.[i];
  if (!p.store || !b) return career('store');
  if (storeLocked(b.map, 'own', entitlementsFor(p))) return career('store');
  const cfg = branchConfig(p, b, dayConfig());
  const look = myLoadout();
  let conn: LocalConnection | null = null;
  showStoreLevel(b.prog, false);
  const mine = (prof: CareerProfile) => prof.store?.branches?.find(x => x.map === b.map) ?? null;
  startGame(() => (conn = localConn(playerName(), b.save, cfg, undefined, {
    staff: { name: `店長${b.manager}`, pace: 1, outfit: outfitOf({ hat: look.hat, uniform: look.uniform }) },
    outfit: outfitOf(look),
    onSave: (save, kind) => {
      const prof = loadProfile(), br = mine(prof);
      if (!br) return;
      if (kind === 'night') save = storeNight(prof, br.prog, save, br.save, br.map, conn, false, br.map);
      br.save = save;
      saveProfile(prof);
    },
  })), () => {
    endStoreLevel();
    const incidents = conn?.incidents() ?? [];
    if (!needsCourt(incidents)) return career('store');
    const prof = loadProfile();
    sceneOnce('first-court', () => courtScreen(incidents, ownStoreChapter(prof.level), cr => {
      const paid = payFine(prof, cr.fine, cr.extraCost);
      saveProfile(prof);
      UI.message('⚖ 審訊結束', paid ? `罰款從存款扣了 $${paid}。分店店長說他什麼都沒看到。` : '無罪！店長幫你作證，回店裡繼續拚。', '好', () => career('store'));
    }), prof);
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
  startGame(() => localConn(playerName(), null, cfg, undefined, { staff: { name: '店員', pace: 0.9 } }), async (_reason, result) => {
    if (!result) return career('store');
    const score = result.score ?? 0;
    const s = await sendRaid(code, playerName(), score, false);
    if (!s.ok) return done('搗亂結束', `分數 ${score}，但沒有送出：${s.error}`);
    done('搗亂結束 😈', `${getMap(v.map).icon} ${v.name}：分數 ${score}。店主損失 $${s.data.money}${s.data.rating ? `、口碑 −${s.data.rating}` : ''}。你拿到 $${pay(score)} 零用錢。`);
  });
}

function playShift(id: string) {
  const p = loadProfile();
  const sp = specialOfShift(id);
  const ok = id === ENDLESS_ID ? endlessUnlocked(p) : id === DAILY_ID ? dailyUnlocked(p) : id === WEEKLY_ID ? weeklyUnlocked(p) : sp ? specialUnlocked(p) : shiftUnlocked(p, id).ok;
  if (!ok) return career();
  const date = localDate(), week = isoWeek();
  const cfg = id === DAILY_ID ? buildDailyConfig(p, date) : id === WEEKLY_ID ? buildWeeklyConfig(p, week) : sp ? buildSpecialConfig(p, sp) : buildShiftConfig(p, id);
  // same customers for everyone on the same day / week
  const seed = id === DAILY_ID ? dailySeed(date) : id === WEEKLY_ID ? weeklySeed(week) : undefined;
  // 常客奧客: one of the regulars may come back this shift (their card is shown once per stage)
  const arc = pickArc(p, cfg);
  if (arc) arcConfig(cfg, arc);
  const pre = arc ? takePreScene(p, arc) : null;
  // a story scene once, the first time a chapter starts
  const intro = sceneBefore(id);
  const showIntro = !!intro && !!SCENES[intro] && !p.story.includes(intro);
  if (showIntro) p.story.push(intro!);
  if (showIntro || pre) saveProfile(p);
  // the regular's pre-shift card is shown in the store during the prep seconds (never blocks starting the shift)
  const preCard = pre && arc ? { title: `${arc.arc.icon} 常客奧客・${arc.arc.name}（${arc.stage + 1}/${arc.arc.stages.length}）「${arc.arc.stages[arc.stage].title}」`, lines: arcLines(arc, pre) } : undefined;
  const go = () => runShift(id, cfg, seed, arc, preCard);
  // the first chapter's opening plays inside the store (speech bubbles), so a new player is moving within seconds
  if (showIntro && SCENES[intro!].inStore) { setShiftStory(SCENES[intro!].lines.map(l => ({ ...CAST[l.who], text: l.text }))); return go(); }
  setShiftStory(null);
  if (showIntro) return playScene(intro!, go);
  go();
}

/** A 常客奧客 arc's lines with speaker names and icons. */
function arcLines(pick: ArcPick, lines: ArcLine[]) { return lines.map(l => ({ ...arcSpeaker(pick.arc, l.who), text: l.text })); }

/** Plays a story scene once, then continues. */
function sceneOnce(sceneId: string | null, then: () => void, profile?: ReturnType<typeof loadProfile>) {
  const p = profile ?? loadProfile();
  if (!sceneId || !SCENES[sceneId] || p.story.includes(sceneId)) { then(); return; }
  p.story.push(sceneId); saveProfile(p);
  playScene(sceneId, then);
}

function runShift(id: string, cfg: ReturnType<typeof buildShiftConfig>, seed?: number, arc?: ArcPick | null, preCard?: { title: string; lines: { icon: string; name: string; text: string }[] }) {
  const st = arc?.arc.stages[arc.stage];
  setShiftRegular(arc && st ? { kind: arc.arc.kind, name: arc.arc.name, icon: arc.arc.icon, bubbles: st.bubbles, handled: st.handled, pre: preCard } : null);
  startGame(() => localConn(playerName(), null, cfg, seed), (reason, result) => {
    setShiftRegular(null);
    if (!result) { if (reason) UI.message('提示', reason, '回職涯', career); else career(); return; }
    const prof = loadProfile();
    const reward = result.shiftId === WEEKLY_ID ? applyWeekly(prof, result) : specialOfShift(result.shiftId) ? applySpecialResult(prof, result, localDate()) : applyResult(prof, result);
    const arcOut = arc ? finishArc(prof, arc, result) : null;
    if (arc && arcOut?.advanced) {
      // the stage's ending goes on the result screen (and the free reward when the story is over)
      const cos = getCosmetic(arcOut.cosmetic);
      reward.arc = {
        title: `${arc.arc.icon} 常客奧客・${arc.arc.name}「${arc.arc.stages[arc.stage].title}」${arcOut.completed ? '・故事完結' : `（${arc.stage + 1}/${arc.arc.stages.length}）`}`,
        lines: arcLines(arc, arcOut.post),
        gift: arcOut.completed && cos ? `🎁 獲得「${cos.icon} ${cos.name}」（免費，在商城可以${cos.slot === 'sign' || cos.slot === 'mascot' || cos.slot === 'mat' ? '擺上' : '穿上'}）・成就「${arc.arc.reward.title}」` : undefined,
      };
    }
    // 連鎖分店: a real shift somewhere else, so each branch sends its (capped) income and a report
    const pays = payBranches(prof, localDate(), `shift|${result.shiftId}|${Date.now()}`);
    const fresh = updateAchievements(prof, result);
    saveProfile(prof);
    reportAchievements(prof.achievements);
    // after the last shift of a chapter: that chapter's ending scene, then carry on
    const lastOf: Record<number, string> = {}; for (const c of CHAPTERS) lastOf[c.n] = c.shifts[c.shifts.length - 1].id;
    const outro = result.won ? sceneAfter(result.shiftId, lastOf) : null;
    const then = (fn: () => void) => () => sceneOnce(outro, fn);
    const show = () => {
      resultScreen(result, reward, prof, fresh, { retry: then(() => playShift(id)), next: n => then(() => (n ? playShift(n) : career()))(), career: then(career) });
      if (pays.length) document.querySelector('.result .reward')?.insertAdjacentHTML('afterend', `<div class="muted branchpay" style="text-align:center">🏬 分店入帳 +$${pays.reduce((n, x) => n + x.amount, 0)}・${pays.map(x => `${UI.esc(x.name)}店長${UI.esc(x.manager)}：「${UI.esc(x.line)}」`).join('　')}</div>`);
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
  const hired = loadFreeplayHires();
  const progs = loadProfile().freeProg;
  UI.mapPicker(saves, {
    hire: { wage: FREEPLAY_STAFF_WAGE, hired, set: (map, on) => { hired[map] = on; saveFreeplayHire(map, on); } },
    back: () => career(),
    records: () => career('stats'),
    pack: id => career('shop', id),
    special: id => playShift(id),
    play: (map, fresh) => {
      const p = loadProfile(), lock = storeLocked(map, 'free', entitlementsFor(p));
      if (lock) return career('shop', lock.id);
      if (fresh) clearSoloSave(map);
      const save = fresh ? null : loadSoloSave(map);
      const look = myLoadout();
      // 雇用小陳: the same employee bot as in your own store; the wage comes out of each day's settlement
      const staff = hired[map] ? { name: '小陳', pace: 1 } : undefined;
      // 店面等級: each night adds XP / records to this store type (kept even when you restart the store from day 1)
      let prev: StoreSave = save ?? defaultSave();
      let conn: LocalConnection | null = null;
      showStoreLevel(p.freeProg[map] ?? newProg(), false);
      const onSave = (sv: StoreSave, kind: 'night' | 'purchase') => {
        if (kind === 'night') {
          const prof = loadProfile();
          sv = storeNight(prof, (prof.freeProg[map] ??= newProg()), sv, prev, map, conn, false);
          saveProfile(prof);
        }
        prev = sv;
        saveSoloSave(sv, map);
      };
      startGame(() => (conn = localConn(playerName(), save, undefined, undefined, { map, outfit: outfitOf(look), staff, staffWage: staff ? FREEPLAY_STAFF_WAGE : undefined, onSave })), () => { endStoreLevel(); freePlay(); }, look);
    },
  }, progs, specialRows());
}

/** 特殊營業日 rows for the free-play picker (null while still locked). */
function specialRows(): UI.SpecialRow[] | null {
  const p = loadProfile(), today = localDate();
  if (!specialUnlocked(p)) return null;
  return SPECIAL_IDS.map(id => { const d = SPECIAL_DAYS[id], st = p.special[id]; return { id: specialShiftId(id), icon: d.icon, name: d.name, desc: d.desc, done: !!st && st.date === today && st.rewarded, wins: st?.wins ?? 0 }; });
}

function badge(): UI.CareerBadge {
  const p = loadProfile();
  const ents = entitlementsFor(p), look = effectiveLoadout(p, ents);
  return { level: p.level, rank: rankOf(p.level), title: p.title, stars: Object.values(p.stars).reduce((a, b) => a + b, 0), achievements: p.achievements.length, storeName: p.store?.name ?? '', hat: look.hat ?? '', supporter: isSupporter(p.shop.entitlements), weekBadges: p.weekly.badges.map(w => weekBadge(w)) };
}

function menu(error?: string) {
  screenDepth = 0;
  const last = loadLastSession();
  const canRejoin = last && Date.now() - last.at < 125_000 ? last.code : null;
  const account = loadAccount();
  const b = badge();
  const prof0 = loadProfile();
  if (account) void syncLicense({ name: playerName(), avatar: UI.loadAvatar(), level: b.level, rank: b.rank, title: b.title, stars: b.stars, achievements: b.achievements, storeName: b.storeName, hat: b.hat, supporter: b.supporter, weekBadges: prof0.weekly.badges.slice(-CARD_WEEK_BADGES_MAX), weekBadgeCount: prof0.weekly.badges.length });
  audio.startMusic(8);
  const prof = loadProfile();
  let next: { id: string; title: string; map: string } | null = null;
  if (prof.stats.shifts > 0) for (const c of CHAPTERS) for (const sh of c.shifts) if (!next && !prof.stars[sh.id] && shiftUnlocked(prof, sh.id).ok) next = { id: sh.id, title: sh.title, map: (MAPS.find(m => m.id === (sh.map ?? 'convenience')) ?? MAPS[0]).icon };
  const today = localDate();
  const plan = dailyUnlocked(prof) ? dailyPlan(prof, today) : null;
  const week = isoWeek();
  const wplan = weeklyUnlocked(prof) ? weeklyPlan(week) : null;
  const weekly = wplan ? { week: week.slice(5), title: `${WEEKLY_TWISTS[wplan.twist].icon} ${WEEKLY_TWISTS[wplan.twist].name}・${(MAPS.find(m => m.id === wplan.map) ?? MAPS[0]).icon} ${(MAPS.find(m => m.id === wplan.map) ?? MAPS[0]).name}`, goals: 3, done: prof.weekly.week === week ? [0, 1, 2].filter(i => prof.weekly.done & (1 << i)).length : 0 } : null;
  const daily = plan ? { map: `${(MAPS.find(m => m.id === plan.map) ?? MAPS[0]).icon} ${(MAPS.find(m => m.id === plan.map) ?? MAPS[0]).name}`, mods: plan.mods.map(m => DAILY_MODS[m].name).join('、'), done: prof.daily.date === today && prof.daily.rewarded } : null;
  UI.mainMenu(settings, {
    playNext: next ? () => playShift(next!.id) : undefined,
    playDaily: daily ? () => playShift(DAILY_ID) : undefined,
    playWeekly: weekly ? () => playShift(WEEKLY_ID) : undefined,
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
    settings: () => { screenDepth = 1; return UI.settingsMenu(settings, s => { settings = s; saveSettings(s); audio.setMaster(s.master); audio.setVolume(s.volume); audio.setMusicVolume(s.music); menu(); }); },
  }, { coopSave: loadCoopSave(), canRejoin, server: serverUrl(), platform, error, badge: b, account, next, daily, weekly });
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

// Warm the 3D game code once the menu is up, so the first shift opens without waiting for the download
// (this also lets the service worker cache it for offline play).
{
  const warm = () => { void loadGame().catch(() => { /* fetched again when a game starts */ }); void (document.fonts?.ready ?? Promise.resolve()).then(loadUiFonts); /* + the game font file, after the menu's */ };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 2500 }); else window.setTimeout(warm, 1200);
}

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
// Controller: D-pad / stick + A/B in every menu; B with no back button on screen = Android back (never quits).
setPadBack(() => { if (current) current.back(); else if (screenDepth !== 0) menu(); });
startPadNav();
desktop?.onJoinRequest(code => {
  const c = UI.parseRoomCode(code);
  if (current || !c) return;
  online(serverUrl(), { kind: 'join', code: c, name: playerName(), outfit: myOutfit() });
});
if (isApp) { const p = loadProfile(); updateAchievements(p); saveProfile(p); reportAchievements(p.achievements); }
