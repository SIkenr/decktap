const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const forgeConfig = require('../forge.config');

test('production packaging externalizes and includes the ws CommonJS runtime', async () => {
  const configUrl = pathToFileURL(path.resolve(__dirname, '..', 'vite.main.config.mjs'));
  const viteConfig = (await import(configUrl.href)).default;

  assert.equal(viteConfig.build.rollupOptions.external.includes('ws'), true);
  assert.equal(forgeConfig.packagerConfig.ignore('/node_modules/ws/package.json'), false);
});
