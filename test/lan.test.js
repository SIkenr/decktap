const assert = require('node:assert/strict');
const test = require('node:test');

const { parsePort } = require('../client/lan');

test('parsePort uses the default and accepts valid ports', () => {
  assert.equal(parsePort(undefined), 9999);
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('65535'), 65535);
});

test('parsePort rejects invalid values', () => {
  for (const value of ['-1', '65536', '1.5', 'not-a-port']) {
    assert.throws(() => parsePort(value), /Invalid PORT value/);
  }
});
