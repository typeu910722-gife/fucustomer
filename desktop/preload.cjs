// Exposes a tiny, fixed API to the game page (window.fuDesktop). The page never gets Node.js access.
const { contextBridge, ipcRenderer } = require('electron');
let steam = false;
try { steam = !!ipcRenderer.sendSync('steam-status'); } catch { /* main not ready */ }
contextBridge.exposeInMainWorld('fuDesktop', {
  /** true when the Steam client is running and the App ID is configured. */
  steam,
  achieve: id => ipcRenderer.send('achieve', id),
  setPresence: code => ipcRenderer.send('presence', code),
  onJoinRequest: cb => ipcRenderer.on('join-request', (_e, code) => cb(code)),
  setFullscreen: on => ipcRenderer.send('fullscreen', on),
  quit: () => ipcRenderer.send('quit'),
});
