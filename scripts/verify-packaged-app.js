const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const asar = require('@electron/asar');
const { getCurrentFuseWire } = require('@electron/fuses');

const packageRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!packageRoot || !fs.existsSync(packageRoot)) {
  throw new Error('Usage: npm run verify:package -- <packaged-app-directory>');
}

const isMacOS = packageRoot.endsWith('.app') || fs.existsSync(path.join(packageRoot, 'Contents'));
const resourcesPath = isMacOS
  ? path.join(packageRoot, 'Contents', 'Resources')
  : path.join(packageRoot, 'resources');
const executablePath = isMacOS
  ? path.join(packageRoot, 'Contents', 'MacOS', 'decktap')
  : path.join(packageRoot, 'decktap.exe');
const appAsarPath = path.join(resourcesPath, 'app.asar');

for (const requiredPath of [executablePath, appAsarPath]) {
  assert.equal(fs.existsSync(requiredPath), true, `Missing packaged file: ${requiredPath}`);
}

const files = asar.listPackage(appAsarPath);
const mainBundle = asar.extractFile(appAsarPath, '.vite/build/main.js').toString('utf8');
const packagedMetadata = JSON.parse(asar.extractFile(appAsarPath, 'package.json').toString('utf8'));
const sourceMetadata = require(path.resolve(__dirname, '..', 'package.json'));

assert.equal(packagedMetadata.version, sourceMetadata.version, 'Packaged application version is stale');
assert.equal(files.includes('/node_modules/ws/package.json'), true, 'The external ws runtime is missing');
assert.match(mainBundle, /require\(["']ws["']\)/, 'The main bundle does not load external ws');
assert.doesNotMatch(mainBundle, /WS_NO_BUFFER_UTIL|bufferutil/, 'The broken optional ws accelerator stub was bundled');

if (!isMacOS) {
  assert.match(mainBundle, /-EncodedCommand/, 'The encoded Windows window adapter is missing');
  assert.doesNotMatch(mainBundle, /["']-Command["']/, 'The unsafe PowerShell command form is still bundled');
} else {
  const plistPath = path.join(packageRoot, 'Contents', 'Info.plist');
  const plist = fs.readFileSync(plistPath, 'utf8');
  const iconMatch = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
  assert.ok(iconMatch, 'The macOS bundle does not declare CFBundleIconFile');
  const iconFile = iconMatch[1].endsWith('.icns') ? iconMatch[1] : `${iconMatch[1]}.icns`;
  assert.equal(iconFile, 'icon.icns', 'The macOS bundle points at the wrong app icon');
  assert.equal(
    fs.existsSync(path.join(packageRoot, 'Contents', 'Resources', iconFile)),
    true,
    'The macOS bundle icon is missing from Contents/Resources',
  );
}

const nativePlatform = isMacOS ? 'darwin-x64+arm64' : 'win32-x64';
const nativePath = path.join(
  resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  '@jitsi',
  'robotjs',
  'prebuilds',
  nativePlatform,
  '@jitsi+robotjs.node',
);
assert.equal(fs.existsSync(nativePath), true, `RobotJS native binary is missing: ${nativePlatform}`);

void getCurrentFuseWire(executablePath).then((fuses) => {
  assert.equal(fuses[0], 48, 'RunAsNode fuse must be disabled');
  assert.equal(fuses[1], 49, 'Cookie encryption fuse must be enabled');
  assert.equal(fuses[2], 48, 'NODE_OPTIONS fuse must be disabled');
  assert.equal(fuses[3], 48, 'CLI inspect fuse must be disabled');
  assert.equal(fuses[4], 49, 'ASAR integrity fuse must be enabled');
  assert.equal(fuses[5], 49, 'OnlyLoadAppFromAsar fuse must be enabled');
  console.log(`Packaged ${isMacOS ? 'macOS' : 'Windows'} app verification passed (${packagedMetadata.version}).`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
