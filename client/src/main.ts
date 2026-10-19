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
import { DAILY_ID, ENDLESS_ID, applyResult, buildDailyConfig, buildShiftConfig, dailySeed, dailyUnlocked, endlessUnlocked, localDate, shiftUnlocked } from '../../shared/career.ts';
import type { ShiftResult } from '../../shared/career.ts';
import { updateAchievements } from '../../shared/achievements.ts';
import { CHAPTERS } from '../../shared/career.ts';
import { needsCourt, payFine } from '../../shared/court.ts';
import { SCENES, sceneAfter, sceneBefore } from '../../shared/story.ts';
import { courtScreen, playScene } from './story-ui.ts';
import { ownStoreConfig, settleStoreDay, staffPace } from '../../shared/ownstore.ts';
import { dayConfig } from '../../shared/sim.ts';
import { MAPS } from '../../shared/maps/index.ts';
import { desktop, initPlatform, isApp, onAppPause, onBack, quitApp, reportAchievements } from './platform.ts';

let settings = loadSettings();
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

let current: Game | null = null;
let screenDepth = 0; // 0 = main menu; anything else = a sub screen (Android back button returns to the menu)

function startGame(make: () => GameConnection, onDone?: (reason?: string, result?: ShiftResult | null) => void) {
  audio.unlock();
  freshCanvas();
  UI.show('<div class="card"><h2>載入中…</h2><p class="muted">準備開店</p></div>');
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

/** Multiplayer code is fetched on demand, so solo players never download it. */
async function online(url: string, intent: Intent) {
  UI.show('<div class="card"><h2>連線中…</h2><p class="muted">正在連線到伺服器</p></div>');
  try {
    const { WsConnection } = await import('./net-ws.ts');
    startGame(() => new WsConnection(url, intent, platform));
  } catch { menu('無法載入連線模組，請檢查網路'); }
}

// ---------------- career (single-player main story) ----------------
function career(tab?: Parameters<typeof careerScreen>[2]) {
  screenDepth = 1;
  const p = loadProfile();
  // progress made before achievements existed counts too (no pop-ups for these)
  if (updateAchievements(p).length) saveProfile(p);
  careerScreen(p, {
    back: () => menu(), play: id => playShift(id), enterStore: () => playStore(),
    opened: () => sceneOnce('store-open', () => career('store')),
  }, tab);
}

/** Your own store: business days with an employee; every nightly save may end in bankruptcy. */
function playStore() {
  const p = loadProfile();
  if (!p.store) return career('store');
  const cfg = ownStoreConfig(p, dayConfig());
  const st = p.store.staff;
  let conn: LocalConnection | null = null;
  let bankrupt = '';
  startGame(() => (conn = new LocalConnection(playerName(), p.store!.save, cfg, undefined, {
    staff: st.quit ? undefined : { name: st.name, pace: staffPace(st.mood) },
    onSave: save => {
      const prof = loadProfile();
      const out = settleStoreDay(prof, save);
      saveProfile(prof);
      if (out.quit) { conn?.dismissStaff(); cfg.staffWage = 0; current?.toast(`📋 員工受不了你的薪水，辭職了！`, 'bad', 5000); }
      else if (prof.store) conn?.setStaffPace(staffPace(prof.store.staff.mood));
      if (out.bankrupt) { bankrupt = out.reason; current?.toast(`💸 ${out.reason}……店撐不下去了`, 'bad', 5000); window.setTimeout(() => current?.exit(), 2500); }
    },
  })), () => {
    if (!bankrupt) return career('store');
    playScene('store-bankrupt', () => UI.message('倒閉了', `${bankrupt}。投入的錢全部賠光了，回去打工重新存吧。`, '回職涯', () => career('store')));
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
    back: () => menu(),
    play: (map, fresh) => {
      if (fresh) clearSoloSave(map);
      const save = fresh ? null : loadSoloSave(map);
      startGame(() => new LocalConnection(playerName(), save, undefined, undefined, { map }), () => freePlay());
    },
  });
}

function menu(error?: string) {
  screenDepth = 0;
  const last = loadLastSession();
  const canRejoin = last && Date.now() - last.at < 125_000 ? last.code : null;
  UI.mainMenu(settings, {
    setName: n => { settings = { ...settings, name: n }; saveSettings(settings); },
    career: () => career(),
    solo: () => freePlay(),
    create: cont => online(serverUrl(), { kind: 'create', name: playerName(), save: cont ? loadCoopSave() : null }),
    join: code => online(serverUrl(), { kind: 'join', code, name: playerName() }),
    rejoin: () => {
      const l = loadLastSession(); if (!l) return menu();
      online(l.url, { kind: 'join', code: l.code, name: playerName(), token: l.token });
    },
    quit: isApp ? () => quitApp() : undefined,
    firstDay: loadProfile().stats.shifts === 0 ? () => playShift('1-1') : undefined,
    settings: () => { screenDepth = 1; return UI.settingsMenu(settings, s => { settings = s; saveSettings(s); audio.setVolume(s.volume); audio.setMusicVolume(s.music); menu(); }); },
  }, { soloSave: loadSoloSave(), coopSave: loadCoopSave(), canRejoin, server: serverUrl(), platform, error });
}

// Deep link: ?join=CODE (used by share links and Steam rich-presence "connect" strings)
const params = new URLSearchParams(location.search);
const deepJoin = params.get('join');
if (deepJoin && /^[A-Z0-9]{5}$/i.test(deepJoin)) {
  menu();
  const codeInput = document.getElementById('m-code') as HTMLInputElement | null;
  if (codeInput) codeInput.value = deepJoin.toUpperCase();
} else menu();

window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true });

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
  if (current || !/^[A-Z0-9]{5}$/i.test(code)) return;
  online(serverUrl(), { kind: 'join', code: code.toUpperCase(), name: playerName() });
});
if (isApp) { const p = loadProfile(); updateAchievements(p); saveProfile(p); reportAchievements(p.achievements); }
