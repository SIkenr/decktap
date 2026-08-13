const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PREFERENCES = Object.freeze({
  closeToTray: true,
  customApps: Object.freeze([]),
  lastLockedAppId: null,
  launchAtLogin: false,
  pageTurnMode: 'vertical',
  startServiceOnLaunch: true,
  themeSource: 'system',
  welcomeCompleted: false,
});

const PAGE_TURN_MODES = new Set(['vertical', 'horizontal']);
const THEME_SOURCES = new Set(['system', 'light', 'dark']);

function sanitizeCustomApp(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = String(candidate.id || '').trim().slice(0, 80);
  const displayName = String(candidate.displayName || '').trim().slice(0, 80);
  const platform = candidate.platform;
  const appName = String(candidate.appName || '').trim().slice(0, 160);
  const bundleId = String(candidate.bundleId || '').trim().slice(0, 256);
  if (!id || !displayName || !appName || !['win32', 'darwin'].includes(platform)) return null;
  if (platform === 'darwin' && !bundleId) return null;
  return { id, displayName, platform, appName, bundleId };
}

function sanitizeCustomApps(candidate) {
  if (!Array.isArray(candidate)) return [];
  const unique = new Map();
  for (const value of candidate.slice(0, 32)) {
    const app = sanitizeCustomApp(value);
    if (app) unique.set(app.id, app);
  }
  return [...unique.values()];
}

function sanitizePreferences(candidate = {}) {
  const lastLockedAppId = typeof candidate.lastLockedAppId === 'string'
    ? candidate.lastLockedAppId.trim().slice(0, 80) || null
    : null;
  return {
    closeToTray: candidate.closeToTray !== false,
    customApps: sanitizeCustomApps(candidate.customApps),
    launchAtLogin: candidate.launchAtLogin === true,
    lastLockedAppId,
    pageTurnMode: PAGE_TURN_MODES.has(candidate.pageTurnMode)
      ? candidate.pageTurnMode
      : DEFAULT_PREFERENCES.pageTurnMode,
    startServiceOnLaunch: candidate.startServiceOnLaunch !== false,
    themeSource: THEME_SOURCES.has(candidate.themeSource)
      ? candidate.themeSource
      : DEFAULT_PREFERENCES.themeSource,
    welcomeCompleted: candidate.welcomeCompleted === true,
  };
}

function createPreferencesStore(options = {}) {
  const filePath = options.filePath;
  const fileSystem = options.fileSystem || fs;
  let preferences = { ...DEFAULT_PREFERENCES };

  if (!filePath) {
    throw new TypeError('A preferences file path is required');
  }

  try {
    const stored = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    preferences = sanitizePreferences(stored);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
  }

  function save() {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fileSystem.writeFileSync(filePath, `${JSON.stringify(preferences, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  function update(patch) {
    const next = sanitizePreferences({ ...preferences, ...patch });

    if (patch.themeSource !== undefined && !THEME_SOURCES.has(patch.themeSource)) {
      throw new TypeError(`Unsupported theme source: ${patch.themeSource}`);
    }
    if (patch.pageTurnMode !== undefined && !PAGE_TURN_MODES.has(patch.pageTurnMode)) {
      throw new TypeError(`Unsupported page-turn mode: ${patch.pageTurnMode}`);
    }
    if (patch.customApps !== undefined && !Array.isArray(patch.customApps)) {
      throw new TypeError('Custom applications must be an array');
    }
    for (const key of ['closeToTray', 'launchAtLogin', 'startServiceOnLaunch', 'welcomeCompleted']) {
      if (patch[key] !== undefined && typeof patch[key] !== 'boolean') {
        throw new TypeError(`Unsupported boolean preference: ${key}`);
      }
    }

    preferences = next;
    save();
    return { ...preferences };
  }

  return {
    get: () => ({ ...preferences }),
    addCustomApp: (customApp) => {
      const next = sanitizeCustomApp(customApp);
      if (!next) throw new TypeError('Invalid custom application');
      const customApps = preferences.customApps.filter(({ id }) => id !== next.id);
      return update({ customApps: [...customApps, next] });
    },
    removeCustomApp: (id) => update({
      customApps: preferences.customApps.filter((customApp) => customApp.id !== id),
      lastLockedAppId: preferences.lastLockedAppId === id ? null : preferences.lastLockedAppId,
    }),
    setCloseToTray: (closeToTray) => update({ closeToTray }),
    setLaunchAtLogin: (launchAtLogin) => update({ launchAtLogin }),
    setLastLockedAppId: (lastLockedAppId) => {
      if (lastLockedAppId !== null && (typeof lastLockedAppId !== 'string' || !lastLockedAppId.trim())) {
        throw new TypeError('Last locked application identifier must be a non-empty string or null');
      }
      return update({ lastLockedAppId });
    },
    setPageTurnMode: (pageTurnMode) => update({ pageTurnMode }),
    setStartServiceOnLaunch: (startServiceOnLaunch) => update({ startServiceOnLaunch }),
    setThemeSource: (themeSource) => update({ themeSource }),
    setWelcomeCompleted: (welcomeCompleted) => update({ welcomeCompleted }),
  };
}

module.exports = {
  DEFAULT_PREFERENCES,
  PAGE_TURN_MODES,
  THEME_SOURCES,
  createPreferencesStore,
  sanitizeCustomApp,
  sanitizeCustomApps,
  sanitizePreferences,
};
