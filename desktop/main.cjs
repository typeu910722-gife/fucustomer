// Desktop shell for Windows / Steam. Loads the same web build the browser uses (no server needed for solo play).
const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('node:path');
const steam = require('./steam.cjs');

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

ipcMain.on('achieve', (_e, id) => steam.achieve(String(id)));
ipcMain.on('presence', (_e, code) => steam.setPresence(code ? String(code) : null));
ipcMain.on('fullscreen', (_e, on) => win?.setFullScreen(!!on));
ipcMain.on('quit', () => app.quit());

// Saves live in localStorage; make sure they are flushed to disk when the window closes.
app.on('before-quit', () => { try { session.defaultSession.flushStorageData(); } catch { /* ignore */ } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => { steam.init(); createWindow(); });
