import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

import type {
  AppSnapshot,
  DiagnosticLogLevel,
  LogDiagnostics,
  MediaTargetCandidate,
  PageTurnMode,
  ServiceState,
  ThemeSource,
} from './types';

type NavKey = 'home' | 'target' | 'controls' | 'devices' | 'logs' | 'settings';

const NAV_ITEMS: Array<{ key: NavKey; label: string; icon: string }> = [
  { key: 'home', label: '首页', icon: '⌂' },
  { key: 'target', label: '控制目标', icon: '◎' },
  { key: 'controls', label: '控制设置', icon: '≡' },
  { key: 'devices', label: '设备连接', icon: '▯' },
  { key: 'logs', label: '日志诊断', icon: '▤' },
  { key: 'settings', label: '应用设置', icon: '⚙' },
];

const PAGE_COPY: Record<NavKey, { title: string; subtitle: string }> = {
  home: { title: '首页', subtitle: '手机遥控器与电脑连接状态' },
  target: { title: '控制目标', subtitle: '识别并锁定演示或媒体播放软件' },
  controls: { title: '控制设置', subtitle: '配置翻页方向和控制方式' },
  devices: { title: '设备连接', subtitle: '管理局域网服务和已连接手机' },
  logs: { title: '日志诊断', subtitle: '查看运行状态并打开本地日志' },
  settings: { title: '应用设置', subtitle: '调整外观和客户端行为' },
};

const SERVICE_LABELS: Record<ServiceState, string> = {
  stopped: '服务已停止',
  starting: '正在启动',
  running: '服务运行中',
  stopping: '正在停止',
  error: '服务异常',
};

const DEVICE_HISTORY_REASON = {
  expired: '信任已过期',
  manual: '已手动撤销',
  replaced: '已被新设备替换',
  rotated: '已轮换授权',
} as const;

const QUICK_TARGET_APPS = [
  { id: 'keynote', label: 'Keynote', mark: 'K', tone: 'keynote' },
  { id: 'powerpoint', label: 'PowerPoint', mark: 'P', tone: 'powerpoint' },
  { id: 'wps-presentation', label: 'WPS', mark: 'W', tone: 'wps' },
  { id: 'propresenter', label: 'ProPresenter', mark: 'Pr', tone: 'propresenter' },
  { id: 'perfectcast', label: '极演投影', mark: '极', tone: 'perfectcast' },
] as const;

function Logo() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-signal">◔</span>
      <span className="brand-letter">D</span>
    </div>
  );
}

function StatusIcon({ tone, symbol }: { tone: 'blue' | 'green' | 'amber'; symbol: string }) {
  return <span className={`status-icon ${tone}`} aria-hidden="true">{symbol}</span>;
}

function ServiceBadge({ state }: { state: ServiceState }) {
  return (
    <span className={`service-badge ${state}`} role="status">
      <span className="service-dot" aria-hidden="true" />
      {SERVICE_LABELS[state]}
    </span>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <Logo />
      <p>正在载入 DeckTap…</p>
    </main>
  );
}

function getDisplayControlUrl(controlUrl: string | null) {
  if (!controlUrl) return '本地控制地址尚未生成';
  try {
    const url = new URL(controlUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '本地控制地址已生成';
  }
}

function PairingCountdown({ expiresAt }: { expiresAt: number | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt) return null;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  return <span className="pairing-expiry">配对码 {minutes}:{seconds} 后过期</span>;
}

function formatConnectionTime(timestamp: number) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(timestamp);
  } catch {
    return '刚刚连接';
  }
}

function DevicesPage({
  snapshot,
  busy,
  onDisconnect,
  onDisconnectAll,
  onRotatePairing,
  onServiceToggle,
}: {
  snapshot: AppSnapshot;
  busy: boolean;
  onDisconnect: (deviceId: string) => void;
  onDisconnectAll: () => void;
  onRotatePairing: () => void;
  onServiceToggle: () => void;
}) {
  const isRunning = snapshot.serviceState === 'running';

  return (
    <div className="devices-page-stack">
      <section className="card device-service-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">局域网服务</p>
            <h2>{SERVICE_LABELS[snapshot.serviceState]}</h2>
          </div>
          <ServiceBadge state={snapshot.serviceState} />
        </div>
        <div className="device-service-details">
          <div>
            <span>控制地址</span>
            <code>{getDisplayControlUrl(snapshot.controlUrl)}</code>
          </div>
          <div>
            <span>网络接口</span>
            <strong>{snapshot.interfaceName || '尚未选择局域网接口'}</strong>
          </div>
        </div>
        <div className="button-row">
          <button className="primary-outline-button" type="button" disabled={!isRunning || busy} onClick={onRotatePairing}>
            轮换配对码并撤销全部授权
          </button>
          <button className={isRunning ? 'danger-button' : 'primary-button'} type="button" disabled={busy} onClick={onServiceToggle}>
            {busy ? '处理中…' : isRunning ? '停止服务' : '启动服务'}
          </button>
        </div>
      </section>

      <section className="card connected-devices-card" aria-live="polite">
        <div className="card-heading">
          <div>
            <p className="eyebrow">已认证会话</p>
            <h2>已连接设备</h2>
          </div>
          <div className="connected-device-actions">
            <span className="mini-status success">{snapshot.devices.length} 台</span>
            {snapshot.devices.length > 1 && (
              <button className="danger-button" type="button" disabled={busy} onClick={onDisconnectAll}>
                全部断开
              </button>
            )}
          </div>
        </div>

        {snapshot.devices.length === 0 ? (
          <div className="device-empty-state">
            <span aria-hidden="true">▯</span>
            <strong>{isRunning ? '暂无手机连接' : '控制服务未启动'}</strong>
            <p>{isRunning ? '使用手机扫描首页二维码，再输入 6 位数字码完成安全配对。' : '启动服务后才能接受手机连接。'}</p>
          </div>
        ) : (
          <ul className="device-session-list">
            {snapshot.devices.map((device) => (
              <li key={device.id}>
                <div className="device-session-icon" aria-hidden="true">▯</div>
                <div>
                  <strong>{device.label}</strong>
                  <span>已安全连接 · {formatConnectionTime(device.connectedAt)}</span>
                </div>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => onDisconnect(device.id)}>
                  断开设备
                </button>
              </li>
            ))}
          </ul>
        )}

        {snapshot.deviceHistory.length > 0 && (
          <div className="device-history-block">
            <div className="device-history-heading">
              <strong>历史设备</strong>
              <span>仅保留撤销记录，不再具备控制权限</span>
            </div>
            <ul className="device-history-list">
              {snapshot.deviceHistory.map((record, index) => (
                <li key={record.id}>
                  <span>历史手机 {snapshot.deviceHistory.length - index}</span>
                  <small>{DEVICE_HISTORY_REASON[record.reason]} · {formatConnectionTime(record.revokedAt)}</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="device-privacy-note">
          DeckTap 仅在本机保存当前可信设备的内网地址，最长 24 小时；界面和日志不会显示完整 IP 或浏览器信息。
        </div>
        {snapshot.app.platform === 'win32' && (
          <div className="windows-network-note">
            <strong>Windows 网络提示</strong>
            <span>首次启动时请仅允许 DeckTap 通过“专用网络”防火墙。若手机无法连接，请检查 Windows 防火墙中的 DeckTap 专用网络权限。</span>
          </div>
        )}
      </section>
    </div>
  );
}

function ControlsPage({
  snapshot,
  busy,
  onPageModeChange,
}: {
  snapshot: AppSnapshot;
  busy: boolean;
  onPageModeChange: (mode: PageTurnMode) => void;
}) {
  const horizontal = snapshot.pageTurnMode === 'horizontal';
  return (
    <div className="controls-page-stack">
      <section className="card control-settings-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">默认控制</p>
            <h2>翻页方向</h2>
          </div>
          <span className="mini-status success">{horizontal ? '左右翻页' : '上下翻页'}</span>
        </div>
        <p className="settings-description">设置会立即同步到所有已连接手机，同时保存在当前电脑。</p>
        <div className="segmented-control large-segmented" aria-label="默认翻页方向">
          <button
            type="button"
            disabled={busy}
            aria-pressed={!horizontal}
            className={!horizontal ? 'selected' : ''}
            onClick={() => onPageModeChange('vertical')}
          >
            <strong>↑ ↓</strong>
            <span>上下翻页</span>
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={horizontal}
            className={horizontal ? 'selected' : ''}
            onClick={() => onPageModeChange('horizontal')}
          >
            <strong>← →</strong>
            <span>左右翻页</span>
          </button>
        </div>
      </section>

      <section className="card control-safety-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">按键安全</p>
            <h2>焦点保护</h2>
          </div>
          <span className={`mini-status ${snapshot.target.status === 'locked' ? 'success' : 'warning'}`}>
            {snapshot.target.status === 'locked' ? '已保护' : snapshot.target.status === 'lost' ? '目标丢失' : '未锁定'}
          </span>
        </div>
        <div className="control-mapping-list">
          <div><span>上一页</span><code>{horizontal ? '← Left' : '↑ Up'}</code></div>
          <div><span>下一页</span><code>{horizontal ? '→ Right' : '↓ Down'}</code></div>
          <div><span>当前软件</span><strong>{snapshot.target.appName || '电脑当前前台窗口'}</strong></div>
        </div>
        <p className="settings-description">
          锁定目标后，DeckTap 只会在焦点恢复并验证成功时发送按键；目标丢失时手机控制会自动停用。
        </p>
      </section>
    </div>
  );
}

function SettingToggle({
  checked,
  disabled = false,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`setting-toggle ${disabled ? 'disabled' : ''}`}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}

function SettingsPage({
  snapshot,
  busy,
  onCloseToTrayChange,
  onLaunchAtLoginChange,
  onStartServiceOnLaunchChange,
  onThemeChange,
}: {
  snapshot: AppSnapshot;
  busy: boolean;
  onCloseToTrayChange: (enabled: boolean) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onStartServiceOnLaunchChange: (enabled: boolean) => void;
  onThemeChange: (theme: ThemeSource) => void;
}) {
  return (
    <div className="settings-page-stack">
      <section className="card app-settings-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">应用行为</p>
            <h2>启动与后台运行</h2>
          </div>
        </div>
        <div className="setting-toggle-list">
          <SettingToggle
            checked={snapshot.settings.startServiceOnLaunch}
            disabled={busy}
            label="启动 DeckTap 时开启控制服务"
            description="关闭后，应用启动时会保持服务停止，需从首页或托盘手动开启。"
            onChange={onStartServiceOnLaunchChange}
          />
          <SettingToggle
            checked={snapshot.settings.closeToTray}
            disabled={busy}
            label="关闭窗口时继续在托盘运行"
            description="开启后，关闭主窗口不会停止手机控制服务；可从托盘菜单彻底退出。"
            onChange={onCloseToTrayChange}
          />
          <SettingToggle
            checked={snapshot.settings.launchAtLogin}
            disabled={busy || !snapshot.settings.launchAtLoginSupported}
            label="登录系统时启动 DeckTap"
            description={snapshot.settings.launchAtLoginSupported
              ? '由 Windows 或 macOS 管理登录启动项。'
              : '该选项仅在正式打包的 Windows 和 macOS 客户端中开放。'}
            onChange={onLaunchAtLoginChange}
          />
        </div>
      </section>

      <section className="card appearance-settings-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">界面外观</p>
            <h2>主题模式</h2>
          </div>
        </div>
        <div className="segmented-control theme-segmented" aria-label="应用主题">
          {([
            ['system', '跟随系统'],
            ['light', '浅色模式'],
            ['dark', '深色模式'],
          ] as Array<[ThemeSource, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              aria-pressed={snapshot.theme.source === value}
              className={snapshot.theme.source === value ? 'selected' : ''}
              onClick={() => onThemeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card about-settings-card">
        <div>
          <p className="eyebrow">关于</p>
          <h2>DeckTap {snapshot.app.version}</h2>
          <p className="settings-description">局域网手机演示遥控器 · 当前平台：{snapshot.app.platform}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void window.decktap.openLogFolder()}>
          打开应用日志目录
        </button>
      </section>
    </div>
  );
}

const LOG_LEVEL_LABELS: Record<DiagnosticLogLevel, string> = {
  all: '全部',
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误',
};

function formatLogTime(timestamp: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return timestamp;
  }
}

function LogsPage() {
  const [level, setLevel] = useState<DiagnosticLogLevel>('all');
  const [diagnostics, setDiagnostics] = useState<LogDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = useCallback((nextLevel: DiagnosticLogLevel = level) => {
    setLoading(true);
    setError('');
    void window.decktap.getLogDiagnostics(nextLevel)
      .then(setDiagnostics)
      .catch(() => setError('无法读取诊断日志，请尝试打开日志目录。'))
      .finally(() => setLoading(false));
  }, [level]);

  useEffect(() => {
    refresh(level);
  }, [level, refresh]);

  const copySummary = async () => {
    setError('');
    try {
      const result = await window.decktap.copyDiagnosticSummary(level);
      if (!result.copied) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('无法复制诊断摘要。');
    }
  };

  return (
    <div className="logs-page-stack">
      <section className="card diagnostics-overview-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">诊断概览</p>
            <h2>运行日志</h2>
          </div>
          <div className="diagnostic-actions">
            <button className="secondary-button" type="button" onClick={() => void window.decktap.openLogFolder()}>
              打开日志目录
            </button>
            <button className="primary-outline-button" type="button" disabled={loading} onClick={() => refresh()}>
              刷新
            </button>
            <button className="primary-button" type="button" disabled={loading || !diagnostics} onClick={() => void copySummary()}>
              {copied ? '已复制' : '复制脱敏摘要'}
            </button>
          </div>
        </div>

        <div className="diagnostic-metrics">
          {(['error', 'warn', 'info', 'debug'] as const).map((metricLevel) => (
            <div key={metricLevel} className={`diagnostic-metric ${metricLevel}`}>
              <span>{LOG_LEVEL_LABELS[metricLevel]}</span>
              <strong>{diagnostics?.counts[metricLevel] || 0}</strong>
            </div>
          ))}
        </div>
        <p className="diagnostic-privacy-note">
          此页面只显示脱敏摘要，不展示进程编号、会话 ID、完整路径、原始堆栈和配对信息。
        </p>
      </section>

      <section className="card diagnostic-records-card">
        <div className="diagnostic-filter-row">
          <div className="segmented-control diagnostic-level-filter" aria-label="日志级别筛选">
            {(Object.keys(LOG_LEVEL_LABELS) as DiagnosticLogLevel[]).map((item) => (
              <button
                key={item}
                type="button"
                className={level === item ? 'selected' : ''}
                aria-pressed={level === item}
                onClick={() => setLevel(item)}
              >
                {LOG_LEVEL_LABELS[item]}
              </button>
            ))}
          </div>
          <span>{diagnostics ? `最近 ${diagnostics.records.length} 条` : '等待读取'}</span>
        </div>

        {error && <div className="target-empty-state error" role="alert">{error}</div>}
        {!error && loading && <div className="target-empty-state" role="status">正在读取脱敏日志摘要…</div>}
        {!error && !loading && diagnostics?.records.length === 0 && (
          <div className="target-empty-state">当前筛选条件下没有日志记录。</div>
        )}
        {!error && !loading && diagnostics && diagnostics.records.length > 0 && (
          <ol className="diagnostic-record-list">
            {diagnostics.records.map((record, index) => (
              <li key={`${record.timestamp}-${record.event}-${index}`}>
                <span className={`log-level-pill ${record.level}`}>{LOG_LEVEL_LABELS[record.level]}</span>
                <div>
                  <div className="diagnostic-record-meta">
                    <time dateTime={record.timestamp}>{formatLogTime(record.timestamp)}</time>
                    <span>{record.component}</span>
                    <code>{record.event}</code>
                  </div>
                  <p>{record.message}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

const RECOGNITION_LABELS: Record<MediaTargetCandidate['recognition'], string> = {
  'built-in': '已识别',
  custom: '自定义规则',
  unrecognized: '未识别软件',
};

function TargetCandidateCard({
  candidate,
  busy,
  onAddCustomApp,
  onSelect,
}: {
  candidate: MediaTargetCandidate;
  busy: boolean;
  onAddCustomApp: (candidateId: string, displayName: string) => void;
  onSelect: (candidateId: string) => void;
}) {
  const [customName, setCustomName] = useState(candidate.appName);
  const unrecognized = candidate.recognition === 'unrecognized';

  return (
    <article className="candidate-card">
      <div className="candidate-icon" aria-hidden="true">▶</div>
      <div className="candidate-details">
        <div className="candidate-title-row">
          <h3>{candidate.appName}</h3>
          <span className={`recognition-badge ${candidate.recognition}`}>
            {RECOGNITION_LABELS[candidate.recognition]}
          </span>
        </div>
        <p>{candidate.windowLabel} · 不显示窗口标题和进程信息</p>
        {unrecognized && (
          <form
            className="custom-app-form"
            onSubmit={(event) => {
              event.preventDefault();
              onAddCustomApp(candidate.id, customName);
            }}
          >
            <label htmlFor={`custom-name-${candidate.id}`}>自定义软件名称</label>
            <div>
              <input
                id={`custom-name-${candidate.id}`}
                maxLength={80}
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
              />
              <button className="secondary-button" type="submit" disabled={busy || !customName.trim()}>
                保存识别规则
              </button>
            </div>
          </form>
        )}
      </div>
      <button className="primary-outline-button candidate-select" type="button" disabled={busy} onClick={() => onSelect(candidate.id)}>
        {unrecognized ? '临时锁定' : '选择并锁定'}
      </button>
    </article>
  );
}

function TargetPage({
  snapshot,
  busy,
  onAddCustomApp,
  onClearTarget,
  onRemoveCustomApp,
  onScan,
  onSelect,
}: {
  snapshot: AppSnapshot;
  busy: boolean;
  onAddCustomApp: (candidateId: string, displayName: string) => void;
  onClearTarget: () => void;
  onRemoveCustomApp: (customAppId: string) => void;
  onScan: (includeUnrecognized?: boolean) => void;
  onSelect: (candidateId: string) => void;
}) {
  const discovery = snapshot.mediaTargets;
  const targetLocked = snapshot.target.status === 'locked';
  const targetLost = snapshot.target.status === 'lost';
  const scanTitle = discovery.status === 'single-candidate'
    ? '检测到一个建议目标'
    : discovery.status === 'multiple-candidates'
      ? `检测到 ${discovery.candidates.length} 个候选目标`
      : discovery.showingAll ? '正在显示全部运行窗口' : '识别演示和媒体软件';

  return (
    <div className="target-page-stack">
      <section className="card target-current-card" aria-live="polite">
        <div className="card-heading">
          <div>
            <p className="eyebrow">当前目标</p>
            <h2>{snapshot.target.appName || '尚未锁定控制软件'}</h2>
          </div>
          <span className={`mini-status ${targetLocked ? 'success' : 'warning'}`}>
            {targetLocked ? '焦点保护已开启' : targetLost ? '目标已丢失' : '等待选择'}
          </span>
        </div>
        <p className="target-page-description">
          {targetLocked
            ? '每次翻页前都会恢复并验证此窗口焦点。'
            : targetLost
              ? '目标窗口已关闭或无法聚焦，没有向其他窗口发送按键。'
              : '扫描已知软件，或从全部运行窗口中添加自定义软件。'}
        </p>
        {targetLocked && (
          <button className="secondary-button" type="button" disabled={busy} onClick={onClearTarget}>
            解除当前锁定
          </button>
        )}
      </section>

      <section className="card target-discovery-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">软件识别</p>
            <h2>{scanTitle}</h2>
          </div>
          <div className="target-scan-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => onScan(true)}>
              查看全部窗口
            </button>
            <button className="primary-button" type="button" disabled={busy} onClick={() => onScan(false)}>
              {discovery.status === 'idle' ? '开始扫描' : '重新扫描'}
            </button>
          </div>
        </div>

        {discovery.status === 'scanning' && <div className="target-empty-state" role="status">正在读取运行中的软件…</div>}
        {discovery.status === 'idle' && <div className="target-empty-state">点击“开始扫描”查找演示和媒体软件。</div>}
        {discovery.status === 'empty' && (
          <div className="target-empty-state">
            <strong>没有检测到可选择的窗口</strong>
            <span>请先打开演示文稿或播放器，然后重新扫描。</span>
          </div>
        )}
        {discovery.status === 'error' && (
          <div className="target-empty-state error" role="alert">
            <strong>扫描没有完成</strong>
            <span>检查系统权限后重试，详细原因已写入日志。</span>
          </div>
        )}
        {discovery.candidates.length > 0 && (
          <div className="candidate-list" aria-label="媒体软件候选列表">
            {discovery.candidates.map((candidate) => (
              <TargetCandidateCard
                key={candidate.id}
                candidate={candidate}
                busy={busy}
                onAddCustomApp={onAddCustomApp}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </section>

      <section className="card custom-apps-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">识别规则</p>
            <h2>自定义播放软件</h2>
          </div>
          <span className="mini-status muted">{discovery.customApps.length} 条规则</span>
        </div>
        {discovery.customApps.length === 0 ? (
          <p className="target-page-description">从“查看全部窗口”中选择未识别软件，即可保存自定义规则。</p>
        ) : (
          <ul className="custom-app-list">
            {discovery.customApps.map((customApp) => (
              <li key={customApp.id}>
                <div>
                  <strong>{customApp.displayName}</strong>
                  <span>{customApp.platform === 'darwin' ? 'macOS' : 'Windows'}</span>
                </div>
                <button className="text-button danger-text" type="button" disabled={busy} onClick={() => onRemoveCustomApp(customApp.id)}>
                  删除规则
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HomePage({
  snapshot,
  onPageModeChange,
  onRotatePairing,
  qrDataUrl,
  qrLoading,
  onServiceToggle,
  busy,
  copied,
  onCopy,
  onClearTarget,
  onOpenCustomTarget,
  onOpenPermissionSettings,
  onQuickLockTarget,
  onRefreshPermissions,
}: {
  snapshot: AppSnapshot;
  onPageModeChange: (mode: PageTurnMode) => void;
  onRotatePairing: () => void;
  qrDataUrl: string;
  qrLoading: boolean;
  onServiceToggle: () => void;
  busy: boolean;
  copied: boolean;
  onCopy: () => void;
  onClearTarget: () => void;
  onOpenCustomTarget: () => void;
  onOpenPermissionSettings: () => void;
  onQuickLockTarget: (ruleId: string) => void;
  onRefreshPermissions: () => void;
}) {
  const isRunning = snapshot.serviceState === 'running';
  const isConnected = snapshot.connectedClients > 0;
  const permissionText = snapshot.permissionStatus === 'granted'
    ? '辅助功能权限已开启'
    : snapshot.permissionStatus === 'missing'
      ? '需要开启辅助功能权限'
      : '当前平台无需额外权限';
  const statusText = snapshot.serviceError?.message || (isRunning ? '运行正常，暂无错误' : '服务当前未运行');
  const targetLocked = snapshot.target.status === 'locked';
  const targetLost = snapshot.target.status === 'lost';
  const targetStatusText = targetLocked ? '已锁定' : targetLost ? '目标已丢失' : '尚未配置';

  return (
    <div className="dashboard-grid">
      <article className="card connection-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">局域网连接</p>
            <h2>连接手机</h2>
          </div>
          <span className={`mini-status ${isConnected ? 'success' : isRunning ? 'warning' : 'muted'}`}>
            {isConnected ? '已成功连接' : isRunning ? '等待数字配对' : '服务未启动'}
          </span>
        </div>

        <div className="connection-content">
          <div className={`qr-frame ${isConnected ? 'connected' : ''}`} aria-label={isConnected ? '手机已成功连接' : isRunning ? '手机控制器二维码' : '二维码暂不可用'}>
            {isConnected
              ? <span className="connection-success-mark" aria-hidden="true">✓</span>
              : isRunning && qrDataUrl && !qrLoading
                ? <img src={qrDataUrl} alt="手机控制器连接二维码" />
                : <span className="qr-placeholder" aria-hidden="true">⌁</span>}
          </div>
          <div className="connection-details">
            <div className="connection-title">
              <span className="wifi-icon" aria-hidden="true">{isConnected ? '●' : '◒'}</span>
              <strong>{isConnected ? '手机已通过数字码安全配对' : isRunning ? '扫码后输入下方数字配对码' : '启动服务后即可连接'}</strong>
            </div>
            {isConnected ? (
              <div className="trusted-connection-note">
                当前设备已加入 24 小时单设备信任；关闭页面或更换浏览器后可自动恢复。新设备配对会撤销当前设备。
              </div>
            ) : (
              <>
                <code className="control-url">{getDisplayControlUrl(snapshot.controlUrl)}</code>
                {isRunning && snapshot.pairingCode && (
                  <div className="numeric-pairing-code" aria-label={`数字配对码 ${snapshot.pairingCode}`}>
                    {snapshot.pairingCode.slice(0, 3)} <span>{snapshot.pairingCode.slice(3)}</span>
                  </div>
                )}
                {isRunning && <PairingCountdown expiresAt={snapshot.pairingExpiresAt} />}
              </>
            )}
            <p className="muted-copy">
              {snapshot.interfaceName ? `网络接口：${snapshot.interfaceName}` : '请确保手机与电脑连接同一 Wi-Fi'}
            </p>
          </div>
        </div>

        <div className="button-row">
          <button className="secondary-button" type="button" disabled={!isRunning || isConnected} onClick={onCopy}>
            {copied ? '已复制' : '复制地址'}
          </button>
          <button className="primary-outline-button" type="button" disabled={!isRunning || busy} onClick={onRotatePairing}>
            轮换配对码
          </button>
          <button className={isRunning ? 'danger-button' : 'primary-button'} type="button" disabled={busy} onClick={onServiceToggle}>
            {busy ? '处理中…' : isRunning ? '停止服务' : '启动服务'}
          </button>
        </div>
      </article>

      <article className="card target-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">焦点保护</p>
            <h2>当前控制软件</h2>
          </div>
          <span className={`mini-status ${targetLocked ? 'success' : 'warning'}`} role="status">
            {targetStatusText}
          </span>
        </div>

        <div className="quick-target-heading">
          <strong>快捷锁定</strong>
          <span>点击正在运行的演示软件</span>
        </div>

        <div className="quick-target-grid" aria-label="快捷锁定播放或演示软件">
          {QUICK_TARGET_APPS.map((app) => {
            const active = targetLocked && snapshot.target.ruleId === app.id;
            return (
              <button
                key={app.id}
                type="button"
                className={`quick-target-button ${active ? 'active' : ''}`}
                aria-pressed={active}
                disabled={busy}
                onClick={() => onQuickLockTarget(app.id)}
              >
                <span className={`quick-target-icon ${app.tone}`} aria-hidden="true">{app.mark}</span>
                <span>{app.label}</span>
                <small>{active ? '已锁定' : '快捷锁定'}</small>
              </button>
            );
          })}
          <button
            type="button"
            className="quick-target-button custom"
            disabled={busy}
            onClick={onOpenCustomTarget}
          >
            <span className="quick-target-icon custom" aria-hidden="true">+</span>
            <span>自定义</span>
            <small>添加软件</small>
          </button>
        </div>

        <div className={`quick-target-status ${targetLost ? 'lost' : targetLocked ? 'locked' : ''}`} aria-live="polite">
          <span aria-hidden="true">{targetLost ? '!' : targetLocked ? '✓' : '◎'}</span>
          <div>
            <strong>{snapshot.target.appName || (targetLost ? '历史目标已丢失' : '尚未锁定软件')}</strong>
            <small>{targetLost ? '已停止发送按键，请重新选择' : targetLocked ? '软件失焦时将自动恢复窗口焦点' : '未运行的软件不会被锁定'}</small>
          </div>
          {snapshot.target.focusProtection && (
            <button className="text-button danger-text" type="button" disabled={busy} onClick={onClearTarget}>解除</button>
          )}
        </div>
      </article>

      <article className="card compact-card page-mode-card">
        <div className="compact-heading">
          <div>
            <p className="eyebrow">控制偏好</p>
            <h2>翻页模式</h2>
          </div>
          <StatusIcon tone="blue" symbol="↕" />
        </div>
        <div className="segmented-control" aria-label="默认翻页模式">
          <button
            type="button"
            aria-pressed={snapshot.pageTurnMode === 'vertical'}
            className={snapshot.pageTurnMode === 'vertical' ? 'selected' : ''}
            onClick={() => onPageModeChange('vertical')}
          >
            ↑↓ 上下翻页
          </button>
          <button
            type="button"
            aria-pressed={snapshot.pageTurnMode === 'horizontal'}
            className={snapshot.pageTurnMode === 'horizontal' ? 'selected' : ''}
            onClick={() => onPageModeChange('horizontal')}
          >
            ←→ 左右翻页
          </button>
        </div>
        <p className="compact-note">变更后会同步到已连接的手机控制器</p>
      </article>

      <article className="card compact-card metric-card">
        <div className="compact-heading">
          <div>
            <p className="eyebrow">实时状态</p>
            <h2>已连接设备</h2>
          </div>
          <StatusIcon tone="blue" symbol="▯" />
        </div>
        <strong className="metric-value">{snapshot.connectedClients}<small> 台</small></strong>
        <p className="compact-note">通过当前局域网连接</p>
      </article>

      <article className="card compact-card metric-card">
        <div className="compact-heading">
          <div>
            <p className="eyebrow">系统检查</p>
            <h2>系统权限</h2>
          </div>
          <StatusIcon tone={snapshot.permissionStatus === 'missing' ? 'amber' : 'green'} symbol="✓" />
        </div>
        <strong className={snapshot.permissionStatus === 'missing' ? 'permission-warning' : 'permission-good'}>
          {permissionText}
        </strong>
        <p className="compact-note">控制前会再次验证系统能力</p>
        {snapshot.permissionStatus === 'missing' && (
          <div className="permission-actions">
            <button className="text-button" type="button" onClick={onOpenPermissionSettings}>
              打开辅助功能设置
            </button>
            <button className="text-button" type="button" onClick={onRefreshPermissions}>
              重新检测
            </button>
          </div>
        )}
      </article>

      <article className="card compact-card metric-card">
        <div className="compact-heading">
          <div>
            <p className="eyebrow">诊断摘要</p>
            <h2>最近状态</h2>
          </div>
          <StatusIcon tone={snapshot.serviceError ? 'amber' : 'green'} symbol="⌁" />
        </div>
        <strong className={snapshot.serviceError ? 'permission-warning' : 'status-good'}>{statusText}</strong>
        <button className="text-button" type="button" onClick={() => void window.decktap.openLogFolder()}>
          打开日志目录
        </button>
      </article>
    </div>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [activePage, setActivePage] = useState<NavKey>('home');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let mounted = true;
    void window.decktap.getSnapshot()
      .then((value) => mounted && setSnapshot(value))
      .catch(() => mounted && setActionError('无法读取客户端状态，请重新启动 DeckTap。'));
    const unsubscribe = window.decktap.onSnapshotChanged((value) => {
      if (mounted) setSnapshot(value);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    document.documentElement.dataset.theme = snapshot.theme.effective;
    document.documentElement.style.colorScheme = snapshot.theme.effective;
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    if (!snapshot?.controlUrl) {
      setQrDataUrl('');
      return;
    }
    setQrLoading(true);
    void QRCode.toDataURL(snapshot.controlUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: { dark: '#111827', light: '#ffffff' },
    }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setActionError('二维码生成失败，请使用控制地址连接。');
    }).finally(() => {
      if (!cancelled) setQrLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot?.controlUrl]);

  const pageCopy = useMemo(() => PAGE_COPY[activePage], [activePage]);

  if (!snapshot) return <LoadingScreen />;

  const runAction = async (action: () => Promise<AppSnapshot>) => {
    setBusy(true);
    setActionError('');
    try {
      setSnapshot(await action());
    } catch {
      setActionError('操作未完成，请查看日志后重试。');
    } finally {
      setBusy(false);
    }
  };

  const setTheme = (themeSource: ThemeSource) => {
    void runAction(() => window.decktap.setTheme(themeSource));
  };

  const setPageTurnMode = (mode: PageTurnMode) => {
    void runAction(() => window.decktap.setPageTurnMode(mode));
  };

  const toggleService = () => {
    void runAction(() => snapshot.serviceState === 'running'
      ? window.decktap.stopService()
      : window.decktap.startService());
  };

  const rotatePairing = () => {
    if (snapshot.connectedClients > 0 && !window.confirm('轮换配对码会断开当前手机，需要重新扫码。是否继续？')) return;
    void runAction(() => window.decktap.rotatePairing());
  };

  const copyControlUrl = async () => {
    const success = await window.decktap.copyControlUrl();
    if (!success) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const clearTarget = () => {
    void runAction(() => window.decktap.clearTarget());
  };

  const scanMediaTargets = (includeUnrecognized = false) => {
    void runAction(() => window.decktap.scanMediaTargets(includeUnrecognized));
  };

  const selectMediaTarget = (candidateId: string) => {
    void runAction(() => window.decktap.selectMediaTarget(candidateId));
  };

  const quickLockMediaApp = async (ruleId: string) => {
    setBusy(true);
    setActionError('');
    try {
      const result = await window.decktap.lockMediaApp(ruleId);
      setSnapshot(result.snapshot);
      if (result.outcome === 'multiple') {
        setActivePage('target');
      } else if (result.outcome === 'not-running') {
        const appName = QUICK_TARGET_APPS.find((app) => app.id === ruleId)?.label || '该软件';
        setActionError(`未检测到正在运行的 ${appName}，请先启动软件后重试。`);
      }
    } catch {
      setActionError('快捷锁定未完成，请检查软件是否运行及系统权限。');
    } finally {
      setBusy(false);
    }
  };

  const openCustomTarget = () => {
    setActivePage('target');
    scanMediaTargets(true);
  };

  const addCustomApp = (candidateId: string, displayName: string) => {
    void runAction(() => window.decktap.addCustomApp(candidateId, displayName));
  };

  const removeCustomApp = (customAppId: string) => {
    if (!window.confirm('删除后，该软件将恢复为未识别状态。是否继续？')) return;
    void runAction(() => window.decktap.removeCustomApp(customAppId));
  };

  const disconnectDevice = (deviceId: string) => {
    if (!window.confirm('断开后，此手机需要重新扫描二维码才能继续控制。是否继续？')) return;
    void runAction(() => window.decktap.disconnectDevice(deviceId));
  };

  const disconnectAllDevices = () => {
    if (!window.confirm('确定断开当前全部手机吗？设备需要重新扫码才能继续控制。')) return;
    void runAction(() => window.decktap.disconnectAllDevices());
  };

  const openPermissionSettings = async () => {
    setActionError('');
    try {
      const result = await window.decktap.openPermissionSettings();
      if (!result.opened) setActionError('当前平台没有可打开的辅助功能设置页面。');
    } catch {
      setActionError('无法打开系统设置，请手动进入隐私与安全设置。');
    }
  };

  const refreshPermissions = () => {
    void runAction(() => window.decktap.refreshPermissions());
  };

  const setStartServiceOnLaunch = (enabled: boolean) => {
    void runAction(() => window.decktap.setStartServiceOnLaunch(enabled));
  };

  const setCloseToTray = (enabled: boolean) => {
    void runAction(() => window.decktap.setCloseToTray(enabled));
  };

  const setLaunchAtLogin = (enabled: boolean) => {
    void runAction(() => window.decktap.setLaunchAtLogin(enabled));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span>DeckTap</span>
        </div>
        <nav aria-label="客户端导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={activePage === item.key ? 'nav-item active' : 'nav-item'}
              aria-current={activePage === item.key ? 'page' : undefined}
              onClick={() => setActivePage(item.key)}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>DeckTap {snapshot.app.version}</span>
          <span>本地网络模式</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{pageCopy.title}</h1>
            <p>{pageCopy.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <label className="theme-picker">
              <span>外观</span>
              <select value={snapshot.theme.source} onChange={(event) => setTheme(event.target.value as ThemeSource)}>
                <option value="system">跟随系统</option>
                <option value="light">浅色模式</option>
                <option value="dark">深色模式</option>
              </select>
            </label>
            <ServiceBadge state={snapshot.serviceState} />
          </div>
        </header>

        {actionError && <div className="error-banner" role="alert">{actionError}</div>}

        {activePage === 'home' ? (
          <HomePage
            snapshot={snapshot}
            onPageModeChange={setPageTurnMode}
            onRotatePairing={rotatePairing}
            qrDataUrl={qrDataUrl}
            qrLoading={qrLoading}
            onServiceToggle={toggleService}
            busy={busy}
            copied={copied}
            onCopy={() => void copyControlUrl()}
            onClearTarget={clearTarget}
            onOpenCustomTarget={openCustomTarget}
            onOpenPermissionSettings={() => void openPermissionSettings()}
            onQuickLockTarget={(ruleId) => void quickLockMediaApp(ruleId)}
            onRefreshPermissions={refreshPermissions}
          />
        ) : activePage === 'target' ? (
          <TargetPage
            snapshot={snapshot}
            busy={busy}
            onAddCustomApp={addCustomApp}
            onClearTarget={clearTarget}
            onRemoveCustomApp={removeCustomApp}
            onScan={scanMediaTargets}
            onSelect={selectMediaTarget}
          />
        ) : activePage === 'devices' ? (
          <DevicesPage
            snapshot={snapshot}
            busy={busy}
            onDisconnect={disconnectDevice}
            onDisconnectAll={disconnectAllDevices}
            onRotatePairing={rotatePairing}
            onServiceToggle={toggleService}
          />
        ) : activePage === 'logs' ? (
          <LogsPage />
        ) : activePage === 'controls' ? (
          <ControlsPage snapshot={snapshot} busy={busy} onPageModeChange={setPageTurnMode} />
        ) : (
          <SettingsPage
            snapshot={snapshot}
            busy={busy}
            onCloseToTrayChange={setCloseToTray}
            onLaunchAtLoginChange={setLaunchAtLogin}
            onStartServiceOnLaunchChange={setStartServiceOnLaunch}
            onThemeChange={setTheme}
          />
        )}
      </main>
    </div>
  );
}
