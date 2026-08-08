import { useEffect, useState } from 'react';
import { ConnectionStatus } from './ConnectionStatus';
import { Timer } from './Timer';
import { useWebSocket, WebSocketCommand } from '../hooks/useWebSocket';
import '../styles/controller.css';

type PageTurnMode = 'vertical' | 'horizontal';

const PAGE_TURN_MODE_KEY = 'decktap.pageTurnMode';

function getInitialPageTurnMode(): PageTurnMode {
  try {
    return window.localStorage.getItem(PAGE_TURN_MODE_KEY) === 'horizontal'
      ? 'horizontal'
      : 'vertical';
  } catch {
    return 'vertical';
  }
}

function BrandMark() {
  return (
    <span className="mobile-brand-mark" aria-hidden="true">
      <span className="mobile-brand-signal">◔</span>
      <span>D</span>
    </span>
  );
}

export function Controller() {
  const [pairingCode, setPairingCode] = useState('');
  const [pageTurnMode, setPageTurnMode] = useState<PageTurnMode>(getInitialPageTurnMode);
  const {
    commandFeedback,
    connectionStatus,
    controllerPageTurnMode,
    controllerTarget,
    isPaired,
    networkTimeOffsetMs,
    pairingError,
    pairingStage,
    sendCommand,
    submitPairingCode,
  } = useWebSocket();

  useEffect(() => {
    if (!controllerPageTurnMode) return;
    setPageTurnMode(controllerPageTurnMode);
    try {
      window.localStorage.setItem(PAGE_TURN_MODE_KEY, controllerPageTurnMode);
    } catch {
      // The controller still works when browser storage is unavailable.
    }
  }, [controllerPageTurnMode]);

  const changePageTurnMode = (mode: PageTurnMode) => {
    setPageTurnMode(mode);
    try {
      window.localStorage.setItem(PAGE_TURN_MODE_KEY, mode);
    } catch {
      // The controller still works when browser storage is unavailable.
    }
  };

  const previousCommand = pageTurnMode === 'vertical'
    ? WebSocketCommand.PREV
    : WebSocketCommand.PREV_HORIZONTAL;
  const nextCommand = pageTurnMode === 'vertical'
    ? WebSocketCommand.NEXT
    : WebSocketCommand.NEXT_HORIZONTAL;
  const previousArrow = pageTurnMode === 'vertical' ? '↑' : '←';
  const nextArrow = pageTurnMode === 'vertical' ? '↓' : '→';
  const targetLost = controllerTarget.status === 'lost';
  const targetWaiting = controllerTarget.status === 'waiting';
  const controlsDisabled = !isPaired || targetLost || targetWaiting;
  const targetText = controllerTarget.status === 'locked'
    ? `已锁定 ${controllerTarget.appName || '演示软件'}`
    : targetWaiting
      ? `正在监控 ${controllerTarget.appName || '演示软件'} 的放映窗口`
    : controllerTarget.status === 'lost'
      ? '控制目标已丢失，请在电脑端重新选择'
      : '未锁定目标，将控制电脑当前前台窗口';
  const targetHint = controllerTarget.status === 'locked'
    ? '每次翻页前会先恢复该窗口焦点'
    : targetWaiting
      ? '开始放映后会自动锁定；等待期间不会发送按键'
    : controllerTarget.status === 'lost'
      ? '为避免误操作，当前不会发送按键'
      : '建议在电脑端锁定演示或媒体窗口';
  const targetSymbol = controllerTarget.status === 'locked'
    ? '✓'
    : targetWaiting ? '◌' : controllerTarget.status === 'lost' ? '!' : '◎';

  if (!isPaired) {
    const codeEntryEnabled = pairingStage === 'code-required' || pairingStage === 'submitting';
    return (
      <main className="controller-shell pairing-shell">
        <header className="mobile-header">
          <div className="mobile-brand">
            <BrandMark />
            <div>
              <strong>DeckTap</strong>
              <span>手机演示控制器</span>
            </div>
          </div>
          <ConnectionStatus status={connectionStatus} />
        </header>

        <section className="phone-pairing-card" aria-labelledby="phone-pairing-heading">
          <span className="phone-pairing-icon" aria-hidden="true">⌨</span>
          <span className="section-kicker">安全配对</span>
          <h1 id="phone-pairing-heading">输入电脑上的 6 位数字码</h1>
          <p>扫码只建立局域网连接，数字码验证成功后才会开放翻页控制。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (submitPairingCode(pairingCode)) setPairingCode('');
            }}
          >
            <label htmlFor="numeric-pairing-code">数字配对码</label>
            <input
              id="numeric-pairing-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={pairingCode}
              disabled={!codeEntryEnabled || pairingStage === 'submitting'}
              placeholder="000000"
              onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-describedby={pairingError ? 'pairing-error' : 'pairing-help'}
            />
            <button
              type="submit"
              disabled={pairingCode.length !== 6 || pairingStage !== 'code-required'}
            >
              {pairingStage === 'submitting' ? '正在验证…' : '确认配对'}
            </button>
          </form>
          {pairingError ? (
            <p id="pairing-error" className="phone-pairing-error" role="alert">{pairingError}</p>
          ) : (
            <p id="pairing-help" className="phone-pairing-help">
              {pairingStage === 'connecting' ? '正在连接电脑，请稍候…' : '配对成功后将自动进入控制页面'}
            </p>
          )}
        </section>

        <footer className="mobile-footer">
          <span>DeckTap 局域网数字配对</span>
          <span>数字码和控制数据不会上传互联网</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="controller-shell">
      <header className="mobile-header">
        <div className="mobile-brand">
          <BrandMark />
          <div>
            <strong>DeckTap</strong>
            <span>手机演示控制器</span>
          </div>
        </div>
        <ConnectionStatus status={connectionStatus} />
      </header>

      <section className={`target-card ${controllerTarget.status}`} aria-live="polite">
        <span className="target-card-icon" aria-hidden="true">{targetSymbol}</span>
        <div>
          <span className="section-kicker">控制目标</span>
          <strong>{targetText}</strong>
          <p>{targetHint}</p>
        </div>
      </section>

      <section className="mode-card" aria-labelledby="page-mode-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">快捷设置</span>
            <h2 id="page-mode-heading">翻页方向</h2>
          </div>
          <span className="current-mode">{pageTurnMode === 'vertical' ? '上下翻页' : '左右翻页'}</span>
        </div>
        <div className="mode-options" role="group" aria-label="翻页方向">
          <button
            type="button"
            className={pageTurnMode === 'vertical' ? 'mode-button active' : 'mode-button'}
            aria-pressed={pageTurnMode === 'vertical'}
            onClick={() => changePageTurnMode('vertical')}
          >
            <span aria-hidden="true">↑ ↓</span>
            上下翻页
          </button>
          <button
            type="button"
            className={pageTurnMode === 'horizontal' ? 'mode-button active' : 'mode-button'}
            aria-pressed={pageTurnMode === 'horizontal'}
            onClick={() => changePageTurnMode('horizontal')}
          >
            <span aria-hidden="true">← →</span>
            左右翻页
          </button>
        </div>
      </section>

      <section className="control-card" aria-labelledby="control-heading">
        <div className="section-heading control-heading">
          <div>
            <span className="section-kicker">演示控制</span>
            <h2 id="control-heading">翻页</h2>
          </div>
        </div>

        <div className="control-grid">
          <button
            type="button"
            className="page-control previous-control"
            disabled={controlsDisabled}
            onClick={() => sendCommand(previousCommand)}
            aria-label={`上一页，按键方向 ${previousArrow}`}
          >
            <span className="page-control-arrow" aria-hidden="true">{previousArrow}</span>
            <span>
              <small>Previous</small>
              上一页
            </span>
          </button>

          <button
            type="button"
            className="page-control next-control"
            disabled={controlsDisabled}
            onClick={() => sendCommand(nextCommand)}
            aria-label={`下一页，按键方向 ${nextArrow}`}
          >
            <span className="page-control-arrow" aria-hidden="true">{nextArrow}</span>
            <span>
              <small>Next</small>
              下一页
            </span>
          </button>
        </div>

        {!isPaired && (
          <p className="control-disabled-hint">完成安全连接后即可控制演示</p>
        )}
        {isPaired && targetLost && (
          <p className="control-disabled-hint error">目标窗口已丢失，本次不会发送按键</p>
        )}
      </section>

      {commandFeedback && (
        <div className={`command-feedback ${commandFeedback.tone}`} role="status" aria-live="polite">
          <span aria-hidden="true">{commandFeedback.tone === 'success' ? '✓' : 'i'}</span>
          {commandFeedback.text}
        </div>
      )}

      <Timer networkTimeOffsetMs={networkTimeOffsetMs} />

      <footer className="mobile-footer">
        <span>DeckTap 局域网模式</span>
        <span>连接和控制数据不会上传互联网</span>
      </footer>
    </main>
  );
}
