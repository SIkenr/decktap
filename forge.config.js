const { MakerDMG } = require('@electron-forge/maker-dmg');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { VitePlugin } = require('@electron-forge/plugin-vite');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('node:path');

// Linux can assemble an unsigned macOS test bundle, but cannot run Apple's
// codesign tool after changing Electron's fuse wire. This opt-in is only for a
// cross-built test artifact that will be ad-hoc signed on the destination Mac.
const isDarwinCrossPackage = process.env.DECKTAP_DARWIN_CROSS_PACKAGE === '1';

function ignoreUnbundledFiles(file) {
  if (!file) return false;
  if (file.startsWith('/.vite')) return false;

  // The Vite plugin bundles application JavaScript, but RobotJS must remain a
  // real Node package so node-gyp-build can locate its platform prebuild.
  if (file === '/node_modules' || file === '/node_modules/@jitsi') return false;
  if (file.startsWith('/node_modules/@jitsi/robotjs')) return false;
  if (file.startsWith('/node_modules/node-gyp-build')) return false;
  if (file.startsWith('/node_modules/ws')) return false;

  return true;
}

module.exports = {
  packagerConfig: {
    appBundleId: 'io.github.rico00121.decktap',
    asar: true,
    executableName: 'decktap',
    extendInfo: {
      CFBundleIconFile: 'icon.icns',
    },
    icon: path.join(__dirname, 'assets', 'icon'),
    extraResource: ['decktap-web/dist', path.join(__dirname, 'assets', 'icon.icns')],
    ignore: ignoreUnbundledFiles,
    usageDescription: {
      AppleEvents: 'DeckTap uses System Events to identify and restore the presentation window you explicitly lock.',
    },
  },
  rebuildConfig: {
    // RobotJS ships Node-API prebuilds, including macOS universal. Preserve
    // those artifacts instead of replacing them with a host-only rebuild.
    ignoreModules: ['@jitsi/robotjs'],
  },
  makers: [
    new MakerSquirrel({ name: 'DeckTap' }, ['win32']),
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDMG({}, ['darwin']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'electron/main.js',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          entry: 'electron/preload.js',
          config: 'vite.preload.config.mjs',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      ...(isDarwinCrossPackage ? { resetAdHocDarwinSignature: false } : {}),
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
