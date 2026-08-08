const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createTrustedClientStore,
  normalizeClientAddress,
} = require('../client/trusted-client-store');

test('trusted client addresses accept only local network values', () => {
  assert.equal(normalizeClientAddress('::ffff:192.168.1.24'), '192.168.1.24');
  assert.equal(normalizeClientAddress('10.0.0.8'), '10.0.0.8');
  assert.equal(normalizeClientAddress('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeClientAddress('fd00::24'), 'fd00::24');
  assert.equal(normalizeClientAddress('8.8.8.8'), null);
  assert.equal(normalizeClientAddress('not-an-address'), null);
});

test('trusted client store keeps one active address and archives replaced devices', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-trusted-client-'));
  const filePath = path.join(directory, 'trusted-clients.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let currentTime = 10_000;
  let nextId = 0;
  const options = {
    filePath,
    now: () => currentTime,
    ttlMs: 60_000,
    createId: () => `device-${++nextId}`,
  };
  const store = createTrustedClientStore(options);

  assert.equal(store.trust('192.168.1.10'), true);
  assert.equal(store.isTrusted('::ffff:192.168.1.10'), true);
  assert.equal(store.count(), 1);

  currentTime += 1000;
  assert.equal(store.trust('192.168.1.11'), true);
  assert.equal(store.isTrusted('192.168.1.10'), false);
  assert.equal(store.isTrusted('192.168.1.11'), true);
  assert.deepEqual(store.getHistory(), [{
    id: 'device-1',
    pairedAt: 10_000,
    reason: 'replaced',
    revokedAt: 11_000,
  }]);

  const reloaded = createTrustedClientStore(options);
  assert.equal(reloaded.isTrusted('192.168.1.11'), true);
  assert.equal(JSON.stringify(reloaded.getHistory()).includes('192.168'), false);
});

test('trusted client store expires and manually revokes active authorization', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-trusted-client-'));
  const filePath = path.join(directory, 'trusted-clients.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let currentTime = 20_000;
  const store = createTrustedClientStore({
    filePath,
    now: () => currentTime,
    ttlMs: 60_000,
    createId: () => 'device-current',
  });

  store.trust('10.0.0.20');
  assert.equal(store.revoke('10.0.0.20'), true);
  assert.equal(store.isTrusted('10.0.0.20'), false);
  assert.equal(store.getHistory()[0].reason, 'manual');

  currentTime += 1000;
  store.trust('10.0.0.21');
  currentTime += 60_000;
  assert.equal(store.isTrusted('10.0.0.21'), false);
  assert.equal(store.getHistory()[0].reason, 'expired');
});
