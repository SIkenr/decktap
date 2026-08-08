const assert = require('node:assert/strict');
const test = require('node:test');

const { createMacOSWindowAdapter } = require('../client/macos-window-adapter');
const { runSystemCommand, SystemCommandError } = require('../client/system-command');
const { createPlatformWindowAdapter } = require('../client/window-adapter');
const {
  WINDOWS_WINDOW_SCRIPT,
  createWindowsWindowAdapter,
} = require('../client/windows-window-adapter');

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
  });

  assert.deepEqual(await adapter.captureActiveWindow(), {
    ...capturedWindow,
    bundleId: 'com.microsoft.Powerpoint',
    platform: 'darwin',
  });
  assert.deepEqual(await adapter.listWindows(), []);
  assert.equal(await adapter.isWindowAvailable(capturedWindow), false);
  assert.equal(await adapter.activateWindow(capturedWindow), true);
  assert.equal(await adapter.isWindowActive(capturedWindow), true);
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
