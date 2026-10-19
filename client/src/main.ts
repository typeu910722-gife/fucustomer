// Entry point: main menu, solo / create / join flows, reconnect-to-last-room.
import { audio } from './audio.ts';
import { Game } from './game.ts';
import { LocalConnection, WsConnection } from './net.ts';
import {
  clearSoloSave, defaultServerUrl, detectPlatform, isTouch, loadCoopSave, loadLastSession, loadSettings, loadSoloSave, saveSettings,
} from './storage.ts';
import * as UI from './ui.ts';

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

function startGame(make: () => LocalConnection | WsConnection) {
  audio.unlock();
  freshCanvas();
  UI.show('<div class="card"><h2>連線中…</h2><p class="muted">正在連線到伺服器</p></div>');
  const conn = make();
  current = new Game(conn, settings, isTouch, reason => { current = null; menu(reason); });
  (window as unknown as { __game: Game }).__game = current; // used by automated browser tests
  tryFullscreenLandscape();
}

function tryFullscreenLandscape() {
  if (!isTouch) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try { void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.()); } catch { /* ignore */ }
  try { void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {}); } catch { /* ignore */ }
}

function menu(error?: string) {
  const last = loadLastSession();
  const canRejoin = last && Date.now() - last.at < 125_000 ? last.code : null;
  UI.mainMenu(settings, {
    setName: n => { settings = { ...settings, name: n }; saveSettings(settings); },
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
