const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { REDACTED, createLogger } = require('../client/logger');

function createTempLogDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-logger-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function readRecords(logDir) {
  return fs.readFileSync(path.join(logDir, 'decktap.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

test('logger writes structured JSON records and respects log levels', (t) => {
  const logDir = createTempLogDir(t);
  const logger = createLogger({
    consoleTarget: false,
    level: 'info',
    logDir,
    now: () => new Date('2026-08-08T00:00:00.000Z'),
    sessionId: 'session-test',
  }).child('lan-service');

  logger.debug('debug.hidden', 'This should not be written.');
  logger.info('service.started', 'LAN service started.', { port: 9999 });

  const records = readRecords(logDir);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    timestamp: '2026-08-08T00:00:00.000Z',
    level: 'info',
    event: 'service.started',
    message: 'LAN service started.',
    sessionId: 'session-test',
    pid: process.pid,
    component: 'lan-service',
    port: 9999,
  });
});

test('logger redacts secrets in keys, URLs, authorization values, and errors', (t) => {
  const logDir = createTempLogDir(t);
  const logger = createLogger({ consoleTarget: false, logDir });
  const error = new Error('request failed at http://localhost/?token=visible-token');

  logger.error(
    'pairing.failed',
    'Authorization: Bearer visible-bearer',
    {
      authorization: 'Bearer visible-bearer',
      nested: { pairingCode: '123456', safe: 'kept' },
      requestUrl: 'http://localhost/?token=visible-token&mode=pair#pairing=fragment-secret',
      error,
    },
  );

  const [record] = readRecords(logDir);
  const serialized = JSON.stringify(record);
  assert.equal(record.authorization, REDACTED);
  assert.equal(record.nested.pairingCode, REDACTED);
  assert.equal(record.nested.safe, 'kept');
  assert.doesNotMatch(serialized, /visible-token|visible-bearer|fragment-secret|123456/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('logger rotates files without exceeding the configured archive count', (t) => {
  const logDir = createTempLogDir(t);
  const logger = createLogger({
    consoleTarget: false,
    logDir,
    maxBytes: 250,
    maxFiles: 2,
    sessionId: 'rotation-test',
  });

  for (let index = 0; index < 8; index += 1) {
    logger.info('rotation.entry', 'A log entry that is intentionally large enough to rotate.', { index });
  }

  assert.equal(fs.existsSync(path.join(logDir, 'decktap.log')), true);
  assert.equal(fs.existsSync(path.join(logDir, 'decktap.log.1')), true);
  assert.equal(fs.existsSync(path.join(logDir, 'decktap.log.2')), false);
});
