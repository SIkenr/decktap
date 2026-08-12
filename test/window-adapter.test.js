const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MACOS_WINDOW_SCRIPT,
  createMacOSWindowAdapter,
  parseMacOSProcessList,
} = require('../client/macos-window-adapter');
const { runSystemCommand, SystemCommandError } = require('../client/system-command');
const { createPlatformWindowAdapter } = require('../client/window-adapter');
const {
  WINDOWS_WINDOW_SCRIPT,
  createWindowsWindowAdapter,
  filterFallbackProcesses,
} = require('../client/windows-window-adapter');
const {
  processRuleForName,
} = require('../client/process-whitelist');

const capturedWindow = {
  id: '9001',
  processId: 42,
  appName: 'PowerPoint',
  title: 'Quarterly review',
};

function createFakeRunner(calls) {
  return async (operation, target) => {
    calls.push([operation, target?.id || null]);
    if (operation === 'capture') return capturedWindow;
    if (operation === 'list') return [capturedWindow, null, { id: '', processId: 0 }];
    return true;
  };
}

test('Windows adapter normalizes window results and delegates focus operations', async () => {
  const calls = [];
  const adapter = createWindowsWindowAdapter({ run: createFakeRunner(calls) });

  assert.deepEqual(await adapter.captureActiveWindow(), {
    ...capturedWindow,
    windowClass: '',
    platform: 'win32',
  });
  assert.equal((await adapter.listWindows()).length, 1);
  assert.equal(await adapter.isWindowAvailable(capturedWindow), true);
  assert.equal(await adapter.activateWindow(capturedWindow), true);
  assert.equal(await adapter.isWindowActive(capturedWindow), true);
  assert.deepEqual(calls.map(([operation]) => operation), [
    'capture', 'list', 'available', 'activate', 'active',
  ]);
});

test('Windows adapter uses an encoded script and environment-only operation arguments', async () => {
  let received;
  const adapter = createWindowsWindowAdapter({
    excludeProcessId: 777,
    env: { DECKTAP_TEST_ENV: 'kept' },
    execFile(executable, args, options, callback) {
      received = { executable, args, options };
      callback(null, JSON.stringify(capturedWindow), '');
    },
  });

  assert.equal((await adapter.captureActiveWindow()).appName, 'PowerPoint');
  assert.equal(received.executable, 'powershell.exe');
  assert.equal(received.args.includes('-Command'), false);
  const encodedIndex = received.args.indexOf('-EncodedCommand');
  assert.notEqual(encodedIndex, -1);
  assert.equal(
    Buffer.from(received.args[encodedIndex + 1], 'base64').toString('utf16le'),
    WINDOWS_WINDOW_SCRIPT,
  );
  assert.equal(received.options.env.DECKTAP_WINDOW_OPERATION, 'capture');
  assert.equal(received.options.env.DECKTAP_WINDOW_ID, '');
  assert.equal(received.options.env.DECKTAP_EXPECTED_PROCESS_ID, '0');
  assert.equal(received.options.env.DECKTAP_EXCLUDED_PROCESS_ID, '777');
  assert.equal(received.options.env.DECKTAP_TEST_ENV, 'kept');
});

test('macOS adapter keeps bundle identity and rejects malformed window results', async () => {
  const calls = [];
  const adapter = createMacOSWindowAdapter({
    run: async (operation, target) => {
      calls.push([operation, target?.id || null]);
      if (operation === 'capture') return { ...capturedWindow, bundleId: 'com.microsoft.Powerpoint' };
      if (operation === 'list') return { id: '', processId: 42 };
      return operation !== 'available' ? true : false;
    },
    execFile(_executable, _args, _options, callback) {
      callback(null, '', '');
    },
  });

  assert.deepEqual(await adapter.captureActiveWindow(), {
    ...capturedWindow,
    bundleId: 'com.microsoft.Powerpoint',
    windowClass: '',
    platform: 'darwin',
  });
  assert.deepEqual(await adapter.listWindows(), []);
  assert.equal(await adapter.isWindowAvailable(capturedWindow), false);
  assert.equal(await adapter.activateWindow(capturedWindow), true);
  assert.equal(await adapter.isWindowActive(capturedWindow), true);
});

test('window adapters keep visible windows even when titles are empty', async () => {
  const titlelessWindow = { ...capturedWindow, title: '' };
  const windows = createWindowsWindowAdapter({
    run: async (operation) => (operation === 'list' ? [titlelessWindow] : titlelessWindow),
  });
  const macos = createMacOSWindowAdapter({
    run: async (operation) => (operation === 'list'
      ? [{ ...titlelessWindow, bundleId: 'com.microsoft.PowerPoint' }]
      : titlelessWindow),
  });

  assert.equal((await windows.listWindows())[0].title, '');
  assert.equal((await macos.listWindows())[0].title, '');
});

test('macOS adapter accepts process-level fallback targets', async () => {
  const processTarget = {
    id: '42:process',
    processId: 42,
    appName: 'PowerPoint',
    bundleId: 'com.microsoft.PowerPoint',
    windowClass: 'AXApplication',
    title: '',
    platform: 'darwin',
  };
  const calls = [];
  const macos = createMacOSWindowAdapter({
    run: async (operation, target) => {
      calls.push([operation, target?.id || null]);
      if (operation === 'list') return [processTarget];
      if (operation === 'capture') return processTarget;
      return true;
    },
  });

  assert.deepEqual(await macos.captureActiveWindow(), processTarget);
  assert.deepEqual(await macos.listWindows(), [processTarget]);
  assert.equal(await macos.isWindowAvailable(processTarget), true);
  assert.equal(await macos.activateWindow(processTarget), true);
  assert.equal(await macos.isWindowActive(processTarget), true);
  assert.deepEqual(calls.map(([operation]) => operation), [
    'capture', 'list', 'available', 'activate', 'active',
  ]);
});

test('macOS adapter falls back to known presentation processes when AX enumeration is empty', async () => {
  const adapter = createMacOSWindowAdapter({
    run: async (operation) => (operation === 'list' ? [] : true),
    execFile(executable, args, options, callback) {
      assert.equal(executable, '/bin/ps');
      assert.deepEqual(args, ['-axo', 'pid=,comm=']);
      assert.equal(options.windowsHide, true);
      callback(null, [
        ' 100 /Applications/Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint',
        ' 101 /Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
        ' 102 /Applications/Keynote.app/Contents/MacOS/Keynote',
      ].join('\n'), '');
    },
  });

  assert.deepEqual(await adapter.listWindows(), [
    {
      id: '100:ps',
      processId: 100,
      appName: 'Microsoft PowerPoint',
      bundleId: '',
      windowClass: 'BSDProcess',
      title: '',
      platform: 'darwin',
    },
    {
      id: '102:ps',
      processId: 102,
      appName: 'Keynote',
      bundleId: '',
      windowClass: 'BSDProcess',
      title: '',
      platform: 'darwin',
    },
  ]);
});

test('macOS process list parser keeps only known presentation applications', () => {
  assert.deepEqual(parseMacOSProcessList([
    ' 200 /Applications/WPS Office.app/Contents/MacOS/WPS Office',
    ' 201 /System/Applications/Finder.app/Contents/MacOS/Finder',
    ' 202 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter',
  ].join('\n')).map(({ id, appName }) => [id, appName]), [
    ['200:ps', 'WPS Office'],
    ['202:ps', 'ProPresenter'],
  ]);
});

test('process whitelist covers historical and current supported app names', () => {
  assert.equal(processRuleForName('Microsoft PowerPoint', 'darwin')?.ruleId, 'powerpoint');
  assert.equal(processRuleForName('POWERPNT', 'win32')?.ruleId, 'powerpoint');
  assert.equal(processRuleForName('ProPresenter 6', 'darwin')?.ruleId, 'propresenter');
  assert.equal(processRuleForName('ProPresenter 7', 'win32')?.ruleId, 'propresenter');
  assert.equal(processRuleForName('WPPShow', 'win32')?.ruleId, 'wps-presentation');
  assert.equal(processRuleForName('Keynote', 'win32'), null);
});

test('macOS fallback process targets activate by application name before sending keys', async () => {
  const calls = [];
  const adapter = createMacOSWindowAdapter({
    run: async () => true,
    execFile(executable, args, _options, callback) {
      calls.push([executable, args]);
      callback(null, '', '');
    },
  });

  assert.equal(await adapter.activateWindow({
    id: '100:ps',
    processId: 100,
    appName: 'Microsoft PowerPoint',
    platform: 'darwin',
  }), true);
  assert.deepEqual(calls, [['/usr/bin/open', ['-a', 'Microsoft PowerPoint']]]);
});

test('macOS activation script restores minimized windows before raising them', () => {
  assert.match(MACOS_WINDOW_SCRIPT, /AXMinimized'\)\.value = false/);
  assert.match(MACOS_WINDOW_SCRIPT, /unminimizeProcessWindows\(process\)/);
  assert.match(MACOS_WINDOW_SCRIPT, /window\.actions\.byName\('AXRaise'\)\.perform/);
  assert.match(MACOS_WINDOW_SCRIPT, /activateApplication\(process, workspaceApp, payload\.appName\)/);
});

test('macOS adapter treats a live process as recoverable when a minimized window is not enumerable', async () => {
  const calls = [];
  const adapter = createMacOSWindowAdapter({
    run: async (operation, target) => {
      calls.push([operation, target?.id || null]);
      if (operation === 'available') return true;
      if (operation === 'activate') return true;
      if (operation === 'active') return true;
      return null;
    },
  });

  const minimizedTarget = {
    id: '42:0',
    processId: 42,
    appName: 'Keynote',
    title: 'DeckTap Test',
    platform: 'darwin',
  };

  assert.equal(await adapter.isWindowAvailable(minimizedTarget), true);
  assert.equal(await adapter.activateWindow(minimizedTarget), true);
  assert.equal(await adapter.isWindowActive(minimizedTarget), true);
  assert.deepEqual(calls, [
    ['available', '42:0'],
    ['activate', '42:0'],
    ['active', '42:0'],
  ]);
});

test('Windows process fallback keeps only whitelisted presentation processes', () => {
  assert.deepEqual(filterFallbackProcesses([
    { id: '10:process', processId: 10, appName: 'POWERPNT', platform: 'win32' },
    { id: '11:process', processId: 11, appName: 'explorer', platform: 'win32' },
    { id: '12', processId: 12, appName: 'notepad', platform: 'win32' },
  ]).map(({ id }) => id), ['10:process', '12']);
});

test('platform factory selects supported adapters and safely disables unsupported platforms', async () => {
  const windows = createPlatformWindowAdapter({ platform: 'win32', run: async () => capturedWindow });
  assert.equal((await windows.captureActiveWindow()).platform, 'win32');

  const unsupported = createPlatformWindowAdapter({ platform: 'linux' });
  assert.equal(await unsupported.captureActiveWindow(), null);
  assert.deepEqual(await unsupported.listWindows(), []);
  assert.equal(await unsupported.activateWindow(capturedWindow), false);
});

test('system command runner parses JSON without using a shell', async () => {
  let received;
  const result = await runSystemCommand('safe-tool', ['one', 'two'], {
    execFile(executable, args, options, callback) {
      received = { executable, args, options };
      callback(null, '{"ok":true}\n', '');
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(received.executable, 'safe-tool');
  assert.deepEqual(received.args, ['one', 'two']);
  assert.equal(received.options.windowsHide, true);
  assert.equal(Object.hasOwn(received.options, 'shell'), false);
});

test('system command runner rejects invalid and failed responses', async () => {
  await assert.rejects(
    () => runSystemCommand('tool', [], {
      execFile(_executable, _args, _options, callback) {
        callback(null, 'not-json', '');
      },
    }),
    (error) => error instanceof SystemCommandError && error.code === 'WINDOW_COMMAND_INVALID',
  );

  await assert.rejects(
    () => runSystemCommand('tool', [], {
      execFile(_executable, _args, _options, callback) {
        callback(Object.assign(new Error('Command failed: secret command text'), {
          code: 5,
          killed: false,
        }), '', 'ParserError: invalid script');
      },
    }),
    (error) => {
      assert.equal(error instanceof SystemCommandError, true);
      assert.equal(error.code, 'WINDOW_COMMAND_FAILED');
      assert.equal(error.cause, undefined);
      assert.deepEqual(error.details, {
        exitCode: 5,
        killed: false,
        signal: null,
        stderr: 'ParserError: invalid script',
      });
      return true;
    },
  );
});
