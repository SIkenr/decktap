const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('application bundle icons come from the generated DeckTap assets', () => {
  const iconBase = path.join(__dirname, '..', 'assets', 'icon');

  assert.equal(forgeConfig.packagerConfig.icon, iconBase);
  assert.equal(forgeConfig.packagerConfig.extendInfo.CFBundleIconFile, 'icon.icns');
  assert.equal(forgeConfig.packagerConfig.extraResource.includes(`${iconBase}.icns`), true);
  assert.equal(fs.existsSync(`${iconBase}.icns`), true, 'macOS bundle icon is missing');
  assert.equal(fs.existsSync(`${iconBase}.ico`), true, 'Windows executable icon is missing');
  assert.equal(fs.existsSync(`${iconBase}.png`), true, 'PNG icon source is missing');
});
