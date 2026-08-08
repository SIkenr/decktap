const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  formatDiagnosticSummary,
  readLogDiagnostics,
  sanitizeDiagnosticRecord,
} = require('../client/log-reader');

function createLogFile(t, contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-log-reader-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'decktap.log');
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

test('diagnostic records expose only an allowlisted summary', () => {
  assert.deepEqual(sanitizeDiagnosticRecord({
    timestamp: '2026-08-08T00:00:00.000Z',
    level: 'error',
    component: 'lan-service',
    event: 'command.failed',
    message: 'Command failed.\nRetry later. token=visible-secret',
    pid: 42,
    sessionId: 'private-session',
    stack: '/private/path',
  }), {
    timestamp: '2026-08-08T00:00:00.000Z',
    level: 'error',
    component: 'lan-service',
    event: 'command.failed',
    message: 'Command failed. Retry later. token=[REDACTED]',
  });
});

test('log reader filters, limits, reverses recent records, and ignores malformed lines', (t) => {
  const records = [
    { timestamp: '2026-08-08T00:00:00.000Z', level: 'info', event: 'service.started', message: 'Started' },
    { timestamp: '2026-08-08T00:00:01.000Z', level: 'warn', event: 'network.changed', message: 'Changed' },
    { timestamp: '2026-08-08T00:00:02.000Z', level: 'error', event: 'command.failed', message: 'Failed' },
  ];
  const filePath = createLogFile(t, `${records.map(JSON.stringify).join('\n')}\nnot-json\n`);
  const diagnostics = readLogDiagnostics({
    filePath,
    level: 'all',
    limit: 2,
    now: () => 1234,
  });

  assert.deepEqual(diagnostics.records.map(({ event }) => event), ['command.failed', 'network.changed']);
  assert.deepEqual(diagnostics.counts, { debug: 0, info: 1, warn: 1, error: 1 });
  assert.equal(diagnostics.malformedLines, 1);
  assert.equal(diagnostics.updatedAt, 1234);

  const errors = readLogDiagnostics({ filePath, level: 'error' });
  assert.deepEqual(errors.records.map(({ level }) => level), ['error']);
});

test('log reader combines archives and returns an empty result for a missing log', (t) => {
  const filePath = createLogFile(t, `${JSON.stringify({
    timestamp: '2026-08-08T00:00:02.000Z', level: 'info', event: 'current', message: 'Current',
  })}\n`);
  fs.writeFileSync(`${filePath}.1`, `${JSON.stringify({
    timestamp: '2026-08-08T00:00:01.000Z', level: 'warn', event: 'archive', message: 'Archive',
  })}\n`);

  assert.deepEqual(
    readLogDiagnostics({ filePath }).records.map(({ event }) => event),
    ['current', 'archive'],
  );
  assert.deepEqual(readLogDiagnostics({ filePath: `${filePath}.missing` }).records, []);
});

test('diagnostic summary contains sanitized records without internal identifiers', (t) => {
  const filePath = createLogFile(t, `${JSON.stringify({
    timestamp: '2026-08-08T00:00:00.000Z',
    level: 'error',
    event: 'command.failed',
    message: 'Safe message',
    pid: 99,
    sessionId: 'secret-session',
  })}\n`);
  const summary = formatDiagnosticSummary(
    readLogDiagnostics({ filePath, now: () => Date.parse('2026-08-08T00:01:00.000Z') }),
    { version: '1.0.0', platform: 'darwin' },
  );

  assert.match(summary, /DeckTap 1\.0\.0/);
  assert.match(summary, /command\.failed: Safe message/);
  assert.doesNotMatch(summary, /secret-session|pid|99/);
});
