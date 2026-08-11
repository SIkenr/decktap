const { runSystemCommand } = require('./system-command');

const MACOS_WINDOW_SCRIPT = String.raw`
function run(argv) {
  const operation = String(argv[0] || '');
  const payload = JSON.parse(argv[1] || '{}');
  const systemEvents = Application('System Events');
  systemEvents.includeStandardAdditions = true;

  function safely(read, fallback) {
    try { return read(); } catch (_) { return fallback; }
  }

  function processes() {
    return safely(function () { return systemEvents.applicationProcesses(); }, []);
  }

  function processById(processId) {
    return processes().find(function (candidate) {
      return Number(safely(function () { return candidate.unixId(); }, 0)) === Number(processId);
    });
  }

  function windowsFor(process) {
    return safely(function () { return process.windows(); }, []);
  }

  function describe(process, window, index) {
    const processId = Number(safely(function () { return process.unixId(); }, 0));
    if (!processId) return null;
    return {
      id: String(processId) + ':' + String(index),
      processId: processId,
      appName: String(safely(function () { return process.name(); }, 'Unknown application')),
      bundleId: String(safely(function () { return process.bundleIdentifier(); }, '')),
      windowClass: String(safely(function () { return window.subrole(); }, '')),
      title: String(safely(function () { return window.name(); }, '')),
      platform: 'darwin'
    };
  }

  function matchingWindow(process, target) {
    const candidates = windowsFor(process);
    const title = String(target.title || '');
    if (title) {
      const titleMatch = candidates.find(function (candidate) {
        return String(safely(function () { return candidate.name(); }, '')) === title;
      });
      if (titleMatch) return titleMatch;
    }
    const parts = String(target.id || '').split(':');
    const index = Number(parts[1]);
    return Number.isInteger(index) ? candidates[index] : candidates[0];
  }

  let result;
  if (operation === 'capture') {
    const process = processes().find(function (candidate) {
      return safely(function () { return candidate.frontmost(); }, false) === true;
    });
    const window = process ? windowsFor(process)[0] : null;
    result = process && window ? describe(process, window, 0) : null;
  } else if (operation === 'list') {
    result = [];
    processes().forEach(function (process) {
      const processId = Number(safely(function () { return process.unixId(); }, 0));
      if (!processId || processId === Number(payload.excludeProcessId || 0)) return;
      windowsFor(process).forEach(function (window, index) {
        const item = describe(process, window, index);
        if (item) result.push(item);
      });
    });
  } else {
    const process = processById(payload.processId);
    const window = process ? matchingWindow(process, payload) : null;
    if (operation === 'available') {
      result = Boolean(process && window);
    } else if (operation === 'activate') {
      if (!process || !window) {
        result = false;
      } else {
        safely(function () { process.frontmost = true; }, null);
        safely(function () { window.actions.byName('AXRaise').perform(); }, null);
        delay(0.08);
        result = safely(function () { return process.frontmost(); }, false) === true;
      }
    } else if (operation === 'active') {
      result = Boolean(process && window)
        && safely(function () { return process.frontmost(); }, false) === true;
    } else {
      throw new Error('Unsupported window operation.');
    }
  }

  return JSON.stringify(result);
}
`;

function sanitizeWindow(value) {
  if (!value || typeof value !== 'object') return null;
  const processId = Number(value.processId);
  const id = String(value.id || '');
  if (!id || !Number.isSafeInteger(processId) || processId <= 0) return null;
  return Object.freeze({
    id: id.slice(0, 128),
    processId,
    appName: String(value.appName || 'Unknown application').slice(0, 160),
    bundleId: String(value.bundleId || '').slice(0, 256),
    windowClass: String(value.windowClass || '').slice(0, 160),
    title: String(value.title || '').slice(0, 512),
    platform: 'darwin',
  });
}

function createMacOSWindowAdapter(options = {}) {
  const run = options.run || ((operation, target = {}) => runSystemCommand(
    options.executable || '/usr/bin/osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      MACOS_WINDOW_SCRIPT,
      operation,
      JSON.stringify({
        ...target,
        excludeProcessId: options.excludeProcessId || process.pid,
      }),
    ],
    options,
  ));

  return {
    async captureActiveWindow() {
      return sanitizeWindow(await run('capture'));
    },
    async listWindows() {
      const result = await run('list');
      return (Array.isArray(result) ? result : [result]).map(sanitizeWindow).filter(Boolean);
    },
    async isWindowAvailable(target) {
      return (await run('available', target)) === true;
    },
    async activateWindow(target) {
      return (await run('activate', target)) === true;
    },
    async isWindowActive(target) {
      return (await run('active', target)) === true;
    },
  };
}

module.exports = { MACOS_WINDOW_SCRIPT, createMacOSWindowAdapter, sanitizeWindow };
