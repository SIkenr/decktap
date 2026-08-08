const express = require('express');
const http = require('node:http');
const os = require('node:os');
const { WebSocketServer, WebSocket } = require('ws');

const { COMMAND_KEYS } = require('./keyboard');
const { createLogger } = require('./logger');
const { selectLocalAddress } = require('./network');
const { createPairingManager } = require('./pairing');
const { normalizeClientAddress } = require('./trusted-client-store');

const PROTOCOL_VERSION = 2;
const PAIRING_CLOSE_CODES = Object.freeze({
  AUTHENTICATION_FAILED: 4003,
  AUTHENTICATION_TIMEOUT: 4008,
  DEVICE_DISCONNECTED: 4002,
  DEVICE_REPLACED: 4004,
  PAIRING_ROTATED: 4001,
});

const SERVICE_STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
});

const DEFAULT_AUTHENTICATION_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_PAIRING_ATTEMPTS = 5;

function commandFailureReason(error) {
  switch (error?.code) {
    case 'TARGET_NOT_AVAILABLE': return 'target-lost';
    case 'TARGET_FOCUS_FAILED': return 'focus-failed';
    case 'KEYBOARD_UNAVAILABLE': return 'keyboard-unavailable';
    default: return 'control-failed';
  }
}

function validRequestId(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 64
    && /^[a-zA-Z0-9_-]+$/.test(value);
}

function createLanService(options = {}) {
  const logger = options.logger || createLogger({ logDir: false }).child('lan-service');
  const port = options.port ?? 9999;
  const host = options.host || '0.0.0.0';
  const staticPath = options.staticPath;
  const keyboardController = options.keyboardController;
  const getNetworkInterfaces = options.getNetworkInterfaces || os.networkInterfaces;
  const getControllerConfig = options.getControllerConfig || (() => ({ pageTurnMode: 'vertical' }));
  const pairingManager = options.pairingManager || createPairingManager({ ttlMs: options.pairingTtlMs });
  const trustedClientStore = options.trustedClientStore || Object.freeze({
    clear: () => 0,
    count: () => 0,
    getHistory: () => [],
    isTrusted: () => false,
    revoke: () => false,
    trust: () => false,
  });
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const authenticationTimeoutMs = options.authenticationTimeoutMs ?? DEFAULT_AUTHENTICATION_TIMEOUT_MS;
  const maxPairingAttempts = options.maxPairingAttempts ?? DEFAULT_MAX_PAIRING_ATTEMPTS;
  const commandRateWindowMs = options.commandRateWindowMs ?? 1000;
  const maxCommandsPerWindow = options.maxCommandsPerWindow ?? 12;
  const maxConnections = options.maxConnections ?? 8;

  if (!keyboardController || typeof keyboardController.execute !== 'function') {
    throw new TypeError('keyboardController.execute is required');
  }
  if (!Number.isInteger(maxPairingAttempts) || maxPairingAttempts < 1 || maxPairingAttempts > 10) {
    throw new TypeError('Maximum pairing attempts must be between 1 and 10');
  }

  let state = SERVICE_STATES.STOPPED;
  let app;
  let server;
  let wss;
  let info;
  let baseControlUrl;
  let startPromise;
  let stopPromise;
  let pairingRotationTimer;
  let clientSequence = 0;
  let lastError = null;
  const listeners = new Set();
  const clientStates = new Map();

  function trustedStoreCall(method, fallback, ...args) {
    try {
      return trustedClientStore[method](...args);
    } catch (error) {
      logger.error('trusted-client.store-failed', 'Trusted client state could not be updated.', {
        error,
        operation: method,
      });
      return fallback;
    }
  }

  function normalizeControllerConfig() {
    const config = getControllerConfig() || {};
    const normalized = {
      pageTurnMode: config.pageTurnMode === 'horizontal' ? 'horizontal' : 'vertical',
      serverTime: now(),
    };
    if (config.target && typeof config.target === 'object') {
      const status = ['unconfigured', 'locked', 'lost'].includes(config.target.status)
        ? config.target.status
        : 'unconfigured';
      normalized.target = {
        appName: typeof config.target.appName === 'string'
          ? config.target.appName.slice(0, 80)
          : null,
        status,
      };
    }
    return normalized;
  }

  function authenticatedClientCount() {
    let count = 0;
    for (const clientState of clientStates.values()) {
      if (clientState.authenticated) count += 1;
    }
    return count;
  }

  function authenticatedDevices() {
    const devices = [];
    for (const clientState of clientStates.values()) {
      if (!clientState.authenticated) continue;
      devices.push({
        id: clientState.clientId,
        label: `手机控制器 ${clientState.clientId.replace(/^client-/, '')}`,
        connectedAt: clientState.authenticatedAt,
      });
    }
    return devices.sort((left, right) => left.connectedAt - right.connectedAt || left.id.localeCompare(right.id));
  }

  function getSnapshot() {
    return {
      connectedClients: authenticatedClientCount(),
      deviceHistory: trustedStoreCall('getHistory', []),
      devices: authenticatedDevices(),
      info: info ? { ...info } : null,
      lastError,
      pendingClients: Math.max(0, clientStates.size - authenticatedClientCount()),
      state,
      trustedClients: trustedStoreCall('count', 0),
    };
  }

  function notifyChange() {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        logger.error('service.listener.failed', 'A service state listener failed.', { error });
      }
    }
  }

  function setState(nextState) {
    logger.debug('service.state.changed', 'LAN service state changed.', { previousState: state, nextState });
    state = nextState;
    notifyChange();
  }

  function sendJson(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function sendControllerConfig(socket) {
    const clientState = clientStates.get(socket);
    if (!clientState?.authenticated) return;
    sendJson(socket, {
      v: PROTOCOL_VERSION,
      type: 'controller-config',
      ...normalizeControllerConfig(),
    });
  }

  function broadcastControllerConfig() {
    if (!wss) return;
    for (const socket of wss.clients) sendControllerConfig(socket);
  }

  function schedulePairingRotation() {
    if (pairingRotationTimer) clearTimer(pairingRotationTimer);
    const { expiresAt } = pairingManager.getState();
    const delay = Math.max(1, expiresAt - now());
    pairingRotationTimer = setTimer(() => {
      rotatePairingInternal({ reason: 'expired', revokeClients: false });
    }, delay);
    pairingRotationTimer.unref?.();
  }

  function revokeAuthenticatedClients() {
    for (const [socket, clientState] of clientStates) {
      if (!clientState.authenticated) continue;
      socket.close(PAIRING_CLOSE_CODES.PAIRING_ROTATED, 'Pairing code rotated');
    }
  }

  function disconnectClient(clientId) {
    for (const [socket, clientState] of clientStates) {
      if (clientState.clientId !== clientId || !clientState.authenticated) continue;
      clientState.authenticated = false;
      clientStates.delete(socket);
      trustedStoreCall('revoke', false, clientState.remoteAddress);
      socket.close(PAIRING_CLOSE_CODES.DEVICE_DISCONNECTED, 'Disconnected by desktop user');
      logger.info('controller.disconnected', 'A controller was disconnected by the desktop user.', {
        clientId,
      });
      notifyChange();
      return true;
    }
    return false;
  }

  function disconnectAllClients() {
    let disconnectedClients = 0;
    for (const [socket, clientState] of clientStates) {
      if (!clientState.authenticated) continue;
      clientState.authenticated = false;
      clientStates.delete(socket);
      trustedStoreCall('revoke', false, clientState.remoteAddress);
      disconnectedClients += 1;
      socket.close(PAIRING_CLOSE_CODES.DEVICE_DISCONNECTED, 'Disconnected by desktop user');
    }
    if (disconnectedClients > 0) {
      logger.info('controller.all-disconnected', 'All controllers were disconnected by the desktop user.', {
        disconnectedClients,
      });
      notifyChange();
    }
    return disconnectedClients;
  }

  function disconnectOtherClients(currentSocket) {
    let disconnectedClients = 0;
    for (const [socket, clientState] of clientStates) {
      if (socket === currentSocket || !clientState.authenticated) continue;
      clientState.authenticated = false;
      clientStates.delete(socket);
      disconnectedClients += 1;
      socket.close(PAIRING_CLOSE_CODES.DEVICE_REPLACED, 'Replaced by a newly paired controller');
    }
    return disconnectedClients;
  }

  function rotatePairingInternal({ reason, revokeClients }) {
    if (!baseControlUrl || !info) throw new Error('LAN service must be running before rotating pairing');
    const pairingState = pairingManager.rotate();
    info = {
      ...info,
      controlUrl: pairingManager.buildControlUrl(baseControlUrl),
      pairingCode: pairingState.code,
      pairingExpiresAt: pairingState.expiresAt,
    };
    if (revokeClients) {
      trustedStoreCall('clear', 0, 'rotated');
      revokeAuthenticatedClients();
    }
    schedulePairingRotation();
    logger.info('pairing.rotated', 'The controller pairing code was rotated.', {
      reason,
      revokedClients: revokeClients,
    });
    notifyChange();
    return { expiresAt: pairingState.expiresAt };
  }

  function rotatePairing() {
    return rotatePairingInternal({ reason: 'manual', revokeClients: true });
  }

  function originIsAllowed(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.host === request.headers.host;
    } catch {
      return false;
    }
  }

  function rejectClient(socket, clientId, reason, closeCode = PAIRING_CLOSE_CODES.AUTHENTICATION_FAILED) {
    logger.warn('pairing.rejected', 'A controller pairing attempt was rejected.', { clientId, reason });
    sendJson(socket, {
      v: PROTOCOL_VERSION,
      type: 'pairing-rejected',
      reason,
    });
    socket.close(closeCode, 'Pairing rejected');
  }

  function rejectPairingCode(socket, clientState) {
    clientState.pairingAttempts += 1;
    const remainingAttempts = Math.max(0, maxPairingAttempts - clientState.pairingAttempts);
    logger.warn('pairing.code-rejected', 'A controller supplied an incorrect numeric pairing code.', {
      clientId: clientState.clientId,
      remainingAttempts,
    });
    sendJson(socket, {
      v: PROTOCOL_VERSION,
      type: 'pairing-rejected',
      reason: 'invalid-code',
      remainingAttempts,
    });
    if (remainingAttempts === 0) {
      socket.close(PAIRING_CLOSE_CODES.AUTHENTICATION_FAILED, 'Pairing attempts exceeded');
    }
  }

  function parseMessage(rawMessage, isBinary) {
    if (isBinary) return { error: 'binary-message' };
    try {
      const message = JSON.parse(rawMessage.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return { error: 'invalid-schema' };
      }
      return { message };
    } catch {
      return { error: 'invalid-json' };
    }
  }

  function authenticateClient(socket, clientState, method) {
    const replacedClients = disconnectOtherClients(socket);
    clearTimer(clientState.authenticationTimer);
    clientState.authenticationTimer = null;
    clientState.authenticated = true;
    clientState.authenticatedAt = now();
    clientState.rateCount = 0;
    clientState.rateWindowStartedAt = now();
    if (method === 'numeric-code') trustedStoreCall('trust', false, clientState.remoteAddress);
    logger.info(
      method === 'trusted-ip' ? 'pairing.restored' : 'pairing.succeeded',
      method === 'trusted-ip'
        ? 'A trusted local controller connection was restored.'
        : 'A controller completed secure numeric pairing.',
      {
        clientId: clientState.clientId,
        connectedClients: authenticatedClientCount(),
        method,
        replacedClients,
      },
    );
    sendJson(socket, { v: PROTOCOL_VERSION, type: 'paired', method });
    sendControllerConfig(socket);
    notifyChange();
  }

  function handlePairing(socket, clientState, message) {
    if (
      message.v !== PROTOCOL_VERSION
      || message.type !== 'pair'
      || typeof message.token !== 'string'
      || message.token.length > 128
      || typeof message.code !== 'string'
      || !/^\d{6}$/.test(message.code)
    ) {
      rejectClient(socket, clientState.clientId, 'invalid-pairing-message');
      return;
    }

    if (!pairingManager.verifyToken(message.token)) {
      rejectClient(socket, clientState.clientId, 'invalid-or-expired-token');
      return;
    }

    if (!pairingManager.verifyCode(message.code)) {
      rejectPairingCode(socket, clientState);
      return;
    }

    authenticateClient(socket, clientState, 'numeric-code');
  }

  function rateLimitAllows(clientState) {
    const timestamp = now();
    if (timestamp - clientState.rateWindowStartedAt >= commandRateWindowMs) {
      clientState.rateWindowStartedAt = timestamp;
      clientState.rateCount = 0;
    }
    if (clientState.rateCount >= maxCommandsPerWindow) return false;
    clientState.rateCount += 1;
    return true;
  }

  async function handleCommand(socket, clientState, message, payloadBytes) {
    if (
      message.v !== PROTOCOL_VERSION
      || message.type !== 'command'
      || typeof message.command !== 'string'
      || !Object.hasOwn(COMMAND_KEYS, message.command)
      || (message.id !== undefined && !validRequestId(message.id))
    ) {
      logger.warn('command.rejected', 'Rejected an invalid controller command.', {
        clientId: clientState.clientId,
        payloadBytes,
        reason: 'invalid-command-schema',
      });
      return;
    }

    if (!rateLimitAllows(clientState)) {
      logger.warn('command.rejected', 'Rejected a rate-limited controller command.', {
        clientId: clientState.clientId,
        payloadBytes,
        reason: 'rate-limit',
      });
      sendJson(socket, {
        v: PROTOCOL_VERSION,
        type: 'command-rejected',
        ...(validRequestId(message.id) ? { id: message.id } : {}),
        reason: 'rate-limit',
      });
      return;
    }

    const startedAt = now();
    try {
      await keyboardController.execute(message.command);
      logger.debug('command.executed', 'Controller command completed.', {
        clientId: clientState.clientId,
        command: message.command,
        durationMs: now() - startedAt,
      });
      if (validRequestId(message.id)) {
        sendJson(socket, { v: PROTOCOL_VERSION, type: 'command-result', id: message.id, status: 'ok' });
      }
    } catch (error) {
      const reason = commandFailureReason(error);
      logger.error('command.failed', 'Controller command failed.', {
        clientId: clientState.clientId,
        command: message.command,
        durationMs: now() - startedAt,
        error,
        reason,
      });
      if (validRequestId(message.id)) {
        sendJson(socket, {
          v: PROTOCOL_VERSION,
          type: 'command-result',
          id: message.id,
          status: 'error',
          reason,
        });
      }
    }
  }

  function handleMessage(socket, rawMessage, isBinary) {
    const clientState = clientStates.get(socket);
    if (!clientState) return;
    const parsed = parseMessage(rawMessage, isBinary);

    if (parsed.error) {
      logger.warn('message.rejected', 'Rejected a malformed controller message.', {
        clientId: clientState.clientId,
        payloadBytes: rawMessage.length,
        reason: parsed.error,
      });
      if (!clientState.authenticated) rejectClient(socket, clientState.clientId, parsed.error);
      return;
    }

    if (!clientState.authenticated) {
      handlePairing(socket, clientState, parsed.message);
      return;
    }

    void handleCommand(socket, clientState, parsed.message, rawMessage.length);
  }

  function createResources() {
    app = express();
    app.disable('x-powered-by');
    app.use((_request, response, next) => {
      response.set({
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      next();
    });
    app.get('/api/controller-config', (_request, response) => {
      response.json(normalizeControllerConfig());
    });
    if (staticPath) {
      logger.debug('http.static.enabled', 'Static controller hosting is enabled.');
      app.use(express.static(staticPath));
    }

    server = http.createServer(app);
    wss = new WebSocketServer({
      server,
      path: '/control',
      maxPayload: 1024,
      perMessageDeflate: false,
    });

    wss.on('connection', (socket, request) => {
      const clientId = `client-${++clientSequence}`;

      if (wss.clients.size > maxConnections) {
        logger.warn('websocket.rejected', 'Rejected a controller because the connection limit was reached.', {
          clientId,
          reason: 'connection-limit',
        });
        socket.close(1013, 'Connection limit reached');
        return;
      }

      if (!originIsAllowed(request)) {
        logger.warn('websocket.rejected', 'Rejected a controller with an unexpected origin.', {
          clientId,
          reason: 'origin-mismatch',
        });
        socket.close(1008, 'Origin rejected');
        return;
      }

      const clientState = {
        authenticated: false,
        authenticatedAt: null,
        authenticationTimer: null,
        clientId,
        pairingAttempts: 0,
        rateCount: 0,
        rateWindowStartedAt: now(),
        remoteAddress: normalizeClientAddress(request.socket.remoteAddress),
      };
      clientStates.set(socket, clientState);

      socket.on('message', (message, isBinary) => handleMessage(socket, message, isBinary));
      socket.on('error', (error) => logger.error('websocket.client.error', 'Controller connection failed.', {
        clientId,
        error,
      }));
      socket.on('close', (code) => {
        clearTimer(clientState.authenticationTimer);
        clientStates.delete(socket);
        logger.info('websocket.disconnected', 'A controller disconnected.', {
          clientId,
          closeCode: code,
          connectedClients: authenticatedClientCount(),
        });
        notifyChange();
      });

      if (
        clientState.remoteAddress
        && trustedStoreCall('isTrusted', false, clientState.remoteAddress)
      ) {
        trustedStoreCall('trust', false, clientState.remoteAddress);
        authenticateClient(socket, clientState, 'trusted-ip');
        return;
      }

      clientState.authenticationTimer = setTimer(() => {
        if (clientState.authenticated || socket.readyState !== WebSocket.OPEN) return;
        logger.warn('pairing.timeout', 'A controller did not pair before the deadline.', { clientId });
        socket.close(PAIRING_CLOSE_CODES.AUTHENTICATION_TIMEOUT, 'Pairing timeout');
      }, authenticationTimeoutMs);
      clientState.authenticationTimer.unref?.();

      logger.info('websocket.connected', 'A controller connection is waiting for secure pairing.', {
        clientId,
        pendingClients: getSnapshot().pendingClients,
      });
      sendJson(socket, { v: PROTOCOL_VERSION, type: 'pairing-required', codeDigits: 6 });
      notifyChange();
    });

    wss.on('error', (error) => logger.error('websocket.server.error', 'WebSocket server failed.', { error }));
  }

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  async function closeResources() {
    logger.debug('service.resources.closing', 'Closing LAN service resources.', {
      connectedClients: authenticatedClientCount(),
    });
    if (pairingRotationTimer) {
      clearTimer(pairingRotationTimer);
      pairingRotationTimer = undefined;
    }
    for (const clientState of clientStates.values()) clearTimer(clientState.authenticationTimer);
    clientStates.clear();

    if (wss) {
      for (const socket of wss.clients) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.terminate();
        }
      }
      await new Promise((resolve) => wss.close(() => resolve()));
    }

    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    app = undefined;
    server = undefined;
    wss = undefined;
    info = undefined;
    baseControlUrl = undefined;
    notifyChange();
  }

  async function start() {
    if (state === SERVICE_STATES.RUNNING) return info;
    if (startPromise) return startPromise;
    if (stopPromise) await stopPromise;

    startPromise = (async () => {
      setState(SERVICE_STATES.STARTING);
      logger.info('service.starting', 'Starting the LAN service.', { host, requestedPort: port });

      try {
        lastError = null;
        createResources();
        await listen();

        const addressInfo = server.address();
        const actualPort = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : port;
        let selectedInterface = null;
        try {
          selectedInterface = selectLocalAddress(getNetworkInterfaces());
        } catch (error) {
          logger.warn('network.discovery.failed', 'Network discovery failed; using localhost.', { error });
        }
        const localAddress = selectedInterface?.address || 'localhost';
        baseControlUrl = `http://${localAddress}:${actualPort}`;
        const pairingState = pairingManager.rotate();

        info = {
          host,
          port: actualPort,
          localAddress,
          interfaceName: selectedInterface?.name || null,
          controlUrl: pairingManager.buildControlUrl(baseControlUrl),
          pairingCode: pairingState.code,
          pairingExpiresAt: pairingState.expiresAt,
        };
        schedulePairingRotation();
        setState(SERVICE_STATES.RUNNING);
        logger.info('service.started', 'LAN service started with secure controller pairing.', {
          host,
          port: actualPort,
          interfaceName: selectedInterface?.name || null,
          pairingExpiresAt: pairingState.expiresAt,
        });
        return info;
      } catch (error) {
        lastError = {
          code: typeof error.code === 'string' ? error.code : 'SERVICE_START_FAILED',
          message: error.message || 'The LAN service failed to start.',
        };
        setState(SERVICE_STATES.ERROR);
        logger.error('service.start.failed', 'LAN service failed to start.', { error, requestedPort: port });
        await closeResources().catch((cleanupError) => {
          logger.error('service.cleanup.failed', 'Cleanup after a start failure failed.', { error: cleanupError });
        });
        throw error;
      } finally {
        startPromise = undefined;
      }
    })();

    return startPromise;
  }

  async function stop() {
    if (state === SERVICE_STATES.STOPPED) return;
    if (stopPromise) return stopPromise;
    if (startPromise) {
      try {
        await startPromise;
      } catch {
        setState(SERVICE_STATES.STOPPED);
        return;
      }
    }

    stopPromise = (async () => {
      setState(SERVICE_STATES.STOPPING);
      logger.info('service.stopping', 'Stopping the LAN service.');
      try {
        await closeResources();
        setState(SERVICE_STATES.STOPPED);
        logger.info('service.stopped', 'LAN service stopped.');
      } catch (error) {
        lastError = {
          code: typeof error.code === 'string' ? error.code : 'SERVICE_STOP_FAILED',
          message: error.message || 'The LAN service failed to stop.',
        };
        setState(SERVICE_STATES.ERROR);
        logger.error('service.stop.failed', 'LAN service failed to stop.', { error });
        throw error;
      } finally {
        stopPromise = undefined;
      }
    })();

    return stopPromise;
  }

  return {
    broadcastControllerConfig,
    disconnectAllClients,
    disconnectClient,
    getInfo: () => info,
    getSnapshot,
    getState: () => state,
    rotatePairing,
    start,
    stop,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A listener function is required');
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
  };
}

module.exports = {
  PAIRING_CLOSE_CODES,
  PROTOCOL_VERSION,
  SERVICE_STATES,
  commandFailureReason,
  createLanService,
};
