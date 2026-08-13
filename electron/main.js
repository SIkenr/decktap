import path from 'node:path';

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  systemPreferences,
  Tray,
} from 'electron';

import keyboardModule from '../client/keyboard.js';
import lanServiceModule from '../client/lan-service.js';
import loginItemModule from '../client/login-item.js';
import logReaderModule from '../client/log-reader.js';
import loggerModule from '../client/logger.js';
import mediaTargetsModule from '../client/media-targets.js';
import preferencesModule from '../client/preferences.js';
import targetWindowModule from '../client/target-window.js';
import targetMonitorModule from '../client/target-monitor.js';
import trustedClientStoreModule from '../client/trusted-client-store.js';
import trayControllerModule from '../client/tray-controller.js';
import windowAdapterModule from '../client/window-adapter.js';
import { IPC_CHANNELS } from './ipc-channels.js';

const { createKeyboardController } = keyboardModule;
const { createLanService } = lanServiceModule;
const { createLoginItemController } = loginItemModule;
const { DIAGNOSTIC_LEVELS, formatDiagnosticSummary, readLogDiagnostics } = logReaderModule;
const { createLogger } = loggerModule;
const {
  createMediaTargetService,
  findBuiltInRule,
  findBuiltInRuleById,
  findCustomRule,
  QUICK_TARGET_RULE_IDS,
} = mediaTargetsModule;
const { createPreferencesStore, PAGE_TURN_MODES, THEME_SOURCES } = preferencesModule;
const { createTargetWindowController } = targetWindowModule;
const { createTargetMonitor } = targetMonitorModule;
const { createTrustedClientStore } = trustedClientStoreModule;
const { createTrayController } = trayControllerModule;
const { createPlatformWindowAdapter } = windowAdapterModule;

let mainWindow = null;
let logger = null;
let loginItemController = null;
let mediaTargetService = null;
let preferencesStore = null;
let service = null;
let targetWindowController = null;
let targetMonitor = null;
let trustedClientStore = null;
let trayController = null;
let unsubscribeService = null;
let mediaSuggestionTimer = null;
let mediaSuggestionScanning = false;
let switchSuggestionScanning = false;
let lastSwitchSuggestionScanAt = 0;
let isQuitting = false;

const MACOS_ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const MEDIA_SUGGESTION_INTERVAL_MS = 5000;
const SWITCH_SUGGESTION_MIN_INTERVAL_MS = 2500;

function isTrustedSender(event) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === event.sender.mainFrame,
  );
}

function requireTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
}

function safeServiceError(error) {
  if (!error) return null;
  if (error.code === 'EADDRINUSE') {
    return { code: error.code, message: '控制端口已被其他程序占用。' };
  }
  return { code: error.code || 'SERVICE_ERROR', message: '本地控制服务发生错误。' };
}

function requireShortString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

function getPermissionStatus() {
  if (process.platform !== 'darwin') return 'not-required';
  return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'missing';
}

function checkStartupPermissions() {
  const permissionStatus = getPermissionStatus();
  if (permissionStatus === 'missing') {
    systemPreferences.isTrustedAccessibilityClient(true);
    logger?.child('permissions').warn(
      'permission.startup-missing',
      'macOS Accessibility permission is missing at startup.',
      { permissionStatus },
    );
  }
  return permissionStatus;
}

function rememberTargetRule(target, explicitRuleId = null) {
  const customRule = findCustomRule(target, preferencesStore.get().customApps);
  const builtInRule = findBuiltInRule(target);
  const ruleId = explicitRuleId || customRule?.id || builtInRule?.id || null;
  preferencesStore.setLastLockedAppId(ruleId);
  return ruleId;
}

function applyTargetPageTurnDefaults(ruleId, source, target = null) {
  const builtInRuleId = target ? findBuiltInRule(target)?.id : null;
  if ((ruleId !== 'propresenter' && builtInRuleId !== 'propresenter')
    || preferencesStore.get().pageTurnMode === 'horizontal') return false;
  preferencesStore.setPageTurnMode('horizontal');
  logger?.child('settings').info(
    'settings.page-turn-mode.auto-horizontal',
    'The page turn mode was switched to horizontal for ProPresenter.',
    { pageTurnMode: 'horizontal', ruleId: ruleId || builtInRuleId, source },
  );
  return true;
}

async function restoreLastLockedTarget() {
  const ruleId = preferencesStore.get().lastLockedAppId;
  if (!ruleId) return;
  targetWindowController.arm();
  if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') return;
  try {
    const result = await mediaTargetService.lockRule(ruleId);
    if (result.outcome === 'locked') applyTargetPageTurnDefaults(result.ruleId, 'startup-restore', result.target);
    logger.child('media-targets').info(
      result.outcome === 'locked' ? 'media.target.restored' : 'media.target.restore-skipped',
      result.outcome === 'locked'
        ? 'The previously selected media application was locked at startup.'
        : 'The previously selected media application could not be locked unambiguously at startup.',
      { outcome: result.outcome, ruleId },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      preferencesStore.setLastLockedAppId(null);
      targetWindowController.clear();
    }
    logger.child('media-targets').warn(
      'media.target.restore-failed',
      'The previous media application could not be restored at startup.',
      { error, ruleId },
    );
  }
}

async function lockSingleStartupMediaTarget() {
  if (!mediaTargetService || !targetWindowController) return;
  const status = targetWindowController.getStatus();
  if (status === 'locked' || status === 'waiting') return;
  if (!preferencesStore.get().welcomeCompleted) return;
  if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') return;

  try {
    const result = await mediaTargetService.lockSingleRecognizedCandidate();
    if (result.outcome === 'locked') {
      const ruleId = rememberTargetRule(result.target, result.ruleId);
      applyTargetPageTurnDefaults(ruleId, 'startup-auto-lock', result.target);
      service?.broadcastControllerConfig();
    }
    logger.child('media-targets').info(
      result.outcome === 'locked' ? 'media.target.startup-auto-locked' : 'media.target.startup-scan-completed',
      result.outcome === 'locked'
        ? 'One recognized media application was automatically locked at startup.'
        : 'Startup media detection completed without an automatic lock.',
      {
        outcome: result.outcome,
        ruleId: result.ruleId || null,
        candidateCount: result.candidateCount ?? mediaTargetService.getSnapshot().candidates.length,
      },
    );
  } catch (error) {
    logger.child('media-targets').warn(
      'media.target.startup-scan-failed',
      'Startup media detection failed.',
      { error },
    );
  } finally {
    broadcastSnapshot();
  }
}

function getRememberedTargetName(ruleId, customApps) {
  if (!ruleId) return null;
  return findBuiltInRuleById(ruleId)?.displayName
    || customApps.find((rule) => rule.id === ruleId)?.displayName
    || null;
}

function createSnapshot() {
  const preferences = preferencesStore.get();
  const serviceSnapshot = service.getSnapshot();

  return {
    app: {
      platform: process.platform,
      version: app.getVersion(),
    },
    connectedClients: serviceSnapshot.connectedClients,
    controlUrl: serviceSnapshot.info?.controlUrl || null,
    deviceHistory: serviceSnapshot.deviceHistory,
    devices: serviceSnapshot.devices,
    interfaceName: serviceSnapshot.info?.interfaceName || null,
    mediaTargets: {
      ...mediaTargetService.getSnapshot(),
      customApps: preferences.customApps.map(({ id, displayName, platform }) => ({
        id,
        displayName,
        platform,
      })),
    },
    pairingCode: serviceSnapshot.info?.pairingCode || null,
    pairingExpiresAt: serviceSnapshot.info?.pairingExpiresAt || null,
    pageTurnMode: preferences.pageTurnMode,
    permissionStatus: getPermissionStatus(),
    serviceError: safeServiceError(serviceSnapshot.lastError),
    serviceState: serviceSnapshot.state,
    trustedClients: serviceSnapshot.trustedClients,
    settings: {
      closeToTray: preferences.closeToTray,
      launchAtLogin: loginItemController?.getEnabled() || false,
      launchAtLoginSupported: loginItemController?.isSupported() || false,
      startServiceOnLaunch: preferences.startServiceOnLaunch,
      welcomeCompleted: preferences.welcomeCompleted,
    },
    target: (() => {
      const target = targetWindowController?.getTarget() || null;
      const ruleId = preferences.lastLockedAppId;
      const controllerStatus = targetWindowController?.getStatus() || 'unconfigured';
      return {
        appName: target?.appName || getRememberedTargetName(ruleId, preferences.customApps),
        focusProtection: Boolean(target || ruleId),
        ruleId,
        status: !target && ruleId ? 'waiting' : controllerStatus,
      };
    })(),
    theme: {
      effective: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      source: preferences.themeSource,
    },
  };
}

function broadcastSnapshot() {
  const snapshot = createSnapshot();
  trayController?.refresh(snapshot);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.SNAPSHOT_CHANGED, snapshot);
}

async function scanMediaSuggestions() {
  if (mediaSuggestionScanning || !mediaTargetService || !targetWindowController) return;
  const status = targetWindowController.getStatus();
  if (status === 'locked' || status === 'waiting') return;
  if (!preferencesStore.get().welcomeCompleted) return;
  if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') return;

  mediaSuggestionScanning = true;
  try {
    const previousSnapshot = mediaTargetService.getSnapshot();
    if (previousSnapshot.showingAll) return;
    await mediaTargetService.scan();
    const nextSnapshot = mediaTargetService.getSnapshot();
    if (nextSnapshot.candidates.length > 0
      || previousSnapshot.candidates.length !== nextSnapshot.candidates.length
      || previousSnapshot.status !== nextSnapshot.status) {
      broadcastSnapshot();
    }
  } catch (error) {
    logger?.child('media-targets').debug(
      'media.suggestion-scan.failed',
      'Automatic media process detection did not complete.',
      { error },
    );
  } finally {
    mediaSuggestionScanning = false;
  }
}

async function scanSwitchSuggestions(ruleId) {
  if (switchSuggestionScanning || !mediaTargetService || !targetWindowController) return;
  if (!ruleId || targetWindowController.getStatus() === 'locked') return;
  if (!preferencesStore.get().welcomeCompleted) return;
  if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') return;

  const now = Date.now();
  if (now - lastSwitchSuggestionScanAt < SWITCH_SUGGESTION_MIN_INTERVAL_MS) return;
  lastSwitchSuggestionScanAt = now;
  switchSuggestionScanning = true;
  try {
    const previousSnapshot = mediaTargetService.getSnapshot();
    if (previousSnapshot.showingAll) return;
    await mediaTargetService.scanRecognizedCandidates({ excludeRuleId: ruleId });
    const nextSnapshot = mediaTargetService.getSnapshot();
    if (nextSnapshot.candidates.length > 0
      || previousSnapshot.candidates.length !== nextSnapshot.candidates.length
      || previousSnapshot.status !== nextSnapshot.status) {
      logger?.child('media-targets').info(
        nextSnapshot.candidates.length > 0 ? 'media.target.switch-candidates-found' : 'media.target.switch-candidates-empty',
        nextSnapshot.candidates.length > 0
          ? 'Alternative presentation applications were detected after the locked target disappeared.'
          : 'No alternative presentation applications were detected after the locked target disappeared.',
        { ruleId, candidateCount: nextSnapshot.candidates.length },
      );
      broadcastSnapshot();
    }
  } catch (error) {
    logger?.child('media-targets').debug(
      'media.target.switch-scan.failed',
      'Alternative media process detection did not complete.',
      { error, ruleId },
    );
  } finally {
    switchSuggestionScanning = false;
  }
}

function startMediaSuggestionScanner() {
  if (mediaSuggestionTimer) return;
  mediaSuggestionTimer = setInterval(() => { void scanMediaSuggestions(); }, MEDIA_SUGGESTION_INTERVAL_MS);
  if (typeof mediaSuggestionTimer.unref === 'function') mediaSuggestionTimer.unref();
  void scanMediaSuggestions();
}

function stopMediaSuggestionScanner() {
  if (!mediaSuggestionTimer) return;
  clearInterval(mediaSuggestionTimer);
  mediaSuggestionTimer = null;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

async function toggleServiceFromTray(isRunning) {
  try {
    if (isRunning) await service.stop();
    else await service.start();
  } catch (error) {
    logger?.child('tray').error('tray.service-toggle.failed', 'The tray service action failed.', { error });
  } finally {
    broadcastSnapshot();
  }
}

function registerIpcHandlers() {
  function getLogDiagnostics(level) {
    if (!DIAGNOSTIC_LEVELS.has(level)) throw new TypeError('Unsupported diagnostic log level');
    return readLogDiagnostics({
      filePath: logger.getLogFilePath(),
      level,
      limit: 100,
    });
  }

  ipcMain.handle(IPC_CHANNELS.GET_LOG_DIAGNOSTICS, (event, level = 'all') => {
    requireTrustedSender(event);
    return getLogDiagnostics(level);
  });

  ipcMain.handle(IPC_CHANNELS.SET_START_SERVICE_ON_LAUNCH, (event, enabled) => {
    requireTrustedSender(event);
    preferencesStore.setStartServiceOnLaunch(requireBoolean(enabled, 'Start-service setting'));
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.SET_CLOSE_TO_TRAY, (event, enabled) => {
    requireTrustedSender(event);
    preferencesStore.setCloseToTray(requireBoolean(enabled, 'Close-to-tray setting'));
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.SET_LAUNCH_AT_LOGIN, (event, enabled) => {
    requireTrustedSender(event);
    const safeEnabled = requireBoolean(enabled, 'Launch-at-login setting');
    loginItemController.setEnabled(safeEnabled);
    preferencesStore.setLaunchAtLogin(safeEnabled);
    logger.child('settings').info('settings.launch-at-login.changed', 'Launch at login was changed.', {
      enabled: safeEnabled,
    });
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.COPY_DIAGNOSTIC_SUMMARY, (event, level = 'all') => {
    requireTrustedSender(event);
    const diagnostics = getLogDiagnostics(level);
    clipboard.writeText(formatDiagnosticSummary(diagnostics, {
      platform: process.platform,
      version: app.getVersion(),
    }));
    logger.child('diagnostics').info(
      'diagnostics.summary.copied',
      'A sanitized diagnostic summary was copied by the user.',
      { level, recordCount: diagnostics.records.length },
    );
    return { copied: true };
  });

  ipcMain.handle(IPC_CHANNELS.DISCONNECT_DEVICE, (event, deviceId) => {
    requireTrustedSender(event);
    const safeDeviceId = requireShortString(deviceId, 'Device identifier', 40);
    if (!/^client-[1-9]\d*$/.test(safeDeviceId)) throw new TypeError('Device identifier is invalid');
    service.disconnectClient(safeDeviceId);
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.DISCONNECT_ALL_DEVICES, (event) => {
    requireTrustedSender(event);
    service.disconnectAllClients();
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.SCAN_MEDIA_TARGETS, async (event, includeUnrecognized = false) => {
    requireTrustedSender(event);
    if (typeof includeUnrecognized !== 'boolean') throw new TypeError('Scan option is invalid');
    if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') {
      systemPreferences.isTrustedAccessibilityClient(true);
      throw new Error('Accessibility permission is required before scanning application windows.');
    }
    const scanPromise = mediaTargetService.scan({ includeUnrecognized });
    broadcastSnapshot();
    try {
      await scanPromise;
      logger.child('media-targets').info('media.scan.completed', 'Media target scan completed.', {
        candidateCount: mediaTargetService.getSnapshot().candidates.length,
        status: mediaTargetService.getSnapshot().status,
      });
    } catch (error) {
      logger.child('media-targets').error('media.scan.failed', 'Media target scan failed.', { error });
      throw error;
    } finally {
      broadcastSnapshot();
    }
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.LOCK_MEDIA_APP, async (event, ruleId) => {
    requireTrustedSender(event);
    const safeRuleId = requireShortString(ruleId, 'Media application rule', 80);
    if (!QUICK_TARGET_RULE_IDS.includes(safeRuleId)) throw new TypeError('Unsupported quick target rule');
    if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') {
      systemPreferences.isTrustedAccessibilityClient(true);
      throw new Error('Accessibility permission is required before locking an application window.');
    }
    preferencesStore.setLastLockedAppId(safeRuleId);
    targetWindowController.arm();
    const result = await mediaTargetService.lockRule(safeRuleId);
    if (result.outcome === 'locked') {
      const ruleId = rememberTargetRule(result.target, result.ruleId);
      applyTargetPageTurnDefaults(ruleId, 'quick-lock', result.target);
      service.broadcastControllerConfig();
    }
    logger.child('media-targets').info('media.quick-lock.completed', 'A quick media target action completed.', {
      outcome: result.outcome,
      ruleId: safeRuleId,
    });
    broadcastSnapshot();
    return { outcome: result.outcome, snapshot: createSnapshot() };
  });

  ipcMain.handle(IPC_CHANNELS.SELECT_MEDIA_TARGET, async (event, candidateId) => {
    requireTrustedSender(event);
    const safeCandidateId = requireShortString(candidateId, 'Candidate identifier', 100);
    try {
      const selection = await mediaTargetService.selectCandidate(safeCandidateId);
      const { target } = selection;
      const ruleId = rememberTargetRule(target, selection.ruleId);
      applyTargetPageTurnDefaults(ruleId, 'candidate-selection', target);
      logger.child('media-targets').info('media.target.selected', 'A scanned media target was selected.', {
        appName: target.appName,
        platform: target.platform,
      });
      broadcastSnapshot();
      service.broadcastControllerConfig();
      return createSnapshot();
    } catch (error) {
      logger.child('media-targets').error(
        'media.target.select-failed',
        'A scanned media target could not be selected.',
        { error },
      );
      broadcastSnapshot();
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ADD_CUSTOM_APP, async (event, payload) => {
    requireTrustedSender(event);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('Custom application payload is invalid');
    }
    const candidateId = requireShortString(payload.candidateId, 'Candidate identifier', 100);
    const displayName = requireShortString(payload.displayName, 'Custom application name', 80);
    const customApp = mediaTargetService.createCustomApp(candidateId, displayName);
    preferencesStore.addCustomApp(customApp);
    await mediaTargetService.scan();
    logger.child('media-targets').info('media.custom-app.added', 'A custom media application was added.', {
      customAppId: customApp.id,
      displayName: customApp.displayName,
      platform: customApp.platform,
    });
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_CUSTOM_APP, async (event, customAppId) => {
    requireTrustedSender(event);
    const safeId = requireShortString(customAppId, 'Custom application identifier', 80);
    preferencesStore.removeCustomApp(safeId);
    await mediaTargetService.scan();
    logger.child('media-targets').info('media.custom-app.removed', 'A custom media application was removed.', {
      customAppId: safeId,
    });
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.CAPTURE_TARGET, async (event) => {
    requireTrustedSender(event);
    if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') {
      systemPreferences.isTrustedAccessibilityClient(true);
      throw new Error('Accessibility permission is required before locking a target window.');
    }

    mainWindow?.hide();
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const target = await targetWindowController.captureCurrent();
      const ruleId = rememberTargetRule(target);
      applyTargetPageTurnDefaults(ruleId, 'manual-capture', target);
      logger.child('target-window').info('target.captured', 'A presentation target was captured.', {
        appName: target.appName,
        platform: target.platform,
      });
    } catch (error) {
      logger.child('target-window').error('target.capture.failed', 'The presentation target could not be captured.', {
        error,
      });
      throw error;
    } finally {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }
    broadcastSnapshot();
    service.broadcastControllerConfig();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_TARGET, async (event) => {
    requireTrustedSender(event);
    targetWindowController.clear();
    preferencesStore.setLastLockedAppId(null);
    logger.child('target-window').info('target.cleared', 'The presentation target was cleared.');
    if (preferencesStore.get().welcomeCompleted
      && (process.platform !== 'darwin' || getPermissionStatus() === 'granted')) {
      try {
        await mediaTargetService.scanRecognizedCandidates();
      } catch (error) {
        logger.child('media-targets').debug(
          'media.clear-scan.failed',
          'Media process detection after clearing the target did not complete.',
          { error },
        );
      }
    }
    broadcastSnapshot();
    service.broadcastControllerConfig();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.GET_SNAPSHOT, (event) => {
    requireTrustedSender(event);
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.START_SERVICE, async (event) => {
    requireTrustedSender(event);
    await service.start();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.STOP_SERVICE, async (event) => {
    requireTrustedSender(event);
    await service.stop();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.ROTATE_PAIRING, (event) => {
    requireTrustedSender(event);
    service.rotatePairing();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.SET_THEME, (event, themeSource) => {
    requireTrustedSender(event);
    if (!THEME_SOURCES.has(themeSource)) throw new TypeError('Unsupported theme source');
    preferencesStore.setThemeSource(themeSource);
    nativeTheme.themeSource = themeSource;
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.SET_WELCOME_COMPLETED, async (event, completed) => {
    requireTrustedSender(event);
    const safeCompleted = requireBoolean(completed, 'Welcome setting');
    preferencesStore.setWelcomeCompleted(safeCompleted);
    logger.child('settings').info('settings.welcome.changed', 'The welcome screen setting was changed.', {
      completed: safeCompleted,
    });
    if (safeCompleted && (process.platform !== 'darwin' || getPermissionStatus() === 'granted')) {
      try {
        await mediaTargetService.scanRecognizedCandidates();
      } catch (error) {
        logger.child('media-targets').debug(
          'media.welcome-scan.failed',
          'Media process detection after the welcome screen did not complete.',
          { error },
        );
      }
    }
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.SET_PAGE_TURN_MODE, (event, pageTurnMode) => {
    requireTrustedSender(event);
    if (!PAGE_TURN_MODES.has(pageTurnMode)) throw new TypeError('Unsupported page-turn mode');
    preferencesStore.setPageTurnMode(pageTurnMode);
    service.broadcastControllerConfig();
    broadcastSnapshot();
    return createSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.COPY_CONTROL_URL, (event) => {
    requireTrustedSender(event);
    const controlUrl = service.getInfo()?.controlUrl;
    if (!controlUrl) return false;
    clipboard.writeText(controlUrl);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_LOG_FOLDER, async (event) => {
    requireTrustedSender(event);
    const result = await shell.openPath(app.getPath('logs'));
    return { opened: result === '' };
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_PERMISSION_SETTINGS, async (event) => {
    requireTrustedSender(event);
    if (process.platform !== 'darwin') return { opened: false };
    await shell.openExternal(MACOS_ACCESSIBILITY_SETTINGS_URL);
    logger.child('permissions').info(
      'permission.settings.opened',
      'The macOS Accessibility settings page was opened by the user.',
    );
    return { opened: true };
  });

  ipcMain.handle(IPC_CHANNELS.REFRESH_PERMISSIONS, (event) => {
    requireTrustedSender(event);
    const permissionStatus = getPermissionStatus();
    logger.child('permissions').info(
      'permission.status.checked',
      'The system permission status was checked by the user.',
      { permissionStatus },
    );
    broadcastSnapshot();
    return createSnapshot();
  });
}

function createWindow({ showOnReady = false } = {}) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'DeckTap',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#10141c' : '#f4f7fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => {
    if (showOnReady) mainWindow?.show();
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (preferencesStore?.get().closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
      logger?.child('window').info('window.hidden-to-tray', 'The main window was hidden to the system tray.');
      return;
    }
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['退出 DeckTap', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '退出 DeckTap',
      message: '关闭窗口将退出 DeckTap，并停止手机控制服务。',
      detail: '如果想关闭窗口后继续在托盘运行，请在应用设置中重新开启“关闭窗口时继续在托盘运行”。',
    });
    if (choice !== 0) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
    ));
  }
}

async function initialize() {
  app.setAppLogsPath();
  logger = createLogger({
    level: process.env.DECKTAP_LOG_LEVEL || 'info',
    logDir: app.getPath('logs'),
  });
  preferencesStore = createPreferencesStore({
    filePath: path.join(app.getPath('userData'), 'settings.json'),
  });
  trustedClientStore = createTrustedClientStore({
    filePath: path.join(app.getPath('userData'), 'trusted-clients.json'),
  });
  loginItemController = createLoginItemController({ app, platform: process.platform });
  nativeTheme.themeSource = preferencesStore.get().themeSource;

  const windowAdapter = createPlatformWindowAdapter({
    excludeProcessId: process.pid,
  });
  targetWindowController = createTargetWindowController({
    adapter: windowAdapter,
    focusDelayMs: process.platform === 'darwin' ? 450 : 100,
    focusRetryDelayMs: process.platform === 'darwin' ? 250 : 100,
    focusVerificationAttempts: process.platform === 'darwin' ? 3 : 2,
    onStatusChanged: () => {
      broadcastSnapshot();
      service?.broadcastControllerConfig();
    },
  });
  mediaTargetService = createMediaTargetService({
    adapter: windowAdapter,
    targetWindowController,
    getCustomApps: () => preferencesStore.get().customApps,
  });

  service = createLanService({
    port: 9999,
    staticPath: app.isPackaged
      ? path.join(process.resourcesPath, 'dist')
      : path.join(app.getAppPath(), 'decktap-web', 'dist'),
    keyboardController: createKeyboardController({
      targetWindowController,
      focusSettleDelayMs: process.platform === 'darwin' ? 220 : 0,
    }),
    getControllerConfig: () => ({
      pageTurnMode: preferencesStore.get().pageTurnMode,
      target: {
        appName: targetWindowController.getTarget()?.appName || null,
        status: targetWindowController.getStatus(),
      },
    }),
    onControllerConfigChanged: ({ pageTurnMode }) => {
      if (!PAGE_TURN_MODES.has(pageTurnMode)) throw new TypeError('Unsupported page-turn mode');
      preferencesStore.setPageTurnMode(pageTurnMode);
      logger.child('settings').info('settings.page-turn-mode.changed', 'The page turn mode was changed by a controller.', {
        pageTurnMode,
        source: 'controller',
      });
      broadcastSnapshot();
    },
    logger: logger.child('lan-service'),
    trustedClientStore,
  });
  targetMonitor = createTargetMonitor({
    mediaTargetService,
    targetWindowController,
    getRuleId: () => preferencesStore.get().lastLockedAppId,
    canMonitor: () => process.platform !== 'darwin' || getPermissionStatus() === 'granted',
    onRebound: ({ ruleId }) => {
      applyTargetPageTurnDefaults(ruleId, 'target-rebound');
      logger.child('media-targets').info(
        'media.target.auto-rebound',
        'A presentation playback window was automatically locked after it appeared.',
        { ruleId },
      );
      broadcastSnapshot();
      service.broadcastControllerConfig();
    },
    onWaiting: ({ outcome, ruleId }) => {
      logger.child('media-targets').debug(
        'media.target.monitor-waiting',
        'The target monitor is waiting for one unambiguous playback window.',
        { outcome, ruleId },
      );
      broadcastSnapshot();
      service.broadcastControllerConfig();
    },
    onUnresolved: ({ ruleId }) => {
      void scanSwitchSuggestions(ruleId);
    },
    onError: (error, ruleId) => logger.child('media-targets').warn(
      'media.target.monitor-failed',
      'The target monitor could not inspect presentation windows.',
      { error, ruleId },
    ),
  });
  unsubscribeService = service.subscribe(broadcastSnapshot);
  checkStartupPermissions();
  preferencesStore.setLastLockedAppId(null);
  targetWindowController.clear();
  await lockSingleStartupMediaTarget();
  targetMonitor.start();
  startMediaSuggestionScanner();

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  registerIpcHandlers();
  nativeTheme.on('updated', broadcastSnapshot);
  createWindow();

  trayController = createTrayController({
    Menu,
    Tray,
    nativeImage,
    platform: process.platform,
    showWindow: showMainWindow,
    toggleService: (isRunning) => { void toggleServiceFromTray(isRunning); },
    quit: () => app.quit(),
  });
  trayController.start(createSnapshot());

  if (preferencesStore.get().startServiceOnLaunch) {
    try {
      await service.start();
    } catch (error) {
      logger.child('electron').error('service.autostart.failed', 'The LAN service did not start automatically.', {
        error,
      });
      broadcastSnapshot();
    }
  } else {
    broadcastSnapshot();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(initialize).catch((error) => {
    console.error('DeckTap Electron initialization failed:', error);
    app.quit();
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && preferencesStore) {
    createWindow({ showOnReady: true });
    return;
  }
  showMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting || !service) return;
  event.preventDefault();
  isQuitting = true;
  void service.stop()
    .catch((error) => logger?.child('electron').error(
      'service.shutdown.failed',
      'The LAN service failed during application shutdown.',
      { error },
    ))
    .finally(() => {
      targetMonitor?.stop();
      stopMediaSuggestionScanner();
      unsubscribeService?.();
      trayController?.destroy();
      logger?.close();
      app.quit();
    });
});
