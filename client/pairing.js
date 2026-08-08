const { randomBytes, randomInt, timingSafeEqual } = require('node:crypto');

const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TOKEN_BYTES = 32;
const DEFAULT_PAIRING_CODE_DIGITS = 6;

function createPairingManager(options = {}) {
  const now = options.now || Date.now;
  const randomBytesProvider = options.randomBytes || randomBytes;
  const randomIntProvider = options.randomInt || randomInt;
  const tokenBytes = options.tokenBytes ?? DEFAULT_TOKEN_BYTES;
  const ttlMs = options.ttlMs ?? DEFAULT_PAIRING_TTL_MS;
  const codeDigits = options.codeDigits ?? DEFAULT_PAIRING_CODE_DIGITS;

  if (!Number.isInteger(tokenBytes) || tokenBytes < 16) {
    throw new TypeError('Pairing tokens must contain at least 16 random bytes');
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 1000) {
    throw new TypeError('Pairing token lifetime must be at least one second');
  }
  if (!Number.isInteger(codeDigits) || codeDigits < 4 || codeDigits > 8) {
    throw new TypeError('Pairing codes must contain 4 to 8 digits');
  }

  let token = null;
  let code = null;
  let expiresAt = 0;

  function rotate() {
    token = randomBytesProvider(tokenBytes).toString('base64url');
    code = randomIntProvider(0, 10 ** codeDigits).toString().padStart(codeDigits, '0');
    expiresAt = now() + ttlMs;
    return { code, expiresAt };
  }

  function safelyMatches(candidate, expected, maxLength) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > maxLength) return false;
    if (!expected || now() >= expiresAt) return false;

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(candidate, 'utf8');
    return expectedBuffer.length === receivedBuffer.length
      && timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  function verifyToken(candidate) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 128) return false;
    return safelyMatches(candidate, token, 128);
  }

  function verifyCode(candidate) {
    return typeof candidate === 'string'
      && /^\d+$/.test(candidate)
      && safelyMatches(candidate, code, codeDigits);
  }

  function verify(candidateToken, candidateCode) {
    return verifyToken(candidateToken) && verifyCode(candidateCode);
  }

  function buildControlUrl(baseUrl) {
    if (!token) throw new Error('Pairing token has not been generated');
    const url = new URL(baseUrl);
    url.hash = `pairing=${encodeURIComponent(token)}`;
    return url.toString();
  }

  return {
    buildControlUrl,
    getState: () => ({ code, expiresAt, expired: !token || !code || now() >= expiresAt }),
    rotate,
    verify,
    verifyCode,
    verifyToken,
  };
}

module.exports = {
  DEFAULT_PAIRING_CODE_DIGITS,
  DEFAULT_PAIRING_TTL_MS,
  DEFAULT_TOKEN_BYTES,
  createPairingManager,
};
