const assert = require('node:assert/strict');
const test = require('node:test');

const { createTargetMonitor } = require('../client/target-monitor');

test('target monitor waits safely and rebinds when one playback window appears', async () => {
  let target = { id: 'closed-show', processId: 7 };
  let status = 'locked';
  let available = false;
  let rebound = false;
  let result = { outcome: 'not-running', ruleId: 'powerpoint' };
  const targetWindowController = {
    arm() { target = null; status = 'waiting'; },
    async checkAvailability() { return available; },
    getStatus: () => status,
    getTarget: () => target,
  };
  const monitor = createTargetMonitor({
    mediaTargetService: { async rebindRule() { return result; } },
    targetWindowController,
    getRuleId: () => 'powerpoint',
    onRebound() { rebound = true; },
  });

  assert.equal((await monitor.poll()).outcome, 'not-running');
  assert.equal(status, 'waiting');
  result = { outcome: 'locked', ruleId: 'powerpoint', target: { id: 'new-show', processId: 8 } };
  assert.equal((await monitor.poll()).outcome, 'locked');
  assert.equal(rebound, true);
});

test('target monitor does not enumerate while the locked target remains available', async () => {
  let rebindCalls = 0;
  const target = { id: 'live-show', processId: 7 };
  const monitor = createTargetMonitor({
    mediaTargetService: { async rebindRule() { rebindCalls += 1; } },
    targetWindowController: {
      arm() {},
      async checkAvailability() { return true; },
      getStatus: () => 'locked',
      getTarget: () => target,
    },
    getRuleId: () => 'powerpoint',
  });

  const result = await monitor.poll();
  assert.equal(result.outcome, 'locked');
  assert.equal(result.target, target);
  assert.equal(rebindCalls, 0);
});

test('target monitor reports unresolved rebinding attempts on every poll', async () => {
  let unresolvedCalls = 0;
  const monitor = createTargetMonitor({
    mediaTargetService: { async rebindRule() { return { outcome: 'not-running', ruleId: 'keynote' }; } },
    targetWindowController: {
      arm() {},
      async checkAvailability() { return false; },
      getStatus: () => 'waiting',
      getTarget: () => null,
    },
    getRuleId: () => 'keynote',
    onUnresolved() { unresolvedCalls += 1; },
  });

  assert.equal((await monitor.poll()).outcome, 'not-running');
  assert.equal((await monitor.poll()).outcome, 'not-running');
  assert.equal(unresolvedCalls, 2);
});
