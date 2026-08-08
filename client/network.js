const VIRTUAL_INTERFACE_MARKERS = [
  'docker',
  'veth',
  'vmnet',
  'virtualbox',
  'utun',
  'tailscale',
  'zerotier',
];

function isPrivateIPv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function scoreAddress(address, interfaceName) {
  const normalizedName = interfaceName.toLowerCase();
  let score = 0;

  if (/^(en0|en1|wi-?fi|wlan0|ethernet)/i.test(interfaceName)) score += 100;
  if (address.startsWith('192.168.')) score += 50;
  else if (address.startsWith('172.')) score += 40;
  else if (address.startsWith('10.')) score += 30;
  if (!isPrivateIPv4(address)) score -= 50;
  if (VIRTUAL_INTERFACE_MARKERS.some((marker) => normalizedName.includes(marker))) score -= 200;

  return score;
}

function listUsableIPv4(networkInterfaces) {
  const addresses = [];

  for (const [name, configs] of Object.entries(networkInterfaces || {})) {
    for (const config of configs || []) {
      const family = typeof config.family === 'string' ? config.family : String(config.family);
      if (family !== 'IPv4' && family !== '4') continue;
      if (config.internal || !config.address) continue;

      const octets = config.address.split('.').map(Number);
      const lastOctet = octets[3];
      if (octets.length !== 4 || lastOctet === 0 || lastOctet === 255) continue;

      addresses.push({
        name,
        address: config.address,
        netmask: config.netmask,
        priority: scoreAddress(config.address, name),
      });
    }
  }

  return addresses.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

function selectLocalAddress(networkInterfaces) {
  return listUsableIPv4(networkInterfaces)[0] || null;
}

module.exports = {
  isPrivateIPv4,
  listUsableIPv4,
  scoreAddress,
  selectLocalAddress,
};
