const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCustomAppFromWindow,
  createMediaTargetService,
  findBuiltInRule,
  QUICK_TARGET_RULE_IDS,
} = require('../client/media-targets');

const powerPointWindow = {
  id: 'window-powerpoint',
  processId: 10,
  appName: 'POWERPNT',
  windowClass: 'screenClass',
  title: 'Confidential quarterly plan',
  platform: 'win32',
};

const powerPointEditorWindow = {
  ...powerPointWindow,
  id: 'window-powerpoint-editor',
  processId: 9,
  windowClass: 'PPTFrameClass',
  title: 'Confidential quarterly plan - PowerPoint',
};

const notesWindow = {
  id: 'window-notes',
  processId: 11,
  appName: 'notepad',
  title: 'Private notes',
  platform: 'win32',
};

function createService(windows, options = {}) {
  let sequence = 0;
  const locked = [];
  const targetWindowController = {
    getTarget: () => locked.at(-1) || null,
    async lock(window) {
      locked.push(window);
    },
  };
  return {
    locked,
    service: createMediaTargetService({
      adapter: { async listWindows() { return windows; } },
      targetWindowController,
      createCandidateId: () => `candidate-${++sequence}`,
      getCustomApps: options.getCustomApps,
    }),
  };
}

test('built-in media rules recognize common presentation applications', () => {
  assert.deepEqual(QUICK_TARGET_RULE_IDS, [
    'keynote',
    'powerpoint',
    'wps-presentation',
    'propresenter',
    'perfectcast',
  ]);
  assert.equal(findBuiltInRule(powerPointWindow)?.id, 'powerpoint');
  assert.equal(findBuiltInRule({
    ...powerPointWindow,
    appName: 'Keynote',
    bundleId: 'com.apple.Keynote',
    platform: 'darwin',
    title: 'PowerPoint Slide Show - Quarterly review',
  })?.id, 'keynote');
  assert.equal(findBuiltInRule({ ...powerPointWindow, appName: 'wppshow', windowClass: '' })?.id, 'wps-presentation');
  assert.equal(findBuiltInRule({ ...powerPointWindow, appName: 'ProPresenter' })?.id, 'propresenter');
  assert.equal(findBuiltInRule({ ...powerPointWindow, appName: 'PerfectCast' })?.id, 'perfectcast');
  assert.equal(findBuiltInRule(notesWindow), null);
  assert.equal(findBuiltInRule(powerPointEditorWindow), null);
});

test('quick rule locks a single running application and preserves its rule identity', async () => {
  const { locked, service } = createService([notesWindow, powerPointEditorWindow, powerPointWindow]);
  const result = await service.lockRule('powerpoint');

  assert.equal(result.outcome, 'locked');
  assert.equal(result.ruleId, 'powerpoint');
  assert.equal(result.target.appName, 'POWERPNT');
  assert.deepEqual(locked, [powerPointWindow]);
});

test('PowerPoint and WPS editor windows are excluded from playback targeting', async () => {
  const wpsEditor = {
    ...powerPointEditorWindow,
    id: 'wps-editor',
    appName: 'wpp',
    windowClass: 'Qt5152QWindowIcon',
  };
  const wpsPlayback = {
    ...powerPointWindow,
    id: 'wps-playback',
    appName: 'wppshow',
    windowClass: '',
  };
  const { locked, service } = createService([
    powerPointEditorWindow,
    powerPointWindow,
    wpsEditor,
    wpsPlayback,
  ]);

  assert.equal((await service.lockRule('powerpoint')).outcome, 'locked');
  assert.equal(locked.at(-1).id, powerPointWindow.id);
  assert.equal((await service.lockRule('wps-presentation')).outcome, 'locked');
  assert.equal(locked.at(-1).id, wpsPlayback.id);
});

test('remembered rule rebinds only after one playback window appears', async () => {
  const windows = [powerPointEditorWindow];
  const { locked, service } = createService(windows);

  assert.equal((await service.rebindRule('powerpoint')).outcome, 'not-running');
  windows.push(powerPointWindow);
  const result = await service.rebindRule('powerpoint');

  assert.equal(result.outcome, 'locked');
  assert.equal(result.target.id, powerPointWindow.id);
  assert.deepEqual(locked, [powerPointWindow]);
});

test('quick rule does not guess when the application has multiple windows', async () => {
  const secondPowerPointWindow = { ...powerPointWindow, id: 'window-powerpoint-2', processId: 12 };
  const { locked, service } = createService([powerPointWindow, secondPowerPointWindow]);
  const result = await service.lockRule('powerpoint');

  assert.equal(result.outcome, 'multiple');
  assert.equal(service.getSnapshot().status, 'multiple-candidates');
  assert.equal(service.getSnapshot().candidates.length, 2);
  assert.deepEqual(locked, []);
});

test('quick rule reports an application that is not running and rejects unknown rules', async () => {
  const { service } = createService([notesWindow]);
  assert.equal((await service.lockRule('keynote')).outcome, 'not-running');
  await assert.rejects(() => service.lockRule('unknown-player'), /Unsupported/);
});

test('scan prioritizes recognized media windows and does not expose native identity', async () => {
  const { service } = createService([notesWindow, powerPointWindow]);
  const result = await service.scan();

  assert.equal(result.status, 'single-candidate');
  assert.deepEqual(result.candidates, [{
    id: 'candidate-1',
    appName: 'Microsoft PowerPoint',
    windowLabel: '窗口 1',
    recognition: 'built-in',
    ruleId: 'powerpoint',
  }]);
  assert.equal('processId' in result.candidates[0], false);
  assert.equal('title' in result.candidates[0], false);
});

test('scan returns unrecognized windows only when no known application is running', async () => {
  const browserWindow = { ...notesWindow, id: 'browser', processId: 12, appName: 'chrome' };
  const { service } = createService([notesWindow, browserWindow]);
  const result = await service.scan();

  assert.equal(result.status, 'multiple-candidates');
  assert.deepEqual(result.candidates.map(({ appName, recognition }) => [appName, recognition]), [
    ['notepad', 'unrecognized'],
    ['chrome', 'unrecognized'],
  ]);
});

test('scan can deliberately include unrecognized windows alongside known targets', async () => {
  const { service } = createService([notesWindow, powerPointWindow]);
  const result = await service.scan({ includeUnrecognized: true });

  assert.equal(result.showingAll, true);
  assert.equal(result.status, 'multiple-candidates');
  assert.deepEqual(result.candidates.map(({ recognition }) => recognition), ['built-in', 'unrecognized']);
});

test('custom rules are preferred and a selected opaque candidate locks the private window', async () => {
  const customApps = [{
    id: 'custom-notes',
    displayName: 'My Presenter',
    platform: 'win32',
    appName: 'notepad',
    bundleId: '',
  }];
  const { locked, service } = createService([notesWindow], { getCustomApps: () => customApps });
  const result = await service.scan();

  assert.equal(result.candidates[0].recognition, 'custom');
  assert.equal(result.candidates[0].appName, 'My Presenter');
  await service.selectCandidate(result.candidates[0].id);
  assert.deepEqual(locked, [notesWindow]);
});

test('stale or malformed candidate identifiers are rejected', async () => {
  const { service } = createService([notesWindow]);
  const firstScan = await service.scan();
  await service.scan();

  await assert.rejects(() => service.selectCandidate(firstScan.candidates[0].id), /no longer available/);
  await assert.rejects(() => service.selectCandidate({}), /Invalid media candidate/);
});

test('custom application rules use stable platform identity and validate names', () => {
  assert.deepEqual(createCustomAppFromWindow(notesWindow, '  Notes Presenter  ', 'custom-1'), {
    id: 'custom-1',
    displayName: 'Notes Presenter',
    platform: 'win32',
    appName: 'notepad',
    bundleId: '',
  });
  assert.throws(() => createCustomAppFromWindow(notesWindow, '   '), /1 to 80/);
  assert.throws(() => createCustomAppFromWindow({ ...notesWindow, platform: 'linux' }, 'Unsupported'), /Unsupported/);
});

test('scan clears private candidates and exposes an error state when enumeration fails', async () => {
  let fail = false;
  let sequence = 0;
  const service = createMediaTargetService({
    adapter: {
      async listWindows() {
        if (fail) throw new Error('permission denied');
        return [notesWindow];
      },
    },
    targetWindowController: {
      getTarget: () => null,
      async lock() {},
    },
    createCandidateId: () => `candidate-${++sequence}`,
  });
  const first = await service.scan();
  fail = true;

  await assert.rejects(() => service.scan(), /permission denied/);
  assert.equal(service.getSnapshot().status, 'error');
  await assert.rejects(() => service.selectCandidate(first.candidates[0].id), /no longer available/);
});
