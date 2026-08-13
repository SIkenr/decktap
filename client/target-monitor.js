function createTargetMonitor(options = {}) {
  const mediaTargetService = options.mediaTargetService;
  const targetWindowController = options.targetWindowController;
  const getRuleId = options.getRuleId || (() => null);
  const canMonitor = options.canMonitor || (() => true);
  const intervalMs = options.intervalMs ?? 1500;
  const onRebound = options.onRebound || (() => {});
  const onUnresolved = options.onUnresolved || (() => {});
  const onWaiting = options.onWaiting || (() => {});
  const onError = options.onError || (() => {});
  const schedule = options.setInterval || setInterval;
  const cancel = options.clearInterval || clearInterval;

  if (!mediaTargetService || typeof mediaTargetService.rebindRule !== 'function') {
    throw new TypeError('A media target service with rebindRule is required');
  }
  if (!targetWindowController
    || typeof targetWindowController.arm !== 'function'
    || typeof targetWindowController.checkAvailability !== 'function') {
    throw new TypeError('A monitorable target window controller is required');
  }

  let timer = null;
  let polling = false;
  let lastOutcome = null;

  async function poll() {
    if (polling) return Object.freeze({ outcome: 'busy' });
    const ruleId = getRuleId();
    if (!ruleId || !canMonitor()) {
      lastOutcome = null;
      return Object.freeze({ outcome: 'idle' });
    }

    polling = true;
    try {
      const target = targetWindowController.getTarget();
      if (target && targetWindowController.getStatus() === 'locked'
        && await targetWindowController.checkAvailability()) {
        lastOutcome = 'locked';
        return Object.freeze({ outcome: 'locked', ruleId, target });
      }

      targetWindowController.arm();
      const result = await mediaTargetService.rebindRule(ruleId, {
        shouldLock: () => getRuleId() === ruleId,
      });
      if (result.outcome === 'locked') {
        lastOutcome = 'locked';
        onRebound(result);
      } else {
        onUnresolved(result);
        if (result.outcome !== lastOutcome) {
          lastOutcome = result.outcome;
          onWaiting(result);
        }
      }
      return result;
    } catch (error) {
      targetWindowController.arm();
      if (lastOutcome !== 'error') onError(error, getRuleId());
      lastOutcome = 'error';
      return Object.freeze({ outcome: 'error' });
    } finally {
      polling = false;
    }
  }

  function start() {
    if (timer) return;
    timer = schedule(() => { void poll(); }, intervalMs);
    if (typeof timer?.unref === 'function') timer.unref();
    void poll();
  }

  function stop() {
    if (!timer) return;
    cancel(timer);
    timer = null;
  }

  return {
    isRunning: () => timer !== null,
    poll,
    start,
    stop,
  };
}

module.exports = { createTargetMonitor };
