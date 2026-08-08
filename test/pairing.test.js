const assert = require('node:assert/strict');
const test = require('node:test');

const { createPairingManager } = require('../client/pairing');

function tokenFromUrl(controlUrl) {
  return new URLSearchParams(new URL(controlUrl).hash.slice(1)).get('pairing');
}

test('pairing manager creates an unguessable URL-fragment token and verifies it', () => {
  const manager = createPairingManager({
    now: () => 1000,
    randomBytes: (size) => Buffer.alloc(size, 7),
    randomInt: () => 123456,
    ttlMs: 60_000,
  });

  const { code } = manager.rotate();
  const controlUrl = manager.buildControlUrl('http://192.168.1.20:9999');
  const token = tokenFromUrl(controlUrl);

  assert.match(controlUrl, /^http:\/\/192\.168\.1\.20:9999\/#pairing=/);
  assert.ok(token.length >= 22);
  assert.match(code, /^\d{6}$/);
  assert.equal(controlUrl.includes(code), false);
  assert.equal(manager.verify(token, code), true);
  assert.equal(manager.verify(`${token}x`, code), false);
  assert.equal(manager.verify('incorrect', code), false);
  assert.equal(manager.verify(token, '999999'), false);
});

test('pairing tokens expire and rotation invalidates the previous token', () => {
  let currentTime = 5000;
  let byte = 1;
  const manager = createPairingManager({
    now: () => currentTime,
    randomBytes: (size) => Buffer.alloc(size, byte++),
    ttlMs: 1000,
  });

  const firstPairing = manager.rotate();
  const firstToken = tokenFromUrl(manager.buildControlUrl('http://localhost:9999'));
  currentTime += 999;
  assert.equal(manager.verify(firstToken, firstPairing.code), true);
  currentTime += 1;
  assert.equal(manager.verify(firstToken, firstPairing.code), false);

  const secondPairing = manager.rotate();
  const secondToken = tokenFromUrl(manager.buildControlUrl('http://localhost:9999'));
  assert.notEqual(secondToken, firstToken);
  assert.notEqual(secondPairing.code, null);
  assert.equal(manager.verify(firstToken, firstPairing.code), false);
  assert.equal(manager.verify(secondToken, secondPairing.code), true);
});

test('pairing manager enforces minimum entropy and lifetime', () => {
  assert.throws(() => createPairingManager({ tokenBytes: 8 }), /at least 16 random bytes/);
  assert.throws(() => createPairingManager({ ttlMs: 999 }), /at least one second/);
  assert.throws(() => createPairingManager({ codeDigits: 3 }), /4 to 8 digits/);
});
