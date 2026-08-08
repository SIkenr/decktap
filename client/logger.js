const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
});

const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|pairing|secret|token)/i;
const REDACTED = '[REDACTED]';

function redactString(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/([#?&](?:api_?key|code|pairing|pairing_?token|password|secret|token)=)[^&#\s]+/gi, `$1${REDACTED}`)
    .replace(/((?:authorization|cookie|password|pairing(?:Code|Token)?|secret|token)\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`);
}

function sanitizeValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return redactString(value).slice(0, 4000);
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (depth >= 6) return '[MaxDepth]';

  if (value instanceof Error) {
    return sanitizeValue({
      name: value.name,
      message: value.message,
      code: value.code,
      stack: value.stack,
      cause: value.cause,
      details: value.details,
    }, seen, depth + 1);
  }

  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return redactString(String(value));
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, seen, depth + 1));
  }

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeValue(item, seen, depth + 1);
  }
  return result;
}

function rotateLogs(filePath, maxFiles) {
  if (maxFiles <= 1) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }

  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    const destination = `${filePath}.${index + 1}`;
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    fs.renameSync(source, destination);
  }

  if (fs.existsSync(filePath)) {
    const firstArchive = `${filePath}.1`;
    if (fs.existsSync(firstArchive)) fs.unlinkSync(firstArchive);
    fs.renameSync(filePath, firstArchive);
  }
}

function createLogger(options = {}) {
  const levelName = Object.hasOwn(LOG_LEVELS, options.level) ? options.level : 'info';
  const threshold = LOG_LEVELS[levelName];
  const sessionId = options.sessionId || randomUUID();
  const now = options.now || (() => new Date());
  const consoleTarget = options.consoleTarget === false ? null : (options.consoleTarget || console);
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxFiles = Math.max(1, options.maxFiles ?? 5);
  const fileName = options.fileName || 'decktap.log';
  const logDir = options.logDir === false ? null : (options.logDir || path.join(process.cwd(), 'logs'));
  const filePath = logDir ? path.join(logDir, fileName) : null;
  let fileLoggingAvailable = Boolean(filePath);
  let fileFailureReported = false;

  if (fileLoggingAvailable) {
    try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      fileLoggingAvailable = false;
      if (consoleTarget) consoleTarget.warn('DeckTap file logging is unavailable:', error.message);
    }
  }

  function writeFile(line) {
    if (!fileLoggingAvailable) return;

    try {
      const currentSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      if (currentSize > 0 && currentSize + Buffer.byteLength(line) > maxBytes) {
        rotateLogs(filePath, maxFiles);
      }
      fs.appendFileSync(filePath, line, { encoding: 'utf8', flag: 'a', mode: 0o600 });
    } catch (error) {
      fileLoggingAvailable = false;
      if (!fileFailureReported && consoleTarget) {
        fileFailureReported = true;
        consoleTarget.warn('DeckTap stopped writing log files:', error.message);
      }
    }
  }

  function emit(baseContext, level, event, message, context = {}) {
    if (LOG_LEVELS[level] < threshold) return;

    const safeContext = sanitizeValue({ ...baseContext, ...context });
    const record = {
      timestamp: now().toISOString(),
      level,
      event,
      message: redactString(message),
      sessionId,
      pid: process.pid,
      ...safeContext,
    };
    const line = `${JSON.stringify(record)}\n`;
    writeFile(line);

    if (consoleTarget) {
      const method = level === 'debug' ? 'debug' : level;
      const contextText = Object.keys(safeContext).length > 0 ? ` ${JSON.stringify(safeContext)}` : '';
      consoleTarget[method](`[${record.timestamp}] ${level.toUpperCase()} ${event}: ${record.message}${contextText}`);
    }
  }

  function buildLogger(baseContext = {}) {
    return {
      debug: (event, message, context) => emit(baseContext, 'debug', event, message, context),
      info: (event, message, context) => emit(baseContext, 'info', event, message, context),
      warn: (event, message, context) => emit(baseContext, 'warn', event, message, context),
      error: (event, message, context) => emit(baseContext, 'error', event, message, context),
      child: (component, context = {}) => buildLogger({ ...baseContext, ...context, component }),
      close: () => {},
      getLogFilePath: () => filePath,
      getSessionId: () => sessionId,
    };
  }

  return buildLogger(options.context || {});
}

module.exports = { LOG_LEVELS, REDACTED, createLogger, redactString, sanitizeValue };
