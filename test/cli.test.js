const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');

test('CLI handles SIGINT, records lifecycle events, and exits cleanly', { timeout: 5000 }, async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-cli-test-'));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'client', 'lan.js')], {
    env: { ...process.env, DECKTAP_LOG_DIR: logDir, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let signalSent = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (!signalSent && stdout.includes('DeckTap LAN service has started')) {
      signalSent = true;
      child.kill('SIGINT');
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const [code, signal] = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });

  assert.equal(code, 0, stderr);
  assert.equal(signal, null);
  assert.match(stdout, /Received SIGINT; stopping DeckTap/);

  const records = fs.readFileSync(path.join(logDir, 'decktap.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(records.some(({ event }) => event === 'service.started'));
  assert.ok(records.some(({ event }) => event === 'app.signal.received'));
  assert.ok(records.some(({ event }) => event === 'service.stopped'));
  assert.ok(records.some(({ event }) => event === 'app.stopped'));
});
