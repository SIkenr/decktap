export type PageTurnMode = 'vertical' | 'horizontal';
export type ThemeSource = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';
export type ServiceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type MediaTargetStatus = 'idle' | 'scanning' | 'empty' | 'single-candidate' | 'multiple-candidates' | 'error';
export type QuickTargetOutcome = 'locked' | 'multiple' | 'not-running';

export interface MediaTargetCandidate {
  id: string;
  appName: string;
  windowLabel: string;
  recognition: 'built-in' | 'custom' | 'unrecognized';
  ruleId: string | null;
}

export interface ControllerDevice {
  id: string;
  label: string;
  connectedAt: number;
}

export interface ControllerDeviceHistory {
  id: string;
  pairedAt: number;
  reason: 'expired' | 'manual' | 'replaced' | 'rotated';
  revokedAt: number;
}

export type DiagnosticLogLevel = 'all' | 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticLogRecord {
  timestamp: string;
  level: Exclude<DiagnosticLogLevel, 'all'>;
  component: string;
  event: string;
  message: string;
}

export interface LogDiagnostics {
  counts: Record<Exclude<DiagnosticLogLevel, 'all'>, number>;
  malformedLines: number;
  records: DiagnosticLogRecord[];
  updatedAt: number;
}

export interface AppSnapshot {
  app: {
    platform: string;
    version: string;
  };
  connectedClients: number;
  controlUrl: string | null;
  deviceHistory: ControllerDeviceHistory[];
  devices: ControllerDevice[];
  interfaceName: string | null;
  mediaTargets: {
    candidates: MediaTargetCandidate[];
    customApps: Array<{ id: string; displayName: string; platform: 'win32' | 'darwin' }>;
    scannedAt: number | null;
    showingAll: boolean;
    status: MediaTargetStatus;
  };
  pageTurnMode: PageTurnMode;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  permissionStatus: 'granted' | 'missing' | 'not-required';
  serviceError: { code: string; message: string } | null;
  serviceState: ServiceState;
  trustedClients: number;
  settings: {
    closeToTray: boolean;
    launchAtLogin: boolean;
    launchAtLoginSupported: boolean;
    startServiceOnLaunch: boolean;
    welcomeCompleted: boolean;
  };
  target: {
    appName: string | null;
    focusProtection: boolean;
    ruleId: string | null;
    status: 'unconfigured' | 'waiting' | 'locked' | 'lost';
  };
  theme: {
    effective: EffectiveTheme;
    source: ThemeSource;
  };
}

export interface DeckTapApi {
  addCustomApp(candidateId: string, displayName: string): Promise<AppSnapshot>;
  captureTarget(): Promise<AppSnapshot>;
  clearTarget(): Promise<AppSnapshot>;
  copyControlUrl(): Promise<boolean>;
  copyDiagnosticSummary(level: DiagnosticLogLevel): Promise<{ copied: boolean }>;
  disconnectAllDevices(): Promise<AppSnapshot>;
  disconnectDevice(deviceId: string): Promise<AppSnapshot>;
  getSnapshot(): Promise<AppSnapshot>;
  getLogDiagnostics(level: DiagnosticLogLevel): Promise<LogDiagnostics>;
  lockMediaApp(ruleId: string): Promise<{ outcome: QuickTargetOutcome; snapshot: AppSnapshot }>;
  openLogFolder(): Promise<{ opened: boolean }>;
  openPermissionSettings(): Promise<{ opened: boolean }>;
  refreshPermissions(): Promise<AppSnapshot>;
  removeCustomApp(customAppId: string): Promise<AppSnapshot>;
  rotatePairing(): Promise<AppSnapshot>;
  scanMediaTargets(includeUnrecognized?: boolean): Promise<AppSnapshot>;
  selectMediaTarget(candidateId: string): Promise<AppSnapshot>;
  setPageTurnMode(mode: PageTurnMode): Promise<AppSnapshot>;
  setCloseToTray(enabled: boolean): Promise<AppSnapshot>;
  setLaunchAtLogin(enabled: boolean): Promise<AppSnapshot>;
  setStartServiceOnLaunch(enabled: boolean): Promise<AppSnapshot>;
  setTheme(themeSource: ThemeSource): Promise<AppSnapshot>;
  setWelcomeCompleted(completed: boolean): Promise<AppSnapshot>;
  startService(): Promise<AppSnapshot>;
  stopService(): Promise<AppSnapshot>;
  onSnapshotChanged(callback: (snapshot: AppSnapshot) => void): () => void;
}

declare global {
  interface Window {
    decktap: DeckTapApi;
  }
}
