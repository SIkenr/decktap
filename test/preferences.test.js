const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_PREFERENCES,
  createPreferencesStore,
  sanitizePreferences,
} = require('../client/preferences');

test('preferences use safe defaults and sanitize stored values', () => {
  assert.deepEqual(sanitizePreferences({}), DEFAULT_PREFERENCES);
  assert.deepEqual(sanitizePreferences({ pageTurnMode: 'horizontal', themeSource: 'dark' }), {
    closeToTray: false,
    customApps: [],
    lastLockedAppId: null,
    launchAtLogin: false,
    pageTurnMode: 'horizontal',
    startServiceOnLaunch: true,
    themeSource: 'dark',
  });
  assert.deepEqual(sanitizePreferences({ pageTurnMode: 'diagonal', themeSource: 'neon' }), DEFAULT_PREFERENCES);
});

test('preferences persist theme and page-turn mode', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-preferences-'));
  const filePath = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const store = createPreferencesStore({ filePath });
  store.setThemeSource('dark');
  store.setPageTurnMode('horizontal');

  const reloaded = createPreferencesStore({ filePath });
  assert.deepEqual(reloaded.get(), {
    closeToTray: false,
    customApps: [],
    lastLockedAppId: null,
    launchAtLogin: false,
    pageTurnMode: 'horizontal',
    startServiceOnLaunch: true,
    themeSource: 'dark',
  });
});

test('preferences migrate and persist desktop lifecycle settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-preferences-'));
  const filePath = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, JSON.stringify({ themeSource: 'dark' }));

  const store = createPreferencesStore({ filePath });
  assert.equal(store.get().startServiceOnLaunch, true);
  assert.equal(store.get().closeToTray, false);
  assert.equal(store.get().launchAtLogin, false);

  store.setStartServiceOnLaunch(false);
  store.setCloseToTray(true);
  store.setLaunchAtLogin(true);
  const reloaded = createPreferencesStore({ filePath });
  assert.equal(reloaded.get().startServiceOnLaunch, false);
  assert.equal(reloaded.get().closeToTray, true);
  assert.equal(reloaded.get().launchAtLogin, true);
});

test('preferences reject non-boolean lifecycle settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-preferences-'));
  const filePath = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createPreferencesStore({ filePath });

  assert.throws(() => store.setCloseToTray('yes'), /boolean preference/);
  assert.throws(() => store.setLaunchAtLogin(1), /boolean preference/);
  assert.throws(() => store.setStartServiceOnLaunch(null), /boolean preference/);
});

test('preferences persist and remove sanitized custom applications', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-preferences-'));
  const filePath = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createPreferencesStore({ filePath });

  store.addCustomApp({
    id: 'custom-vlc',
    displayName: 'Studio Player',
    platform: 'win32',
    appName: 'vlc',
    bundleId: '',
    ignored: 'not persisted',
  });
  assert.deepEqual(store.get().customApps, [{
    id: 'custom-vlc',
    displayName: 'Studio Player',
    platform: 'win32',
    appName: 'vlc',
    bundleId: '',
  }]);
  store.setLastLockedAppId('custom-vlc');
  store.removeCustomApp('custom-vlc');
  assert.deepEqual(store.get().customApps, []);
  assert.equal(store.get().lastLockedAppId, null);
});

test('preferences persist the last locked application rule', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-preferences-'));
  const filePath = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createPreferencesStore({ filePath });

  store.setLastLockedAppId('powerpoint');
  assert.equal(createPreferencesStore({ filePath }).get().lastLockedAppId, 'powerpoint');
  store.setLastLockedAppId(null);
  assert.equal(store.get().lastLockedAppId, null);
  assert.throws(() => store.setLastLockedAppId(''), /non-empty string/);
});

test('preferences reject unsupported values without overwriting settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-preferences-'));
  const filePath = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createPreferencesStore({ filePath });

  assert.throws(() => store.setThemeSource('neon'), /Unsupported theme source/);
  assert.throws(() => store.setPageTurnMode('diagonal'), /Unsupported page-turn mode/);
  assert.deepEqual(store.get(), DEFAULT_PREFERENCES);
});
