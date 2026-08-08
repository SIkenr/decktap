const assert = require('node:assert/strict');
const test = require('node:test');

const { createTrayController } = require('../client/tray-controller');

function createHarness(platform = 'win32') {
  const calls = [];
  let latestTray;
  class FakeTray {
    constructor(icon) {
      this.icon = icon;
      this.handlers = new Map();
      latestTray = this;
      calls.push(['create']);
    }
    destroy() { calls.push(['destroy']); }
    on(event, callback) { this.handlers.set(event, callback); }
    setContextMenu(menu) { this.menu = menu; }
    setToolTip(value) { this.tooltip = value; }
  }
  const icon = {
    isEmpty: () => false,
    setTemplateImage(value) { calls.push(['template', value]); },
  };
  const callbacks = { show: 0, toggle: [], quit: 0 };
  const controller = createTrayController({
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromDataURL: () => icon },
    platform,
    showWindow: () => { callbacks.show += 1; },
    toggleService: (running) => callbacks.toggle.push(running),
    quit: () => { callbacks.quit += 1; },
  });
  return { callbacks, calls, controller, getTray: () => latestTray };
}

const runningSnapshot = {
  connectedClients: 2,
  serviceState: 'running',
  target: { appName: 'PowerPoint', status: 'locked' },
};

test('tray presents service, device, target, show, toggle, and quit actions', () => {
  const harness = createHarness();
  harness.controller.start(runningSnapshot);
  const tray = harness.getTray();

  assert.match(tray.tooltip, /2 台设备/);
  assert.deepEqual(tray.menu.map(({ label, type }) => label || type), [
    '打开 DeckTap',
    'separator',
    '局域网服务运行中',
    '停止控制服务',
    '已连接设备：2 台',
    '控制目标：PowerPoint',
    'separator',
    '退出 DeckTap',
  ]);
  tray.handlers.get('click')();
  tray.menu[3].click();
  tray.menu[7].click();
  assert.deepEqual(harness.callbacks, { show: 1, toggle: [true], quit: 1 });
});

test('tray refuses to start with an undecodable embedded icon', () => {
  const controller = createTrayController({
    Tray: class {},
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromDataURL: () => ({ isEmpty: () => true }) },
  });

  assert.throws(() => controller.start(runningSnapshot), /could not be decoded/);
  assert.equal(controller.isStarted(), false);
});

test('tray refreshes in place, handles lost targets, and destroys idempotently', () => {
  const harness = createHarness('darwin');
  harness.controller.start(runningSnapshot);
  harness.controller.start({
    connectedClients: 0,
    serviceState: 'stopped',
    target: { appName: 'PowerPoint', status: 'lost' },
  });
  const tray = harness.getTray();

  assert.equal(harness.calls.filter(([name]) => name === 'create').length, 1);
  assert.deepEqual(harness.calls.find(([name]) => name === 'template'), ['template', true]);
  assert.equal(tray.menu[3].label, '启动控制服务');
  assert.equal(tray.menu[5].label, '控制目标：已丢失');
  tray.menu[3].click();
  assert.deepEqual(harness.callbacks.toggle, [false]);

  harness.controller.destroy();
  harness.controller.destroy();
  assert.equal(harness.calls.filter(([name]) => name === 'destroy').length, 1);
  assert.equal(harness.controller.isStarted(), false);
});
