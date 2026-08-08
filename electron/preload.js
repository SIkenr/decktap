import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS } from './ipc-channels.js';

contextBridge.exposeInMainWorld('decktap', Object.freeze({
  addCustomApp: (candidateId, displayName) => ipcRenderer.invoke(
    IPC_CHANNELS.ADD_CUSTOM_APP,
    { candidateId, displayName },
  ),
  captureTarget: () => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_TARGET),
  clearTarget: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_TARGET),
  copyControlUrl: () => ipcRenderer.invoke(IPC_CHANNELS.COPY_CONTROL_URL),
  copyDiagnosticSummary: (level) => ipcRenderer.invoke(IPC_CHANNELS.COPY_DIAGNOSTIC_SUMMARY, level),
  disconnectAllDevices: () => ipcRenderer.invoke(IPC_CHANNELS.DISCONNECT_ALL_DEVICES),
  disconnectDevice: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.DISCONNECT_DEVICE, deviceId),
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SNAPSHOT),
  getLogDiagnostics: (level) => ipcRenderer.invoke(IPC_CHANNELS.GET_LOG_DIAGNOSTICS, level),
  lockMediaApp: (ruleId) => ipcRenderer.invoke(IPC_CHANNELS.LOCK_MEDIA_APP, ruleId),
  openLogFolder: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOG_FOLDER),
  openPermissionSettings: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_PERMISSION_SETTINGS),
  refreshPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_PERMISSIONS),
  removeCustomApp: (customAppId) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_CUSTOM_APP, customAppId),
  rotatePairing: () => ipcRenderer.invoke(IPC_CHANNELS.ROTATE_PAIRING),
  scanMediaTargets: (includeUnrecognized = false) => ipcRenderer.invoke(
    IPC_CHANNELS.SCAN_MEDIA_TARGETS,
    includeUnrecognized,
  ),
  selectMediaTarget: (candidateId) => ipcRenderer.invoke(IPC_CHANNELS.SELECT_MEDIA_TARGET, candidateId),
  setPageTurnMode: (mode) => ipcRenderer.invoke(IPC_CHANNELS.SET_PAGE_TURN_MODE, mode),
  setCloseToTray: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.SET_CLOSE_TO_TRAY, enabled),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.SET_LAUNCH_AT_LOGIN, enabled),
  setStartServiceOnLaunch: (enabled) => ipcRenderer.invoke(
    IPC_CHANNELS.SET_START_SERVICE_ON_LAUNCH,
    enabled,
  ),
  setTheme: (themeSource) => ipcRenderer.invoke(IPC_CHANNELS.SET_THEME, themeSource),
  startService: () => ipcRenderer.invoke(IPC_CHANNELS.START_SERVICE),
  stopService: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_SERVICE),
  onSnapshotChanged(callback) {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on(IPC_CHANNELS.SNAPSHOT_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SNAPSHOT_CHANGED, listener);
  },
}));
