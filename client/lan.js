const path = require('node:path');
const qrcode = require('qrcode-terminal');

const { createKeyboardController } = require('./keyboard');
const { createLanService } = require('./lan-service');
const { createLogger } = require('./logger');

function parsePort(value) {
  if (value === undefined) return 9999;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

function createDefaultLogger() {
  return createLogger({
    level: process.env.DECKTAP_LOG_LEVEL || 'info',
    logDir: process.env.DECKTAP_LOG_DIR || path.join(process.cwd(), 'logs'),
  });
}

async function main(options = {}) {
  const logger = options.logger || createDefaultLogger();
  const appLogger = logger.child('cli');
  appLogger.info('app.starting', 'DeckTap is starting.', { nodeVersion: process.version });

  const service = createLanService({
    port: parsePort(process.env.PORT),
    staticPath: path.join(__dirname, '..', 'decktap-web', 'dist'),
    keyboardController: createKeyboardController(),
    logger: logger.child('lan-service'),
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    appLogger.info('app.signal.received', 'DeckTap received a shutdown signal.', { signal });
    console.log(`\n🛑 Received ${signal}; stopping DeckTap...`);
    try {
      await service.stop();
      appLogger.info('app.stopped', 'DeckTap stopped cleanly.', { signal });
      logger.close();
    } catch (error) {
      appLogger.error('app.stop.failed', 'DeckTap failed to stop cleanly.', { error, signal });
      console.error('❌ Failed to stop DeckTap cleanly:', error);
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const info = await service.start();
  appLogger.info('app.started', 'DeckTap is ready for controller connections.', {
    port: info.port,
    interfaceName: info.interfaceName,
  });

  console.log(`\n✅ DeckTap LAN service has started: ${info.controlUrl}`);
  console.log('\n🔗 Open this URL on a phone connected to the same Wi-Fi, or scan the QR code:\n');
  qrcode.generate(info.controlUrl, { small: true });
}

if (require.main === module) {
  const logger = createDefaultLogger();
  main({ logger }).catch((error) => {
    logger.child('cli').error('app.start.failed', 'DeckTap failed to start.', { error });
    console.error('❌ DeckTap failed to start:', error);
    logger.close();
    process.exitCode = 1;
  });
}

module.exports = { createDefaultLogger, main, parsePort };
