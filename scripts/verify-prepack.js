const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const forgeConfig = require(path.join(projectRoot, 'forge.config.js'));

function requireFile(relativePath, label = relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  assert.equal(fs.existsSync(absolutePath), true, `${label} is missing: ${relativePath}`);
}

assert.equal(packageJson.private, true, 'The desktop package must remain private');
assert.equal(packageJson.dependencies['@jitsi/robotjs'], '0.6.24', 'RobotJS must stay pinned to the verified release');
assert.equal(forgeConfig.packagerConfig.asar, true, 'ASAR packaging must remain enabled');
assert.equal(
  forgeConfig.packagerConfig.appBundleId,
  'io.github.rico00121.decktap',
  'A stable macOS bundle identifier is required',
);
assert.equal(
  forgeConfig.packagerConfig.ignore('/node_modules/@jitsi/robotjs/package.json'),
  false,
  'RobotJS must be included outside the application bundle',
);
assert.equal(
  forgeConfig.packagerConfig.ignore('/node_modules/ws/package.json'),
  false,
  'The externalized ws runtime must be included in the application package',
);

const pluginNames = forgeConfig.plugins.map((plugin) => plugin.constructor.name);
assert.equal(pluginNames.includes('AutoUnpackNativesPlugin'), true, 'Native modules must be unpacked from ASAR');
assert.equal(pluginNames.includes('FusesPlugin'), true, 'Electron runtime fuses must be configured');
assert.equal(pluginNames.includes('VitePlugin'), true, 'Electron entry points must be bundled with Vite');

const makerNames = forgeConfig.makers.map((maker) => maker.constructor.name);
for (const makerName of ['MakerSquirrel', 'MakerZIP', 'MakerDMG']) {
  assert.equal(makerNames.includes(makerName), true, `${makerName} is not configured`);
}

for (const relativePath of [
  'decktap-web/dist/index.html',
  'desktop/src/App.tsx',
  'electron/main.js',
  'electron/preload.js',
  'node_modules/@jitsi/robotjs/prebuilds/darwin-x64+arm64/@jitsi+robotjs.node',
  'node_modules/@jitsi/robotjs/prebuilds/win32-x64/@jitsi+robotjs.node',
]) {
  requireFile(relativePath);
}

console.log('Pre-package verification passed.');
console.log('Validated: web assets, Electron entry points, security fuses, makers, bundle ID, and native prebuilds.');
console.log('Not executed: electron-forge package/make, code signing, notarization, or installer launch tests.');
