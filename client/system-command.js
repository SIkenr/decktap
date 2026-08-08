const { execFile: defaultExecFile } = require('node:child_process');

class SystemCommandError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'SystemCommandError';
    this.code = code;
  }
}

function runSystemCommand(executable, args, options = {}) {
  const execFile = options.execFile || defaultExecFile;
  const timeout = options.timeout ?? 4_000;
  const maxBuffer = options.maxBuffer ?? 512 * 1024;

  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      encoding: 'utf8',
      ...(options.env ? { env: options.env } : {}),
      windowsHide: true,
      timeout,
      maxBuffer,
    }, (error, stdout, stderr) => {
      if (error) {
        const commandError = new SystemCommandError(
          error.killed ? 'WINDOW_COMMAND_TIMEOUT' : 'WINDOW_COMMAND_FAILED',
          'The platform window command failed.',
        );
        commandError.details = {
          exitCode: error.code ?? null,
          killed: Boolean(error.killed),
          signal: error.signal || null,
          stderr: String(stderr || error.stderr || '').trim().slice(0, 2000),
        };
        reject(commandError);
        return;
      }

      const output = String(stdout || '').trim();
      if (!output) {
        reject(new SystemCommandError('WINDOW_COMMAND_EMPTY', 'The platform window command returned no result.'));
        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch (cause) {
        reject(new SystemCommandError(
          'WINDOW_COMMAND_INVALID',
          'The platform window command returned an invalid result.',
          { cause },
        ));
      }
    });
  });
}

module.exports = { SystemCommandError, runSystemCommand };
