const path = require('node:path');

const LOGIN_ITEM_PLATFORMS = new Set(['darwin', 'win32']);

function getWindowsLauncherPath(execPath) {
  if (typeof execPath !== 'string' || !execPath) {
    throw new TypeError('A packaged executable path is required');
  }
  const appFolder = path.dirname(execPath);
  return path.resolve(appFolder, '..', path.basename(execPath));
}

function createLoginItemController(options = {}) {
  const app = options.app;
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const supported = Boolean(app?.isPackaged && LOGIN_ITEM_PLATFORMS.has(platform));

  function queryOptions() {
    return platform === 'win32' ? { path: getWindowsLauncherPath(execPath), args: [] } : {};
  }

  return {
    isSupported: () => supported,
    getEnabled: () => supported && Boolean(app.getLoginItemSettings(queryOptions()).openAtLogin),
    setEnabled: (enabled) => {
      if (typeof enabled !== 'boolean') throw new TypeError('Launch-at-login setting must be a boolean');
      if (!supported) {
        throw new Error('Launch at login is available only in packaged Windows and macOS clients.');
      }
      app.setLoginItemSettings({
        ...queryOptions(),
        openAtLogin: enabled,
      });
      return enabled;
    },
  };
}

module.exports = {
  LOGIN_ITEM_PLATFORMS,
  createLoginItemController,
  getWindowsLauncherPath,
};
