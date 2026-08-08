const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { isPrivateIPv4 } = require('./network');

const DEFAULT_TRUST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TRUST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRUST_HISTORY = 50;

function normalizeClientAddress(candidate) {
  if (typeof candidate !== 'string') return null;
  let address = candidate.trim().toLowerCase();
  if (address.startsWith('::ffff:')) address = address.slice(7);

  if (net.isIPv4(address)) {
    return address === '127.0.0.1' || isPrivateIPv4(address) ? address : null;
  }
  if (!net.isIPv6(address)) return null;
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) {
    return address;
  }
  return null;
}

function createTrustedClientStore(options = {}) {
  const filePath = options.filePath;
  const fileSystem = options.fileSystem || fs;
  const now = options.now || Date.now;
  const createId = options.createId || randomUUID;
  const ttlMs = options.ttlMs ?? DEFAULT_TRUST_TTL_MS;
  if (!filePath) throw new TypeError('A trusted-client store path is required');
  if (!Number.isFinite(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_TRUST_TTL_MS) {
    throw new TypeError('Trusted-client lifetime must be between one minute and seven days');
  }

  let active = null;
  let history = [];

  function sanitizeRecord(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const id = String(candidate.id || '').slice(0, 80);
    const pairedAt = Number(candidate.pairedAt);
    const revokedAt = Number(candidate.revokedAt);
    const reason = ['expired', 'manual', 'replaced', 'rotated'].includes(candidate.reason)
      ? candidate.reason
      : 'manual';
    if (!id || !Number.isFinite(pairedAt) || !Number.isFinite(revokedAt)) return null;
    return { id, pairedAt, reason, revokedAt };
  }

  function save() {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fileSystem.writeFileSync(filePath, `${JSON.stringify({ active, history }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  function archiveActive(reason) {
    if (!active) return false;
    history = [{
      id: active.id,
      pairedAt: active.pairedAt,
      reason,
      revokedAt: now(),
    }, ...history].slice(0, MAX_TRUST_HISTORY);
    active = null;
    return true;
  }

  function prune() {
    if (!active || active.expiresAt > now()) return false;
    archiveActive('expired');
    return true;
  }

  try {
    const stored = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    const address = normalizeClientAddress(stored.active?.address);
    if (
      address
      && typeof stored.active?.id === 'string'
      && Number.isFinite(stored.active?.pairedAt)
      && Number.isFinite(stored.active?.expiresAt)
    ) {
      active = {
        address,
        expiresAt: stored.active.expiresAt,
        id: stored.active.id.slice(0, 80),
        pairedAt: stored.active.pairedAt,
      };
    }
    if (Array.isArray(stored.history)) {
      history = stored.history.map(sanitizeRecord).filter(Boolean).slice(0, MAX_TRUST_HISTORY);
    }
    if (prune()) save();
  } catch (error) {
    if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
  }

  return {
    clear(reason = 'rotated') {
      if (!archiveActive(reason)) return 0;
      save();
      return 1;
    },
    count() {
      if (prune()) save();
      return active ? 1 : 0;
    },
    getHistory() {
      if (prune()) save();
      return history.map(({ id, pairedAt, reason, revokedAt }) => ({ id, pairedAt, reason, revokedAt }));
    },
    isTrusted(candidate) {
      const address = normalizeClientAddress(candidate);
      if (!address) return false;
      if (prune()) save();
      return active?.address === address;
    },
    revoke(candidate, reason = 'manual') {
      const address = normalizeClientAddress(candidate);
      if (!address || active?.address !== address) return false;
      archiveActive(reason);
      save();
      return true;
    },
    trust(candidate) {
      const address = normalizeClientAddress(candidate);
      if (!address) return false;
      prune();
      if (active?.address === address) {
        active.expiresAt = now() + ttlMs;
      } else {
        archiveActive('replaced');
        active = {
          address,
          expiresAt: now() + ttlMs,
          id: String(createId()).slice(0, 80),
          pairedAt: now(),
        };
      }
      save();
      return true;
    },
  };
}

module.exports = {
  DEFAULT_TRUST_TTL_MS,
  MAX_TRUST_HISTORY,
  createTrustedClientStore,
  normalizeClientAddress,
};
