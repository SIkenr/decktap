const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isPrivateIPv4,
  listUsableIPv4,
  selectLocalAddress,
} = require('../client/network');

test('private IPv4 detection covers RFC1918 ranges', () => {
  assert.equal(isPrivateIPv4('10.0.0.8'), true);
  assert.equal(isPrivateIPv4('172.16.0.8'), true);
  assert.equal(isPrivateIPv4('172.31.255.8'), true);
  assert.equal(isPrivateIPv4('192.168.1.8'), true);
  assert.equal(isPrivateIPv4('172.32.0.8'), false);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  assert.equal(isPrivateIPv4('invalid'), false);
});

test('network selection prefers a physical Wi-Fi interface over virtual adapters', () => {
  const interfaces = {
    docker0: [{ family: 'IPv4', address: '172.17.0.1', netmask: '255.255.0.0', internal: false }],
    en0: [{ family: 'IPv4', address: '192.168.1.25', netmask: '255.255.255.0', internal: false }],
    utun5: [{ family: 4, address: '10.8.0.2', netmask: '255.255.255.0', internal: false }],
    lo0: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
  };

  assert.equal(selectLocalAddress(interfaces).address, '192.168.1.25');
  assert.deepEqual(listUsableIPv4(interfaces).map(({ name }) => name), ['en0', 'docker0', 'utun5']);
});

test('network selection returns null when no usable IPv4 address exists', () => {
  assert.equal(selectLocalAddress({ lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }), null);
});
