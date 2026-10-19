// Exposes a tiny, fixed API to the game page (window.fuDesktop). The page never gets Node.js access.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fuDesktop', {
  achieve: id => ipcRenderer.send('achieve', id),
  setPresence: code => ipcRenderer.send('presence', code),
  onJoinRequest: cb => ipcRenderer.on('join-request', (_e, code) => cb(code)),
  setFullscreen: on => ipcRenderer.send('fullscreen', on),
  quit: () => ipcRenderer.send('quit'),
});
