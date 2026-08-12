const path = require('node:path');
const { execFile: defaultExecFile } = require('node:child_process');
const { runSystemCommand } = require('./system-command');
const { isWhitelistedProcess } = require('./process-whitelist');

const MACOS_WINDOW_SCRIPT = String.raw`
function run(argv) {
  const operation = String(argv[0] || '');
  const payload = JSON.parse(argv[1] || '{}');
  ObjC.import('AppKit');
  const systemEvents = Application('System Events');
  systemEvents.includeStandardAdditions = true;

  function safely(read, fallback) {
    try { return read(); } catch (_) { return fallback; }
  }

  function unwrap(value, fallback) {
    try {
      const unwrapped = ObjC.unwrap(value);
      return unwrapped == null ? fallback : unwrapped;
    } catch (_) {
      return fallback;
    }
  }

  function processes() {
    return safely(function () { return systemEvents.applicationProcesses(); }, []);
  }

  function workspaceApplications() {
    return safely(function () { return $.NSWorkspace.sharedWorkspace.runningApplications.js; }, []);
  }

  function processById(processId) {
    return processes().find(function (candidate) {
      return Number(safely(function () { return candidate.unixId(); }, 0)) === Number(processId);
    });
  }

  function workspaceApplicationById(processId) {
    return workspaceApplications().find(function (candidate) {
      return Number(safely(function () { return candidate.processIdentifier; }, 0)) === Number(processId);
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

  function describeWorkspaceApplication(application) {
    const processId = Number(safely(function () { return application.processIdentifier; }, 0));
    if (!processId) return null;
    return {
      id: String(processId) + ':app',
      processId: processId,
      appName: String(unwrap(safely(function () { return application.localizedName; }, null), 'Unknown application')),
      bundleId: String(unwrap(safely(function () { return application.bundleIdentifier; }, null), '')),
      windowClass: 'NSRunningApplication',
      title: '',
      platform: 'darwin'
    };
  }

  function isRegularWorkspaceApplication(application) {
    return Number(safely(function () { return application.activationPolicy; }, -1)) === 0;
  }

  function describeProcess(process) {
    const processId = Number(safely(function () { return process.unixId(); }, 0));
    if (!processId) return null;
    return {
      id: String(processId) + ':process',
      processId: processId,
      appName: String(safely(function () { return process.name(); }, 'Unknown application')),
      bundleId: String(safely(function () { return process.bundleIdentifier(); }, '')),
      windowClass: 'AXApplication',
      title: '',
      platform: 'darwin'
    };
  }

  function matchingWindow(process, target) {
    if (String(target.id || '').endsWith(':process') || String(target.id || '').endsWith(':app')) return null;
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

  function unminimizeWindow(window) {
    if (!window) return;
    safely(function () { window.attributes.byName('AXMinimized').value = false; }, null);
    safely(function () { window.miniaturized = false; }, null);
  }

  function unminimizeProcessWindows(process) {
    windowsFor(process).forEach(function (candidate) {
      unminimizeWindow(candidate);
    });
  }

  function activateApplication(process, workspaceApp, appName) {
    if (appName) safely(function () { Application(String(appName)).activate(); }, null);
    if (process) {
      safely(function () { process.visible = true; }, null);
      safely(function () { process.frontmost = true; }, null);
    }
    if (workspaceApp) safely(function () { workspaceApp.activateWithOptions(3); }, null);
  }

  let result;
  if (operation === 'capture') {
    const process = processes().find(function (candidate) {
      return safely(function () { return candidate.frontmost(); }, false) === true;
    });
    const window = process ? windowsFor(process)[0] : null;
    const workspaceApp = process ? workspaceApplicationById(safely(function () { return process.unixId(); }, 0)) : null;
    result = process && window
      ? describe(process, window, 0)
      : process ? describeProcess(process)
        : workspaceApp ? describeWorkspaceApplication(workspaceApp)
          : null;
  } else if (operation === 'list') {
    result = [];
    const seenProcessIds = {};
    processes().forEach(function (process) {
      const processId = Number(safely(function () { return process.unixId(); }, 0));
      if (!processId || processId === Number(payload.excludeProcessId || 0)) return;
      seenProcessIds[String(processId)] = true;
      const windows = windowsFor(process);
      windows.forEach(function (window, index) {
        const item = describe(process, window, index);
        if (item) result.push(item);
      });
      if (windows.length === 0
        && safely(function () { return process.visible(); }, false) === true
        && safely(function () { return process.backgroundOnly(); }, true) !== true) {
        const item = describeProcess(process);
        if (item) result.push(item);
      }
    });
    workspaceApplications().forEach(function (application) {
      const processId = Number(safely(function () { return application.processIdentifier; }, 0));
      if (!processId
        || processId === Number(payload.excludeProcessId || 0)
        || seenProcessIds[String(processId)]
        || !isRegularWorkspaceApplication(application)) return;
      const item = describeWorkspaceApplication(application);
      if (item) result.push(item);
    });
  } else {
    const process = processById(payload.processId);
    const workspaceApp = workspaceApplicationById(payload.processId);
    const window = process ? matchingWindow(process, payload) : null;
    const isProcessTarget = String(payload.id || '').endsWith(':process') || String(payload.id || '').endsWith(':app');
    if (operation === 'available') {
      result = Boolean(process || workspaceApp);
    } else if (operation === 'activate') {
      if (!process && !workspaceApp) {
        if (isProcessTarget && payload.appName) {
          activateApplication(process, workspaceApp, payload.appName);
          delay(0.08);
          result = true;
        } else {
          result = false;
        }
      } else {
        unminimizeProcessWindows(process);
        unminimizeWindow(window);
        activateApplication(process, workspaceApp, payload.appName);
        if (window) {
          safely(function () { window.actions.byName('AXRaise').perform(); }, null);
          unminimizeWindow(window);
        }
        delay(0.12);
        unminimizeProcessWindows(process);
        activateApplication(process, workspaceApp, payload.appName);
        if (window) safely(function () { window.actions.byName('AXRaise').perform(); }, null);
        result = true;
      }
    } else if (operation === 'active') {
      result = Boolean(process || workspaceApp)
          && ((process && safely(function () { return process.frontmost(); }, false) === true)
            || (workspaceApp && safely(function () { return workspaceApp.active; }, false) === true));
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

function normalizeProcessName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function displayNameFromCommand(command) {
  const executable = path.basename(String(command || '').trim());
  return executable.replace(/ Helper( \(.*\))?$/i, '').trim();
}

function parseMacOSProcessList(stdout) {
  const seen = new Set();
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
      if (!match) return null;
      const processId = Number(match[1]);
      const appName = displayNameFromCommand(match[2]);
      const normalized = normalizeProcessName(appName);
      if (!Number.isSafeInteger(processId)
      || processId <= 0
      || seen.has(processId)
      || !isWhitelistedProcess(normalized, 'darwin')) return null;
      seen.add(processId);
      return Object.freeze({
        id: `${processId}:ps`,
        processId,
        appName,
        bundleId: '',
        windowClass: 'BSDProcess',
        title: '',
        platform: 'darwin',
      });
    })
    .filter(Boolean);
}

function listFallbackProcesses(options = {}) {
  const execFile = options.execFile || defaultExecFile;
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-axo', 'pid=,comm='], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(parseMacOSProcessList(stdout));
    });
  });
}

function isFallbackProcessTarget(target) {
  return String(target?.id || '').endsWith(':ps');
}

function runFallbackActivation(target, options = {}) {
  const execFile = options.execFile || defaultExecFile;
  const appName = String(target?.appName || '').trim();
  if (!appName) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', appName], { windowsHide: true }, (error) => {
      resolve(!error);
    });
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
      const windows = (Array.isArray(result) ? result : [result]).map(sanitizeWindow).filter(Boolean);
      return windows.length > 0 ? windows : listFallbackProcesses(options);
    },
    async isWindowAvailable(target) {
      if (isFallbackProcessTarget(target)) {
        try {
          process.kill(Number(target.processId), 0);
          return true;
        } catch {
          return false;
        }
      }
      return (await run('available', target)) === true;
    },
    async activateWindow(target) {
      if (isFallbackProcessTarget(target)) return runFallbackActivation(target, options);
      return (await run('activate', target)) === true;
    },
    async isWindowActive(target) {
      if (isFallbackProcessTarget(target)) return true;
      return (await run('active', target)) === true;
    },
  };
}

module.exports = {
  MACOS_WINDOW_SCRIPT,
  createMacOSWindowAdapter,
  parseMacOSProcessList,
  sanitizeWindow,
};
