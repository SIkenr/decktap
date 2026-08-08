const crypto = require('node:crypto');

const MAX_CANDIDATES = 64;
const QUICK_TARGET_RULE_IDS = Object.freeze([
  'keynote',
  'powerpoint',
  'wps-presentation',
  'propresenter',
  'perfectcast',
]);

const BUILTIN_MEDIA_APPS = Object.freeze([
  {
    id: 'powerpoint',
    displayName: 'Microsoft PowerPoint',
    appNames: ['powerpnt', 'microsoft powerpoint', 'pptview'],
    bundleIds: ['com.microsoft.powerpoint'],
    playback: {
      appNames: ['pptview'],
      windowClasses: ['screenclass'],
      titleFragments: ['powerpoint slide show', 'slide show', '幻灯片放映', '投影片放映'],
    },
  },
  {
    id: 'keynote',
    displayName: 'Apple Keynote',
    appNames: ['keynote'],
    bundleIds: ['com.apple.keynote'],
  },
  {
    id: 'wps-presentation',
    displayName: 'WPS Presentation',
    appNames: [
      'wpp',
      'wps',
      'wps office',
      'wps presentation',
      'wppshow',
      'wpsshow',
      'wppplay',
    ],
    bundleIds: ['com.kingsoft.wpsoffice.mac', 'com.kingsoft.wpsoffice'],
    playback: {
      appNames: ['wppshow', 'wpsshow', 'wppplay'],
      windowClassFragments: ['wppscreen', 'wppshow', 'wpsscreen', 'wpsshow'],
      titleFragments: ['slide show', '幻灯片放映', '投影片放映', '放映 - wps'],
    },
  },
  {
    id: 'propresenter',
    displayName: 'ProPresenter',
    appNames: ['propresenter', 'propresenter 7'],
    bundleIds: ['com.renewedvision.propresenter', 'com.renewedvision.propresenter7'],
  },
  {
    id: 'perfectcast',
    displayName: '极演投影',
    appNames: ['perfectcast', '极演投影', '極演投影'],
    bundleIds: ['net.perfectcast.perfectcast', 'com.perfectcast.perfectcast'],
  },
  {
    id: 'adobe-reader',
    displayName: 'Adobe Acrobat Reader',
    appNames: ['acrord32', 'acrobat', 'adobe acrobat reader'],
    bundleIds: ['com.adobe.reader'],
  },
  {
    id: 'preview',
    displayName: 'Preview',
    appNames: ['preview'],
    bundleIds: ['com.apple.preview'],
  },
  {
    id: 'vlc',
    displayName: 'VLC media player',
    appNames: ['vlc'],
    bundleIds: ['org.videolan.vlc'],
  },
  {
    id: 'iina',
    displayName: 'IINA',
    appNames: ['iina'],
    bundleIds: ['com.colliderli.iina'],
  },
  {
    id: 'potplayer',
    displayName: 'PotPlayer',
    appNames: ['potplayer', 'potplayermini', 'potplayermini64'],
    bundleIds: [],
  },
]);

function normalizeIdentity(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function matchesIdentity(window, rule) {
  const appName = normalizeIdentity(window.appName);
  const bundleId = normalizeIdentity(window.bundleId);
  return Boolean(
    (bundleId && rule.bundleIds?.includes(bundleId))
    || (appName && rule.appNames?.includes(appName)),
  );
}

function includesNormalized(values, candidate) {
  return Boolean(candidate && values?.some((value) => normalizeIdentity(value) === candidate));
}

function containsNormalized(values, candidate) {
  return Boolean(candidate && values?.some((value) => candidate.includes(normalizeIdentity(value))));
}

function matchesPlaybackWindow(window, rule) {
  if (!rule.playback) return true;
  const appName = normalizeIdentity(window.appName);
  const windowClass = normalizeIdentity(window.windowClass);
  const title = normalizeIdentity(window.title);
  return Boolean(
    includesNormalized(rule.playback.appNames, appName)
    || includesNormalized(rule.playback.windowClasses, windowClass)
    || containsNormalized(rule.playback.windowClassFragments, windowClass)
    || (window.platform === 'darwin' && containsNormalized(rule.playback.titleFragments, title)),
  );
}

function matchesRuleWindow(window, rule) {
  return matchesIdentity(window, rule) && matchesPlaybackWindow(window, rule);
}

function findBuiltInRule(window) {
  return BUILTIN_MEDIA_APPS.find((rule) => matchesRuleWindow(window, rule)) || null;
}

function findBuiltInRuleById(ruleId) {
  if (typeof ruleId !== 'string' || ruleId.length > 80) return null;
  return BUILTIN_MEDIA_APPS.find((rule) => rule.id === ruleId) || null;
}

function findCustomRule(window, customApps) {
  const appName = normalizeIdentity(window.appName);
  const bundleId = normalizeIdentity(window.bundleId);
  return customApps.find((rule) => (
    rule.platform === window.platform
    && ((rule.bundleId && normalizeIdentity(rule.bundleId) === bundleId)
      || (!rule.bundleId && normalizeIdentity(rule.appName) === appName))
  )) || null;
}

function createCustomAppFromWindow(window, displayName, id = crypto.randomUUID()) {
  const name = String(displayName || '').trim();
  if (!name || name.length > 80) throw new TypeError('Custom application name must contain 1 to 80 characters');
  if (!['win32', 'darwin'].includes(window?.platform)) throw new TypeError('Unsupported custom application platform');

  const appName = String(window.appName || '').trim().slice(0, 160);
  const bundleId = window.platform === 'darwin'
    ? String(window.bundleId || '').trim().slice(0, 256)
    : '';
  if (!appName || (window.platform === 'darwin' && !bundleId)) {
    throw new TypeError('The selected window does not have a stable application identity');
  }

  return Object.freeze({
    id: String(id).slice(0, 80),
    displayName: name,
    platform: window.platform,
    appName,
    bundleId,
  });
}

function createMediaTargetService(options = {}) {
  const adapter = options.adapter;
  const targetWindowController = options.targetWindowController;
  const getCustomApps = options.getCustomApps || (() => []);
  const createCandidateId = options.createCandidateId || (() => crypto.randomUUID());

  if (!adapter || typeof adapter.listWindows !== 'function') {
    throw new TypeError('A window adapter with listWindows is required');
  }
  if (!targetWindowController || typeof targetWindowController.lock !== 'function') {
    throw new TypeError('A target window controller with lock is required');
  }

  let candidateWindows = new Map();
  let snapshot = Object.freeze({ status: 'idle', candidates: [], scannedAt: null, showingAll: false });

  function publicCandidate(window, index, recognition) {
    const candidateId = String(createCandidateId()).slice(0, 100);
    candidateWindows.set(candidateId, { recognition, window });
    return Object.freeze({
      id: candidateId,
      appName: recognition.displayName || String(window.appName || 'Unknown application').slice(0, 80),
      windowLabel: `窗口 ${index + 1}`,
      recognition: recognition.kind,
      ruleId: recognition.ruleId || null,
    });
  }

  async function scan(scanOptions = {}) {
    const showingAll = scanOptions.includeUnrecognized === true;
    snapshot = Object.freeze({ status: 'scanning', candidates: [], scannedAt: null, showingAll });
    try {
      const windows = (await adapter.listWindows()).slice(0, MAX_CANDIDATES);
      const customApps = getCustomApps();
      const recognized = [];
      const unrecognized = [];

      for (const window of windows) {
        const customRule = findCustomRule(window, customApps);
        const builtInRule = findBuiltInRule(window);
        if (customRule) {
          recognized.push({
            window,
            recognition: { kind: 'custom', displayName: customRule.displayName, ruleId: customRule.id },
          });
        } else if (builtInRule) {
          recognized.push({
            window,
            recognition: { kind: 'built-in', displayName: builtInRule.displayName, ruleId: builtInRule.id },
          });
        } else {
          unrecognized.push({ window, recognition: { kind: 'unrecognized', ruleId: null } });
        }
      }

      const selected = showingAll
        ? [...recognized, ...unrecognized]
        : recognized.length > 0 ? recognized : unrecognized;
      candidateWindows = new Map();
      const candidates = selected.map(({ window, recognition }, index) => (
        publicCandidate(window, index, recognition)
      ));
      const status = candidates.length === 0
        ? 'empty'
        : candidates.length === 1 ? 'single-candidate' : 'multiple-candidates';
      snapshot = Object.freeze({
        status,
        candidates: Object.freeze(candidates),
        scannedAt: Date.now(),
        showingAll,
      });
      return snapshot;
    } catch (error) {
      candidateWindows = new Map();
      snapshot = Object.freeze({ status: 'error', candidates: [], scannedAt: Date.now(), showingAll });
      throw error;
    }
  }

  function requireCandidate(candidateId) {
    if (typeof candidateId !== 'string' || candidateId.length > 100) {
      throw new TypeError('Invalid media candidate identifier');
    }
    const candidate = candidateWindows.get(candidateId);
    if (!candidate) throw new Error('The media candidate is no longer available; scan again');
    return candidate;
  }

  async function selectCandidate(candidateId) {
    const { recognition, window } = requireCandidate(candidateId);
    await targetWindowController.lock(window);
    return Object.freeze({
      ruleId: recognition.ruleId || null,
      target: targetWindowController.getTarget(),
    });
  }

  function createCustomApp(candidateId, displayName, id) {
    return createCustomAppFromWindow(requireCandidate(candidateId).window, displayName, id);
  }

  async function lockRule(ruleId) {
    const builtInRule = findBuiltInRuleById(ruleId);
    const customRule = getCustomApps().find((rule) => rule.id === ruleId) || null;
    if (!builtInRule && !customRule) throw new TypeError('Unsupported media application rule');

    snapshot = Object.freeze({ status: 'scanning', candidates: [], scannedAt: null, showingAll: false });
    try {
      const windows = (await adapter.listWindows()).slice(0, MAX_CANDIDATES);
      const matching = windows.filter((window) => (
        customRule ? findCustomRule(window, [customRule]) : matchesRuleWindow(window, builtInRule)
      ));
      candidateWindows = new Map();
      const recognition = customRule
        ? { kind: 'custom', displayName: customRule.displayName, ruleId: customRule.id }
        : { kind: 'built-in', displayName: builtInRule.displayName, ruleId: builtInRule.id };
      const candidates = matching.map((window, index) => publicCandidate(window, index, recognition));
      const status = candidates.length === 0
        ? 'empty'
        : candidates.length === 1 ? 'single-candidate' : 'multiple-candidates';
      snapshot = Object.freeze({
        status,
        candidates: Object.freeze(candidates),
        scannedAt: Date.now(),
        showingAll: false,
      });
      if (candidates.length !== 1) {
        return Object.freeze({ outcome: candidates.length === 0 ? 'not-running' : 'multiple', ruleId });
      }
      const selection = await selectCandidate(candidates[0].id);
      return Object.freeze({ outcome: 'locked', ruleId, target: selection.target });
    } catch (error) {
      candidateWindows = new Map();
      snapshot = Object.freeze({ status: 'error', candidates: [], scannedAt: Date.now(), showingAll: false });
      throw error;
    }
  }

  async function rebindRule(ruleId, rebindOptions = {}) {
    const builtInRule = findBuiltInRuleById(ruleId);
    const customRule = getCustomApps().find((rule) => rule.id === ruleId) || null;
    if (!builtInRule && !customRule) throw new TypeError('Unsupported media application rule');

    const windows = (await adapter.listWindows()).slice(0, MAX_CANDIDATES);
    const matching = windows.filter((window) => (
      customRule ? findCustomRule(window, [customRule]) : matchesRuleWindow(window, builtInRule)
    ));
    if (matching.length !== 1) {
      return Object.freeze({
        outcome: matching.length === 0 ? 'not-running' : 'multiple',
        ruleId,
      });
    }
    if (typeof rebindOptions.shouldLock === 'function' && !rebindOptions.shouldLock()) {
      return Object.freeze({ outcome: 'cancelled', ruleId });
    }
    await targetWindowController.lock(matching[0]);
    return Object.freeze({ outcome: 'locked', ruleId, target: targetWindowController.getTarget() });
  }

  return {
    createCustomApp,
    getSnapshot: () => snapshot,
    lockRule,
    rebindRule,
    scan,
    selectCandidate,
  };
}

module.exports = {
  BUILTIN_MEDIA_APPS,
  MAX_CANDIDATES,
  createCustomAppFromWindow,
  createMediaTargetService,
  findBuiltInRule,
  findBuiltInRuleById,
  findCustomRule,
  matchesPlaybackWindow,
  matchesRuleWindow,
  normalizeIdentity,
  QUICK_TARGET_RULE_IDS,
};
