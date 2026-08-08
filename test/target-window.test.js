const assert = require('node:assert/strict');
const test = require('node:test');

const { TargetWindowError, createTargetWindowController } = require('../client/target-window');

test('target window controller captures, activates, waits, and clears a target', async () => {
  const calls = [];
  const capturedWindow = { id: 'window-42', processId: 42, title: 'Presentation' };
  const controller = createTargetWindowController({
    focusDelayMs: 75,
    wait: async (milliseconds) => calls.push(['wait', milliseconds]),
    adapter: {
      async captureActiveWindow() {
        calls.push(['capture']);
        return capturedWindow;
      },
      async isWindowAvailable(target) {
        calls.push(['available', target.id]);
        return true;
      },
      async activateWindow(target) {
        calls.push(['activate', target.id]);
        return true;
      },
    },
  });

  const target = await controller.captureCurrent();
  assert.equal(controller.isLocked(), true);
  assert.equal(controller.getStatus(), 'locked');
  assert.notEqual(target, capturedWindow);
  assert.equal(Object.isFrozen(target), true);

  const result = await controller.ensureFocused();
  assert.equal(result.status, 'focused');
  assert.deepEqual(calls, [
    ['capture'],
    ['available', 'window-42'],
    ['activate', 'window-42'],
    ['wait', 75],
  ]);

  controller.clear();
  assert.equal(controller.isLocked(), false);
  assert.equal(controller.getStatus(), 'unconfigured');
  assert.deepEqual(await controller.ensureFocused(), { status: 'unlocked', target: null });
});

test('target window controller locks a selected available candidate', async () => {
  const candidate = { id: 'selected-window', processId: 77, appName: 'Keynote' };
  const controller = createTargetWindowController({
    adapter: {
      async captureActiveWindow() { return null; },
      async isWindowAvailable(target) { return target.id === candidate.id; },
      async activateWindow() { return true; },
    },
  });

  assert.deepEqual(await controller.lock(candidate), candidate);
  assert.equal(controller.getStatus(), 'locked');
  assert.deepEqual(controller.getTarget(), candidate);
});

test('target window controller rejects a missing captured window', async () => {
  const controller = createTargetWindowController({
    adapter: {
      async captureActiveWindow() {
        return null;
      },
      async activateWindow() {
        return true;
      },
    },
  });

  await assert.rejects(
    () => controller.captureCurrent(),
    (error) => error instanceof TargetWindowError && error.code === 'TARGET_CAPTURE_FAILED',
  );
});

test('failed recapture preserves the last confirmed target', async () => {
  let captured = { id: 'window-previous', processId: 23 };
  const controller = createTargetWindowController({
    adapter: {
      async captureActiveWindow() {
        return captured;
      },
      async activateWindow() {
        return true;
      },
    },
  });

  await controller.captureCurrent();
  captured = null;
  await assert.rejects(() => controller.captureCurrent(), /could be captured/);
  assert.equal(controller.getStatus(), 'locked');
  assert.equal(controller.getTarget().id, 'window-previous');
});

test('target window controller rejects closed and un-focusable targets', async () => {
  let available = false;
  let activated = true;
  const controller = createTargetWindowController({
    focusDelayMs: 0,
    adapter: {
      async captureActiveWindow() {
        return { id: 'window-7', processId: 7 };
      },
      async isWindowAvailable() {
        return available;
      },
      async activateWindow() {
        return activated;
      },
    },
  });

  await controller.captureCurrent();
  await assert.rejects(
    () => controller.ensureFocused(),
    (error) => error.code === 'TARGET_NOT_AVAILABLE',
  );
  assert.equal(controller.getStatus(), 'lost');

  available = true;
  activated = false;
  await assert.rejects(
    () => controller.ensureFocused(),
    (error) => error.code === 'TARGET_FOCUS_FAILED',
  );
});

test('target window controller verifies focus before allowing a key command', async () => {
  let active = false;
  const statuses = [];
  const controller = createTargetWindowController({
    focusDelayMs: 0,
    onStatusChanged(status) {
      statuses.push(status);
    },
    adapter: {
      async captureActiveWindow() {
        return { id: 'window-9', processId: 9 };
      },
      async activateWindow() {
        return true;
      },
      async isWindowActive() {
        return active;
      },
    },
  });

  await controller.captureCurrent();
  await assert.rejects(
    () => controller.ensureFocused(),
    (error) => error.code === 'TARGET_FOCUS_FAILED',
  );
  assert.equal(controller.getStatus(), 'lost');

  active = true;
  await controller.ensureFocused();
  assert.equal(controller.getStatus(), 'locked');
  assert.deepEqual(statuses, ['locked', 'lost', 'locked']);
});
