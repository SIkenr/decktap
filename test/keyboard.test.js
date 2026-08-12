const assert = require('node:assert/strict');
const test = require('node:test');

const {
  KeyboardControlError,
  createKeyboardController,
  createRobotJsKeyboardAdapter,
} = require('../client/keyboard');

test('keyboard controller uses up and down keys by default', async () => {
  const calls = [];
  const keyboard = {
    async pressKey(key) {
      calls.push(['press', key]);
    },
    async releaseKey(key) {
      calls.push(['release', key]);
    },
  };

  const controller = createKeyboardController({ keyboard });
  await controller.execute('next');
  await controller.execute('prev');

  assert.deepEqual(calls, [
    ['press', 'down'],
    ['release', 'down'],
    ['press', 'up'],
    ['release', 'up'],
  ]);
});

test('keyboard controller supports the optional left and right page-turn mode', async () => {
  const calls = [];
  const keyboard = {
    async pressKey(key) {
      calls.push(['press', key]);
    },
    async releaseKey(key) {
      calls.push(['release', key]);
    },
  };

  const controller = createKeyboardController({ keyboard });
  await controller.execute('next-horizontal');
  await controller.execute('prev-horizontal');

  assert.deepEqual(calls, [
    ['press', 'right'],
    ['release', 'right'],
    ['press', 'left'],
    ['release', 'left'],
  ]);
});

test('keyboard controller rejects unsupported commands before loading native code', async () => {
  const controller = createKeyboardController();

  await assert.rejects(() => controller.execute('launch'), /Unsupported presentation command/);
});

test('keyboard controller releases a key and surfaces release failures', async () => {
  const keyboard = {
    async pressKey() {},
    async releaseKey() {
      throw new Error('release failed');
    },
  };

  const controller = createKeyboardController({ keyboard });
  await assert.rejects(() => controller.execute('next'), /release failed/);
});

test('keyboard controller focuses a locked target before sending a key', async () => {
  const calls = [];
  const controller = createKeyboardController({
    targetWindowController: {
      async ensureFocused() {
        calls.push('focus');
      },
    },
    keyboard: {
      async pressKey() {
        calls.push('press');
      },
      async releaseKey() {
        calls.push('release');
      },
    },
  });

  await controller.execute('next');
  assert.deepEqual(calls, ['focus', 'press', 'release']);
});

test('keyboard controller waits after focus restoration before sending a key', async () => {
  const calls = [];
  const controller = createKeyboardController({
    focusSettleDelayMs: 220,
    wait: async (milliseconds) => calls.push(['wait', milliseconds]),
    targetWindowController: {
      async ensureFocused() {
        calls.push(['focus']);
        return { status: 'focused', focusChanged: true };
      },
    },
    keyboard: {
      async pressKey() {
        calls.push(['press']);
      },
      async releaseKey() {
        calls.push(['release']);
      },
    },
  });

  await controller.execute('next');
  assert.deepEqual(calls, [['focus'], ['wait', 220], ['press'], ['release']]);
});

test('keyboard controller does not add a settle delay when the target already had focus', async () => {
  const calls = [];
  const controller = createKeyboardController({
    focusSettleDelayMs: 220,
    wait: async (milliseconds) => calls.push(['wait', milliseconds]),
    targetWindowController: {
      async ensureFocused() {
        calls.push(['focus']);
        return { status: 'focused', focusChanged: false };
      },
    },
    keyboard: {
      async pressKey() {
        calls.push(['press']);
      },
      async releaseKey() {
        calls.push(['release']);
      },
    },
  });

  await controller.execute('next');
  assert.deepEqual(calls, [['focus'], ['press'], ['release']]);
});

test('keyboard controller does not send a key when target focus fails', async () => {
  let keyWasPressed = false;
  const controller = createKeyboardController({
    targetWindowController: {
      async ensureFocused() {
        throw new Error('target closed');
      },
    },
    keyboard: {
      async pressKey() {
        keyWasPressed = true;
      },
      async releaseKey() {},
    },
  });

  await assert.rejects(() => controller.execute('next'), /target closed/);
  assert.equal(keyWasPressed, false);
});

test('RobotJS adapter maps press and release to keyToggle', async () => {
  const calls = [];
  const keyboard = createRobotJsKeyboardAdapter({
    keyToggle(key, state) {
      calls.push([key, state]);
    },
  });

  await keyboard.pressKey('right');
  await keyboard.releaseKey('right');

  assert.deepEqual(calls, [
    ['right', 'down'],
    ['right', 'up'],
  ]);
});

test('RobotJS adapter rejects an invalid native module', () => {
  assert.throws(() => createRobotJsKeyboardAdapter({}), /keyToggle is required/);
});

test('keyboard controller reports a stable code when native automation is unavailable', async () => {
  const controller = createKeyboardController({
    requireRobotJs() { throw new Error('native module unavailable'); },
  });
  await assert.rejects(
    () => controller.execute('next'),
    (error) => error instanceof KeyboardControlError && error.code === 'KEYBOARD_UNAVAILABLE',
  );
});
