const { createMacOSWindowAdapter } = require('./macos-window-adapter');
const { createWindowsWindowAdapter } = require('./windows-window-adapter');

function createUnsupportedWindowAdapter(platform) {
  return {
    platform,
    async captureActiveWindow() {
      return null;
    },
    async listWindows() {
      return [];
    },
    async isWindowAvailable() {
      return false;
    },
    async activateWindow() {
      return false;
    },
    async isWindowActive() {
      return false;
    },
  };
}

function createPlatformWindowAdapter(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'win32') return createWindowsWindowAdapter(options);
  if (platform === 'darwin') return createMacOSWindowAdapter(options);
  return createUnsupportedWindowAdapter(platform);
}

module.exports = { createPlatformWindowAdapter, createUnsupportedWindowAdapter };
