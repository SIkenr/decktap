const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { once } = require('node:events');
const { WebSocket } = require('ws');

const {
  PAIRING_CLOSE_CODES,
  PROTOCOL_VERSION,
  SERVICE_STATES,
  commandFailureReason,
  createLanService,
} = require('../client/lan-service');
const { createPairingManager } = require('../client/pairing');

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createTestService(overrides = {}) {
  return createLanService({
    host: '127.0.0.1',
    port: 0,
    logger: silentLogger,
    getNetworkInterfaces: () => ({
      en0: [{ family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }],
    }),
    keyboardController: { async execute() {} },
    ...overrides,
  });
}

function createMemoryTrustedStore() {
  let activeAddress = null;
  return {
    clear() {
      if (!activeAddress) return 0;
      activeAddress = null;
      return 1;
    },
    count: () => (activeAddress ? 1 : 0),
    getHistory: () => [],
    isTrusted: (address) => activeAddress === address,
    revoke(address) {
      if (activeAddress !== address) return false;
      activeAddress = null;
      return true;
    },
    trust(address) {
      activeAddress = address;
      return true;
    },
  };
}

function pairingToken(info) {
  return new URLSearchParams(new URL(info.controlUrl).hash.slice(1)).get('pairing');
}

function pairingCode(info) {
  return info.pairingCode;
}

function waitForJsonMessage(socket, predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (data, isBinary) => {
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

async function openSocket(info, options) {
  const socket = new WebSocket(`ws://127.0.0.1:${info.port}/control`, options);
  await once(socket, 'open');
  return socket;
}

async function pairSocket(info, token = pairingToken(info), code = pairingCode(info)) {
  const socket = await openSocket(info);
  const pairedPromise = waitForJsonMessage(socket, ({ type }) => type === 'paired');
  const configPromise = waitForJsonMessage(socket, ({ type }) => type === 'controller-config');
  socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'pair', token, code }));
  await pairedPromise;
  const config = await configPromise;
  return { config, socket };
}

function sendCommand(socket, command, id) {
  socket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'command',
    command,
    ...(id ? { id } : {}),
  }));
}

test('LAN service applies browser security headers without exposing the pairing token over HTTP', async (t) => {
  const service = createTestService();
  const info = await service.start();
  t.after(() => service.stop());

  const response = await fetch(`http://127.0.0.1:${info.port}/api/controller-config`);
  const body = await response.text();
  const controllerConfig = JSON.parse(body);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(body.includes('pairing='), false);
  assert.equal(body.includes(info.pairingCode), false);
  assert.equal(info.controlUrl.includes(info.pairingCode), false);
  assert.equal(Number.isFinite(controllerConfig.serverTime), true);
});

test('LAN service start and stop are idempotent, restartable, and rotate pairing on restart', async () => {
  const service = createTestService();

  assert.equal(service.getState(), SERVICE_STATES.STOPPED);
  const firstInfo = await service.start();
  const secondInfo = await service.start();

  assert.equal(service.getState(), SERVICE_STATES.RUNNING);
  assert.deepEqual(secondInfo, firstInfo);
  assert.equal(firstInfo.localAddress, '192.168.1.20');
  assert.ok(firstInfo.port > 0);
  assert.ok(firstInfo.pairingExpiresAt > Date.now());
  const firstToken = pairingToken(firstInfo);

  await service.stop();
  await service.stop();
  assert.equal(service.getState(), SERVICE_STATES.STOPPED);

  const restartedInfo = await service.start();
  assert.equal(service.getState(), SERVICE_STATES.RUNNING);
  assert.ok(restartedInfo.port > 0);
  assert.notEqual(pairingToken(restartedInfo), firstToken);
  await service.stop();
});

test('LAN service rejects commands before secure pairing', async () => {
  const commands = [];
  const service = createTestService({
    keyboardController: { async execute(command) { commands.push(command); } },
  });
  const info = await service.start();
  const socket = await openSocket(info);
  const closePromise = once(socket, 'close');

  sendCommand(socket, 'next');
  const [code] = await closePromise;

  assert.equal(code, PAIRING_CLOSE_CODES.AUTHENTICATION_FAILED);
  assert.deepEqual(commands, []);
  await service.stop();
});

test('LAN service forwards only allowlisted versioned commands after pairing', async () => {
  const commands = [];
  const service = createTestService({
    keyboardController: {
      async execute(command) {
        commands.push(command);
      },
    },
  });

  const info = await service.start();
  const { socket } = await pairSocket(info);

  sendCommand(socket, 'next');
  sendCommand(socket, 'next-horizontal');
  sendCommand(socket, 'launch');
  sendCommand(socket, 'prev');
  sendCommand(socket, 'prev-horizontal');

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(commands, ['next', 'next-horizontal', 'prev', 'prev-horizontal']);

  socket.close();
  await once(socket, 'close');
  await service.stop();
});

test('LAN service acknowledges successful commands and returns safe failure reasons', async () => {
  let failure = null;
  const service = createTestService({
    keyboardController: {
      async execute() {
        if (failure) throw failure;
      },
    },
  });
  const info = await service.start();
  const { socket } = await pairSocket(info);

  const successPromise = waitForJsonMessage(
    socket,
    ({ type, id }) => type === 'command-result' && id === 'request-1',
  );
  sendCommand(socket, 'next', 'request-1');
  assert.deepEqual(await successPromise, {
    v: PROTOCOL_VERSION,
    type: 'command-result',
    id: 'request-1',
    status: 'ok',
  });

  failure = Object.assign(new Error('private diagnostic'), { code: 'TARGET_NOT_AVAILABLE' });
  const failedPromise = waitForJsonMessage(
    socket,
    ({ type, id }) => type === 'command-result' && id === 'request-2',
  );
  sendCommand(socket, 'prev', 'request-2');
  assert.deepEqual(await failedPromise, {
    v: PROTOCOL_VERSION,
    type: 'command-result',
    id: 'request-2',
    status: 'error',
    reason: 'target-lost',
  });

  socket.close();
  await once(socket, 'close');
  await service.stop();
});

test('LAN service rejects malformed command request identifiers without executing', async () => {
  const commands = [];
  const service = createTestService({
    keyboardController: { async execute(command) { commands.push(command); } },
  });
  const info = await service.start();
  const { socket } = await pairSocket(info);

  sendCommand(socket, 'next', 'contains spaces');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(commands, []);

  socket.close();
  await once(socket, 'close');
  await service.stop();
});

test('LAN service sends configuration only after pairing and broadcasts updates', async (t) => {
  let pageTurnMode = 'horizontal';
  let currentTime = 1_800_000_000_000;
  const service = createTestService({
    getControllerConfig: () => ({ pageTurnMode }),
    now: () => currentTime,
    pairingManager: createPairingManager({
      now: () => currentTime,
      randomBytes: (size) => Buffer.alloc(size, 7),
    }),
  });
  t.after(() => service.stop());

  const info = await service.start();
  const { config, socket } = await pairSocket(info);
  assert.deepEqual(config, {
    v: PROTOCOL_VERSION,
    type: 'controller-config',
    pageTurnMode: 'horizontal',
    serverTime: currentTime,
  });

  pageTurnMode = 'unsupported';
  currentTime += 5000;
  const updatedMessagePromise = waitForJsonMessage(socket, ({ type }) => type === 'controller-config');
  service.broadcastControllerConfig();
  assert.deepEqual(await updatedMessagePromise, {
    v: PROTOCOL_VERSION,
    type: 'controller-config',
    pageTurnMode: 'vertical',
    serverTime: currentTime,
  });

  socket.close();
  await once(socket, 'close');
  await service.stop();
});

test('LAN service sends a sanitized target status to paired controllers', async () => {
  const service = createTestService({
    getControllerConfig: () => ({
      pageTurnMode: 'vertical',
      target: {
        appName: 'A'.repeat(120),
        status: 'locked',
        processId: 42,
      },
    }),
  });
  const info = await service.start();
  const { config, socket } = await pairSocket(info);

  assert.deepEqual(config.target, {
    appName: 'A'.repeat(80),
    status: 'locked',
  });
  assert.equal('processId' in config.target, false);

  socket.close();
  await once(socket, 'close');
  await service.stop();
});

test('command failures map to a small external reason allowlist', () => {
  assert.equal(commandFailureReason({ code: 'TARGET_NOT_AVAILABLE' }), 'target-lost');
  assert.equal(commandFailureReason({ code: 'TARGET_FOCUS_FAILED' }), 'focus-failed');
  assert.equal(commandFailureReason({ code: 'KEYBOARD_UNAVAILABLE' }), 'keyboard-unavailable');
  assert.equal(commandFailureReason(new Error('private internal error')), 'control-failed');
});

test('LAN service counts only authenticated controllers', async () => {
  const snapshots = [];
  const service = createTestService();
  const unsubscribe = service.subscribe((snapshot) => snapshots.push(snapshot));

  const info = await service.start();
  const pendingSocket = await openSocket(info);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(service.getSnapshot().connectedClients, 0);
  assert.equal(service.getSnapshot().pendingClients, 1);

  const pairedPromise = waitForJsonMessage(pendingSocket, ({ type }) => type === 'paired');
  pendingSocket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'pair',
    token: pairingToken(info),
    code: pairingCode(info),
  }));
  await pairedPromise;
  assert.equal(service.getSnapshot().connectedClients, 1);
  assert.ok(snapshots.some(({ connectedClients }) => connectedClients === 1));

  pendingSocket.close();
  await once(pendingSocket, 'close');
  unsubscribe();
  await service.stop();
});

test('LAN service requires the numeric code and allows retry without reconnecting', async () => {
  const manager = createPairingManager({
    randomBytes: (size) => Buffer.alloc(size, 6),
    randomInt: () => 123456,
  });
  const service = createTestService({ pairingManager: manager, maxPairingAttempts: 3 });
  const info = await service.start();
  const socket = await openSocket(info);
  const rejectedPromise = waitForJsonMessage(socket, ({ type }) => type === 'pairing-rejected');
  socket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'pair',
    token: pairingToken(info),
    code: '000000',
  }));
  assert.deepEqual(await rejectedPromise, {
    v: PROTOCOL_VERSION,
    type: 'pairing-rejected',
    reason: 'invalid-code',
    remainingAttempts: 2,
  });
  assert.equal(socket.readyState, WebSocket.OPEN);

  const pairedPromise = waitForJsonMessage(socket, ({ type }) => type === 'paired');
  socket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'pair',
    token: pairingToken(info),
    code: '123456',
  }));
  assert.equal((await pairedPromise).method, 'numeric-code');
  socket.close();
  await once(socket, 'close');
  await service.stop();
});

test('a trusted local address restores pairing after the browser closes', async () => {
  const trustedClientStore = createMemoryTrustedStore();
  const service = createTestService({ trustedClientStore });
  const info = await service.start();
  const first = await pairSocket(info);
  assert.equal(trustedClientStore.count(), 1);
  first.socket.close();
  await once(first.socket, 'close');

  const restoredSocket = new WebSocket(`ws://127.0.0.1:${info.port}/control`);
  const restoredPromise = waitForJsonMessage(restoredSocket, ({ type }) => type === 'paired');
  await once(restoredSocket, 'open');
  assert.equal((await restoredPromise).method, 'trusted-ip');
  assert.equal(service.getSnapshot().connectedClients, 1);

  restoredSocket.close();
  await once(restoredSocket, 'close');
  await service.stop();
});

test('a newly paired controller replaces the previous active controller', async () => {
  const startedAt = Date.now();
  let currentTime = startedAt;
  const service = createTestService({ now: () => currentTime });
  const info = await service.start();
  const first = await pairSocket(info);
  const firstClose = once(first.socket, 'close');
  currentTime += 1000;
  const second = await pairSocket(info);
  assert.equal((await firstClose)[0], PAIRING_CLOSE_CODES.DEVICE_REPLACED);

  assert.deepEqual(service.getSnapshot().devices, [
    { id: 'client-2', label: '手机控制器 2', connectedAt: startedAt + 1000 },
  ]);
  assert.equal(JSON.stringify(service.getSnapshot().devices).includes('192.168'), false);

  const secondClose = once(second.socket, 'close');
  assert.equal(service.disconnectClient('client-2'), true);
  assert.equal((await secondClose)[0], PAIRING_CLOSE_CODES.DEVICE_DISCONNECTED);
  assert.deepEqual(service.getSnapshot().devices, []);
  assert.equal(service.disconnectClient('client-missing'), false);
  await service.stop();
});

test('LAN service disconnects all authenticated controllers without rotating pairing', async () => {
  const service = createTestService();
  const info = await service.start();
  const first = await pairSocket(info);
  const firstClose = once(first.socket, 'close');

  assert.equal(service.disconnectAllClients(), 1);
  assert.equal((await firstClose)[0], PAIRING_CLOSE_CODES.DEVICE_DISCONNECTED);
  assert.equal(service.getSnapshot().connectedClients, 0);
  assert.deepEqual(service.getSnapshot().devices, []);
  assert.equal(service.disconnectAllClients(), 0);

  await service.stop();
});

test('invalid and expired pairing tokens are rejected', async () => {
  let currentTime = 10_000;
  const manager = createPairingManager({
    now: () => currentTime,
    randomBytes: (size) => Buffer.alloc(size, 4),
    ttlMs: 1000,
  });
  const service = createTestService({ pairingManager: manager, now: () => currentTime });
  const info = await service.start();

  const invalidSocket = await openSocket(info);
  const invalidClose = once(invalidSocket, 'close');
  invalidSocket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'pair',
    token: 'incorrect',
    code: pairingCode(info),
  }));
  assert.equal((await invalidClose)[0], PAIRING_CLOSE_CODES.AUTHENTICATION_FAILED);

  currentTime += 1000;
  const expiredSocket = await openSocket(info);
  const expiredClose = once(expiredSocket, 'close');
  expiredSocket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'pair',
    token: pairingToken(info),
    code: pairingCode(info),
  }));
  assert.equal((await expiredClose)[0], PAIRING_CLOSE_CODES.AUTHENTICATION_FAILED);

  await service.stop();
});

test('manual pairing rotation revokes sessions and invalidates the old QR token', async () => {
  const trustedClientStore = createMemoryTrustedStore();
  const service = createTestService({ trustedClientStore });
  const info = await service.start();
  const oldToken = pairingToken(info);
  const { socket } = await pairSocket(info);
  const closePromise = once(socket, 'close');

  service.rotatePairing();
  assert.equal((await closePromise)[0], PAIRING_CLOSE_CODES.PAIRING_ROTATED);
  assert.equal(trustedClientStore.count(), 0);
  const newInfo = service.getInfo();
  assert.notEqual(pairingToken(newInfo), oldToken);

  const replaySocket = await openSocket(newInfo);
  const replayClose = once(replaySocket, 'close');
  replaySocket.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: 'pair',
    token: oldToken,
    code: pairingCode(newInfo),
  }));
  assert.equal((await replayClose)[0], PAIRING_CLOSE_CODES.AUTHENTICATION_FAILED);
  await service.stop();
});

test('LAN service enforces authentication timeout and same-origin browser connections', async () => {
  const service = createTestService({ authenticationTimeoutMs: 20 });
  const info = await service.start();

  const timeoutSocket = await openSocket(info);
  assert.equal((await once(timeoutSocket, 'close'))[0], PAIRING_CLOSE_CODES.AUTHENTICATION_TIMEOUT);

  const foreignSocket = new WebSocket(`ws://127.0.0.1:${info.port}/control`, {
    origin: 'http://attacker.example',
  });
  const [foreignCode] = await once(foreignSocket, 'close');
  assert.equal(foreignCode, 1008);
  await service.stop();
});

test('LAN service rate limits authenticated controller commands', async () => {
  const commands = [];
  const service = createTestService({
    maxCommandsPerWindow: 2,
    keyboardController: { async execute(command) { commands.push(command); } },
  });
  const info = await service.start();
  const { socket } = await pairSocket(info);
  const rejectedPromise = waitForJsonMessage(socket, ({ type }) => type === 'command-rejected');

  sendCommand(socket, 'next');
  sendCommand(socket, 'prev');
  sendCommand(socket, 'next');
  assert.equal((await rejectedPromise).reason, 'rate-limit');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(commands, ['next', 'prev']);

  socket.close();
  await once(socket, 'close');
  await service.stop();
});

test('LAN service reports occupied ports and can be returned to stopped state', async () => {
  const blocker = http.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const { port } = blocker.address();

  const service = createTestService({ port });
  await assert.rejects(() => service.start(), (error) => error.code === 'EADDRINUSE');
  assert.equal(service.getState(), SERVICE_STATES.ERROR);

  await service.stop();
  assert.equal(service.getState(), SERVICE_STATES.STOPPED);
  blocker.close();
  await once(blocker, 'close');
});

test('LAN service falls back to localhost when interface discovery fails', async () => {
  const service = createTestService({
    getNetworkInterfaces() {
      throw new Error('network access denied');
    },
  });

  const info = await service.start();
  assert.equal(info.localAddress, 'localhost');
  assert.match(info.controlUrl, /^http:\/\/localhost:\d+\/#pairing=/);
  await service.stop();
});

test('LAN service emits stable lifecycle, pairing, command, and rejection events', async () => {
  const events = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (event, message, context) => events.push({ level, event, message, context }),
    ]),
  );
  const service = createTestService({ logger });

  const info = await service.start();
  const { socket } = await pairSocket(info);
  sendCommand(socket, 'next');
  sendCommand(socket, 'unsupported-payload');
  await new Promise((resolve) => setTimeout(resolve, 30));
  socket.close();
  await once(socket, 'close');
  await service.stop();

  const eventNames = events.map(({ event }) => event);
  for (const expected of [
    'service.starting',
    'service.started',
    'websocket.connected',
    'pairing.succeeded',
    'command.executed',
    'command.rejected',
    'websocket.disconnected',
    'service.stopping',
    'service.stopped',
  ]) {
    assert.ok(eventNames.includes(expected), `Missing log event: ${expected}`);
  }

  const rejected = events.find(({ event }) => event === 'command.rejected');
  assert.equal(rejected.context.reason, 'invalid-command-schema');
  assert.equal(JSON.stringify(rejected).includes('unsupported-payload'), false);
});
