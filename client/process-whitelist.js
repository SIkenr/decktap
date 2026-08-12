const PRESENTATION_PROCESS_RULES = Object.freeze([
  {
    ruleId: 'powerpoint',
    displayName: 'Microsoft PowerPoint',
    platforms: ['darwin', 'win32'],
    processNames: [
      'microsoft powerpoint',
      'powerpoint',
      'powerpnt',
      'pptview',
    ],
    bundleIds: ['com.microsoft.powerpoint'],
  },
  {
    ruleId: 'keynote',
    displayName: 'Apple Keynote',
    platforms: ['darwin'],
    processNames: ['keynote'],
    bundleIds: ['com.apple.keynote', 'com.apple.iwork.keynote'],
  },
  {
    ruleId: 'wps-presentation',
    displayName: 'WPS Presentation',
    platforms: ['darwin', 'win32'],
    processNames: [
      'wps',
      'wps office',
      'wps presentation',
      'wpp',
      'wppshow',
      'wpsshow',
      'wppplay',
    ],
    bundleIds: ['com.kingsoft.wpsoffice.mac', 'com.kingsoft.wpsoffice'],
  },
  {
    ruleId: 'propresenter',
    displayName: 'ProPresenter',
    platforms: ['darwin', 'win32'],
    processNames: ['propresenter', 'propresenter 6', 'propresenter 7'],
    bundleIds: [
      'com.renewedvision.propresenter',
      'com.renewedvision.propresenter6',
      'com.renewedvision.propresenter7',
    ],
  },
  {
    ruleId: 'perfectcast',
    displayName: '极演投影',
    platforms: ['darwin', 'win32'],
    processNames: ['perfectcast', '极演投影', '極演投影'],
    bundleIds: ['net.perfectcast.perfectcast', 'com.perfectcast.perfectcast'],
  },
  {
    ruleId: 'adobe-reader',
    displayName: 'Adobe Acrobat Reader',
    platforms: ['darwin', 'win32'],
    processNames: ['acrobat', 'adobe acrobat', 'adobe acrobat reader', 'acrord32'],
    bundleIds: ['com.adobe.reader'],
  },
  {
    ruleId: 'preview',
    displayName: 'Preview',
    platforms: ['darwin'],
    processNames: ['preview'],
    bundleIds: ['com.apple.preview'],
  },
  {
    ruleId: 'vlc',
    displayName: 'VLC media player',
    platforms: ['darwin', 'win32'],
    processNames: ['vlc'],
    bundleIds: ['org.videolan.vlc'],
  },
  {
    ruleId: 'iina',
    displayName: 'IINA',
    platforms: ['darwin'],
    processNames: ['iina'],
    bundleIds: ['com.colliderli.iina'],
  },
  {
    ruleId: 'potplayer',
    displayName: 'PotPlayer',
    platforms: ['win32'],
    processNames: ['potplayer', 'potplayermini', 'potplayermini64'],
    bundleIds: [],
  },
]);

function normalizeProcessIdentity(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function processRuleForName(appName, platform) {
  const normalized = normalizeProcessIdentity(appName);
  return PRESENTATION_PROCESS_RULES.find((rule) => (
    rule.platforms.includes(platform)
    && rule.processNames.some((name) => normalizeProcessIdentity(name) === normalized)
  )) || null;
}

function processRuleForBundleId(bundleId, platform) {
  const normalized = normalizeProcessIdentity(bundleId);
  return PRESENTATION_PROCESS_RULES.find((rule) => (
    normalized
    && rule.platforms.includes(platform)
    && rule.bundleIds.some((candidate) => normalizeProcessIdentity(candidate) === normalized)
  )) || null;
}

function isWhitelistedProcess(appName, platform) {
  return Boolean(processRuleForName(appName, platform));
}

module.exports = {
  PRESENTATION_PROCESS_RULES,
  isWhitelistedProcess,
  normalizeProcessIdentity,
  processRuleForBundleId,
  processRuleForName,
};
