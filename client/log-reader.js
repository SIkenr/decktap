const fs = require('node:fs');

const { redactString } = require('./logger');

const DIAGNOSTIC_LEVELS = new Set(['all', 'debug', 'info', 'warn', 'error']);
const MAX_DIAGNOSTIC_RECORDS = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_LOG_FILES = 5;

function safeText(value, maxLength) {
  return redactString(String(value || ''))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeDiagnosticRecord(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  if (!['debug', 'info', 'warn', 'error'].includes(candidate.level)) return null;
  const timestamp = safeText(candidate.timestamp, 40);
  const event = safeText(candidate.event, 100);
  const message = safeText(candidate.message, 500);
  if (!timestamp || !event || !message || Number.isNaN(Date.parse(timestamp))) return null;
  return Object.freeze({
    timestamp,
    level: candidate.level,
    component: safeText(candidate.component || 'application', 80),
    event,
    message,
  });
}

function readFileTail(filePath, fileSystem, maxBytes) {
  const stat = fileSystem.statSync(filePath);
  const bytesToRead = Math.min(stat.size, maxBytes);
  if (bytesToRead <= 0) return '';
  const descriptor = fileSystem.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    fileSystem.readSync(descriptor, buffer, 0, bytesToRead, stat.size - bytesToRead);
    let content = buffer.toString('utf8');
    if (bytesToRead < stat.size) {
      const firstNewline = content.indexOf('\n');
      content = firstNewline >= 0 ? content.slice(firstNewline + 1) : '';
    }
    return content;
  } finally {
    fileSystem.closeSync(descriptor);
  }
}

function readLogDiagnostics(options = {}) {
  const filePath = options.filePath;
  const fileSystem = options.fileSystem || fs;
  const level = DIAGNOSTIC_LEVELS.has(options.level) ? options.level : 'all';
  const limit = Math.max(1, Math.min(MAX_DIAGNOSTIC_RECORDS, Number(options.limit) || 100));
  const now = options.now || Date.now;
  if (!filePath) throw new TypeError('A fixed log file path is required');

  const files = [];
  for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
    const archivePath = `${filePath}.${index}`;
    if (fileSystem.existsSync(archivePath)) files.push(archivePath);
  }
  if (fileSystem.existsSync(filePath)) files.push(filePath);

  const counts = { debug: 0, info: 0, warn: 0, error: 0 };
  const records = [];
  let malformedLines = 0;

  for (const currentPath of files) {
    const content = readFileTail(currentPath, fileSystem, MAX_FILE_BYTES);
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      const record = sanitizeDiagnosticRecord(parsed);
      if (!record) {
        malformedLines += 1;
        continue;
      }
      counts[record.level] += 1;
      if (level === 'all' || record.level === level) records.push(record);
    }
  }

  return Object.freeze({
    counts: Object.freeze(counts),
    malformedLines,
    records: Object.freeze(records.slice(-limit).reverse()),
    updatedAt: now(),
  });
}

function formatDiagnosticSummary(diagnostics, appInfo = {}) {
  const header = [
    `DeckTap ${safeText(appInfo.version || 'unknown', 40)}`,
    `Platform: ${safeText(appInfo.platform || 'unknown', 40)}`,
    `Generated: ${new Date(diagnostics.updatedAt).toISOString()}`,
    `Counts: error=${diagnostics.counts.error}, warn=${diagnostics.counts.warn}, info=${diagnostics.counts.info}, debug=${diagnostics.counts.debug}`,
  ];
  const lines = diagnostics.records.map((record) => (
    `${record.timestamp} ${record.level.toUpperCase()} ${record.component} ${record.event}: ${record.message}`
  ));
  return `${[...header, '', ...lines].join('\n')}\n`;
}

module.exports = {
  DIAGNOSTIC_LEVELS,
  MAX_DIAGNOSTIC_RECORDS,
  formatDiagnosticSummary,
  readLogDiagnostics,
  sanitizeDiagnosticRecord,
};
