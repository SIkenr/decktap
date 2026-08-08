class TargetWindowError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'TargetWindowError';
    this.code = code;
  }
}

function createTargetWindowController(options = {}) {
  const adapter = options.adapter;
  const focusDelayMs = options.focusDelayMs ?? 100;
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const onStatusChanged = options.onStatusChanged || (() => {});

  if (!adapter || typeof adapter.captureActiveWindow !== 'function' || typeof adapter.activateWindow !== 'function') {
    throw new TypeError('A target window adapter with captureActiveWindow and activateWindow is required');
  }

  let target = null;
  let status = 'unconfigured';

  function validateTarget(candidate) {
    if (!candidate || typeof candidate !== 'object' || !candidate.id || !candidate.processId) {
      throw new TargetWindowError('TARGET_INVALID', 'The selected target window is invalid.');
    }
    return Object.freeze({ ...candidate });
  }

  function setStatus(nextStatus) {
    if (status === nextStatus) return;
    status = nextStatus;
    onStatusChanged(status, target);
  }

  async function captureCurrent() {
    const captured = await adapter.captureActiveWindow();
    if (!captured) {
      if (!target) setStatus('unconfigured');
      throw new TargetWindowError('TARGET_CAPTURE_FAILED', 'No active presentation or media window could be captured.');
    }

    target = validateTarget(captured);
    setStatus('locked');
    return target;
  }

  async function lock(candidate) {
    const nextTarget = validateTarget(candidate);
    if (typeof adapter.isWindowAvailable === 'function'
      && !(await adapter.isWindowAvailable(nextTarget))) {
      throw new TargetWindowError('TARGET_NOT_AVAILABLE', 'The selected target window is no longer available.');
    }
    target = nextTarget;
    setStatus('locked');
    return target;
  }

  function arm() {
    target = null;
    setStatus('waiting');
  }

  async function checkAvailability() {
    if (!target) return false;
    if (typeof adapter.isWindowAvailable !== 'function') return true;
    let available = false;
    try {
      available = await adapter.isWindowAvailable(target);
    } catch {
      available = false;
    }
    if (!available) setStatus('lost');
    return available;
  }

  function fail(code, message, options) {
    setStatus('lost');
    throw new TargetWindowError(code, message, options);
  }

  async function ensureFocused() {
    if (!target) {
      if (status === 'waiting' || status === 'lost') {
        fail(
          'TARGET_NOT_AVAILABLE',
          'The selected presentation application is waiting for a playback window.',
        );
      }
      return { status: 'unlocked', target: null };
    }

    if (typeof adapter.isWindowAvailable === 'function') {
      const available = await adapter.isWindowAvailable(target);
      if (!available) {
        fail(
          'TARGET_NOT_AVAILABLE',
          'The selected presentation or media window is no longer available.',
        );
      }
    }

    let activated;
    try {
      activated = await adapter.activateWindow(target);
    } catch (error) {
      fail(
        'TARGET_FOCUS_FAILED',
        'The selected presentation or media window could not be focused.',
        { cause: error },
      );
    }

    if (activated === false) {
      fail(
        'TARGET_FOCUS_FAILED',
        'The selected presentation or media window could not be focused.',
      );
    }

    if (focusDelayMs > 0) {
      await wait(focusDelayMs);
    }

    if (typeof adapter.isWindowActive === 'function') {
      let active;
      try {
        active = await adapter.isWindowActive(target);
      } catch (error) {
        fail(
          'TARGET_FOCUS_FAILED',
          'The selected presentation or media window focus could not be verified.',
          { cause: error },
        );
      }
      if (!active) {
        fail(
          'TARGET_FOCUS_FAILED',
          'The selected presentation or media window did not become active.',
        );
      }
    }

    setStatus('locked');
    return { status: 'focused', target };
  }

  return {
    arm,
    captureCurrent,
    checkAvailability,
    clear: () => {
      target = null;
      setStatus('unconfigured');
    },
    ensureFocused,
    getStatus: () => status,
    getTarget: () => target,
    isLocked: () => target !== null,
    lock,
  };
}

module.exports = { TargetWindowError, createTargetWindowController };
