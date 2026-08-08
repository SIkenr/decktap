const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createLoginItemController, getWindowsLauncherPath } = require('../client/login-item');

test('Windows login items use the stable Squirrel launcher path for reads and writes', () => {
  const calls = [];
  const execPath = path.join('C:', 'Users', 'Rico', 'AppData', 'Local', 'DeckTap', 'app-1.0.0', 'decktap.exe');
  const expectedPath = path.resolve(path.dirname(execPath), '..', 'decktap.exe');
  const app = {
    isPackaged: true,
    getLoginItemSettings: (options) => {
      calls.push(['get', options]);
      return { openAtLogin: true };
    },
    setLoginItemSettings: (options) => calls.push(['set', options]),
  };
  const controller = createLoginItemController({ app, platform: 'win32', execPath });

  assert.equal(getWindowsLauncherPath(execPath), expectedPath);
  assert.equal(controller.isSupported(), true);
  assert.equal(controller.getEnabled(), true);
  controller.setEnabled(false);
  assert.deepEqual(calls, [
    ['get', { path: expectedPath, args: [] }],
    ['set', { path: expectedPath, args: [], openAtLogin: false }],
  ]);
});

test('macOS uses the main app login service defaults', () => {
  const calls = [];
  const app = {
    isPackaged: true,
    getLoginItemSettings: (options) => {
      calls.push(['get', options]);
      return { openAtLogin: false };
    },
    setLoginItemSettings: (options) => calls.push(['set', options]),
  };
  const controller = createLoginItemController({ app, platform: 'darwin' });

  assert.equal(controller.getEnabled(), false);
  controller.setEnabled(true);
  assert.deepEqual(calls, [
    ['get', {}],
    ['set', { openAtLogin: true }],
  ]);
});

test('login items remain unavailable in development and on unsupported platforms', () => {
  for (const [isPackaged, platform] of [[false, 'win32'], [true, 'linux']]) {
    const controller = createLoginItemController({ app: { isPackaged }, platform });
    assert.equal(controller.isSupported(), false);
    assert.equal(controller.getEnabled(), false);
    assert.throws(() => controller.setEnabled(true), /packaged Windows and macOS/);
  }
});
