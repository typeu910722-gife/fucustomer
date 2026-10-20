// Desktop shell for Windows / Steam. Loads the same web build the browser uses (no server needed for solo play).
const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const steam = require('./steam.cjs');

// Fixed, ASCII-only save location so Steam Auto-Cloud can sync it:
//   Windows: %APPDATA%\FUCustomer\Local Storage\leveldb  (localStorage = career save, settings)
// Never change this name after release, or players lose their saves.
const DATA_NAME = 'FUCustomer';
app.setName(DATA_NAME);
const userData = path.join(app.getPath('appData'), DATA_NAME);
// One-time move from folders older test builds used (named after package.json name/productName).
try {
  if (!fs.existsSync(path.join(userData, 'Local Storage'))) {
    for (const old of ['奧客退散 FUCustomer', 'fucustomer-desktop']) {
      const src = path.join(app.getPath('appData'), old, 'Local Storage');
      if (fs.existsSync(src)) { fs.cpSync(src, path.join(userData, 'Local Storage'), { recursive: true }); break; }
    }
  }
} catch { /* start fresh */ }
app.setPath('userData', userData);

// Steam overlay needs Chromium switches set before 'ready' (no-op without an App ID).
steam.prepareOverlay();

if (!app.requestSingleInstanceLock()) app.quit();
Menu.setApplicationMenu(null);

let win = null;
/** Steam "Join Game" launches the game with `+join CODE` (see setPresence below). */
const joinCodeFrom = argv => { const i = argv.indexOf('+join'); return i >= 0 ? String(argv[i + 1] || '').slice(0, 5) : null; };
let pendingJoin = joinCodeFrom(process.argv);

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 720, minWidth: 960, minHeight: 540,
    fullscreen: !process.argv.includes('--windowed'),
    backgroundColor: '#141821', show: false, autoHideMenuBar: true,
    title: '奧客退散 FUCustomer',
    icon: path.join(__dirname, 'web', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true },
  });
  win.once('ready-to-show', () => win.show());
  // Keep everything inside the app; external links open nowhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // F11 toggles full screen
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
  win.webContents.on('did-finish-load', () => { if (pendingJoin) { win.webContents.send('join-request', pendingJoin); pendingJoin = null; } });
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
}

app.on('second-instance', (_e, argv) => {
  const code = joinCodeFrom(argv);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (code) win.webContents.send('join-request', code); }
});

ipcMain.on('steam-status', e => { e.returnValue = steam.ready(); });
ipcMain.on('achieve', (_e, id) => steam.achieve(String(id)));
ipcMain.on('presence', (_e, code) => steam.setPresence(code ? String(code) : null));
ipcMain.on('fullscreen', (_e, on) => win?.setFullScreen(!!on));
ipcMain.on('quit', () => app.quit());

// Saves live in localStorage; make sure they are flushed to disk when the window closes.
app.on('before-quit', () => { try { session.defaultSession.flushStorageData(); } catch { /* ignore */ } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  steam.init();
  createWindow();
  // Smoke-test hook (used by scripts/desktop-smoke.sh): report status, then quit.
  if (process.env.FU_DESKTOP_SMOKE) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const page = await win.webContents.executeJavaScript('({ title: document.title, bridge: !!window.fuDesktop, steam: window.fuDesktop && window.fuDesktop.steam, menu: !!document.querySelector("#m-career") })').catch(e => String(e));
      console.log('SMOKE', JSON.stringify({ steamStatus: steam.status(), userData: app.getPath('userData'), page }));
      app.quit();
    }, 4000));
  }
});
