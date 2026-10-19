// Entry point: main menu, solo / create / join flows, reconnect-to-last-room.
import { audio } from './audio.ts';
import { Game } from './game.ts';
import { LocalConnection, WsConnection } from './net.ts';
import {
  clearSoloSave, defaultServerUrl, detectPlatform, isTouch, loadCoopSave, loadLastSession, loadSettings, loadSoloSave, saveSettings,
} from './storage.ts';
import * as UI from './ui.ts';
import { careerScreen, loadProfile, resultScreen, saveProfile } from './career-ui.ts';
import { applyResult, buildShiftConfig, shiftUnlocked } from '../../shared/career.ts';
import type { ShiftResult } from '../../shared/career.ts';

let settings = loadSettings();
const platform = detectPlatform();
audio.setVolume(settings.volume);
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

function startGame(make: () => LocalConnection | WsConnection, onDone?: (reason?: string, result?: ShiftResult | null) => void) {
  audio.unlock();
  freshCanvas();
  UI.show('<div class="card"><h2>載入中…</h2><p class="muted">準備開店</p></div>');
  const conn = make();
  current = new Game(conn, settings, isTouch, (reason, result) => { current = null; if (onDone) onDone(reason, result); else menu(reason); });
  (window as unknown as { __game: Game }).__game = current; // used by automated browser tests
  tryFullscreenLandscape();
}

function tryFullscreenLandscape() {
  if (!isTouch) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try { void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.()); } catch { /* ignore */ }
  try { void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {}); } catch { /* ignore */ }
}

// ---------------- career (single-player main story) ----------------
function career() {
  const p = loadProfile();
  careerScreen(p, { back: () => menu(), play: id => playShift(id) });
}

function playShift(id: string) {
  const p = loadProfile();
  if (!shiftUnlocked(p, id).ok) return career();
  const cfg = buildShiftConfig(p, id);
  startGame(() => new LocalConnection(playerName(), null, cfg), (reason, result) => {
    if (!result) { if (reason) UI.message('提示', reason, '回職涯', career); else career(); return; }
    const prof = loadProfile();
    const reward = applyResult(prof, result);
    saveProfile(prof);
    resultScreen(result, reward, prof, { retry: () => playShift(id), next: n => (n ? playShift(n) : career()), career });
  });
}

function menu(error?: string) {
  const last = loadLastSession();
  const canRejoin = last && Date.now() - last.at < 125_000 ? last.code : null;
  UI.mainMenu(settings, {
    setName: n => { settings = { ...settings, name: n }; saveSettings(settings); },
    career: () => career(),
    solo: fresh => {
      if (fresh) clearSoloSave();
      const save = fresh ? null : loadSoloSave();
      startGame(() => new LocalConnection(playerName(), save));
    },
    create: cont => startGame(() => new WsConnection(serverUrl(), { kind: 'create', name: playerName(), save: cont ? loadCoopSave() : null }, platform)),
    join: code => startGame(() => new WsConnection(serverUrl(), { kind: 'join', code, name: playerName() }, platform)),
    rejoin: () => {
      const l = loadLastSession(); if (!l) return menu();
      startGame(() => new WsConnection(l.url, { kind: 'join', code: l.code, name: playerName(), token: l.token }, platform));
    },
    settings: () => UI.settingsMenu(settings, s => { settings = s; saveSettings(s); audio.setVolume(s.volume); menu(); }),
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
