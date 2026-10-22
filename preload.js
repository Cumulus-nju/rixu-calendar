'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('rixu', {
  isDesktop: true,
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  setCaptureEnabled: (enabled) => ipcRenderer.invoke('capture:set-enabled', enabled),
  captureReady: () => ipcRenderer.invoke('capture:ready'),
  readClipboard: () => ipcRenderer.invoke('capture:read'),
  takeClipboard: () => ipcRenderer.invoke('capture:take'),
  notify: (payload) => ipcRenderer.invoke('notify', payload),
  setCloseToTray: (enabled) => ipcRenderer.invoke('app:set-close-to-tray', enabled),
  setLoginItem: (enabled) => ipcRenderer.invoke('app:set-login-item', enabled),
  getLoginItem: () => ipcRenderer.invoke('app:get-login-item'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
  exportData: (data) => ipcRenderer.invoke('app:export', data),
  importData: () => ipcRenderer.invoke('app:import'),
  aiExtract: (payload) => ipcRenderer.invoke('ai:extract', payload),
  aiAvailable: () => ipcRenderer.invoke('ai:available'),
  napcatConfigure: (config) => ipcRenderer.invoke('napcat:configure', config),
  napcatStatus: () => ipcRenderer.invoke('napcat:status'),
  napcatReconnect: () => ipcRenderer.invoke('napcat:reconnect'),
  napcatDisconnect: () => ipcRenderer.invoke('napcat:disconnect'),
  onNapcatStatus: (cb) => subscribe('napcat:status', cb),
  onNapcatSources: (cb) => subscribe('napcat:sources', cb),
  onNapcatMessage: (cb) => subscribe('napcat:message', cb),
  getVersion: () => ipcRenderer.invoke('app:version'),
  onCapture: (cb) => subscribe('capture:text', cb),
  onCaptureState: (cb) => subscribe('capture:state', cb),
  onManualCapture: (cb) => subscribe('capture:manual', cb)
});
