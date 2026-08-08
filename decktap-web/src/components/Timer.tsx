import { useEffect, useMemo, useState } from 'react';
import '../styles/timer.css';

interface TimerProps {
  networkTimeOffsetMs: number | null;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

const networkClockFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  second: '2-digit',
});

const networkDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

export function Timer({ networkTimeOffsetMs }: TimerProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTimestamp, setCurrentTimestamp] = useState(Date.now());

  useEffect(() => {
    if (!isRunning) return undefined;
    const interval = window.setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    const updateClock = () => setCurrentTimestamp(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const networkDate = useMemo(
    () => networkTimeOffsetMs === null ? null : new Date(currentTimestamp + networkTimeOffsetMs),
    [currentTimestamp, networkTimeOffsetMs],
  );

  return (
    <section className="time-card" aria-label="时间工具">
      <div className="network-time-panel">
        <div className="time-card-heading">
          <div>
            <span className="section-kicker">电脑同步</span>
            <h2>网络时间</h2>
          </div>
          <span className={networkDate ? 'sync-badge synced' : 'sync-badge'}>
            <span aria-hidden="true" />
            {networkDate ? '已同步' : '待连接'}
          </span>
        </div>
        <time className="network-clock" dateTime={networkDate?.toISOString()}>
          {networkDate ? networkClockFormatter.format(networkDate) : '--:--:--'}
        </time>
        <p>{networkDate ? networkDateFormatter.format(networkDate) : '安全连接电脑后自动同步'}</p>
      </div>

      <div className="time-divider" aria-hidden="true" />

      <div className="presentation-timer-panel">
        <div className="time-card-heading">
          <div>
            <span className="section-kicker">本次演示</span>
            <h2>计时器</h2>
          </div>
          <span className={isRunning ? 'timer-state running' : 'timer-state'}>
            {isRunning ? '计时中' : elapsedSeconds > 0 ? '已暂停' : '未开始'}
          </span>
        </div>
        <output className="timer-display" aria-live="off">{formatDuration(elapsedSeconds)}</output>
        <div className="timer-controls">
          <button
            type="button"
            className="timer-button primary"
            disabled={isRunning}
            onClick={() => setIsRunning(true)}
          >
            <span aria-hidden="true">▶</span>
            开始
          </button>
          <button
            type="button"
            className="timer-button"
            disabled={!isRunning}
            onClick={() => setIsRunning(false)}
          >
            <span aria-hidden="true">Ⅱ</span>
            暂停
          </button>
          <button
            type="button"
            className="timer-button subtle"
            disabled={elapsedSeconds === 0}
            onClick={() => {
              setElapsedSeconds(0);
              setIsRunning(false);
            }}
          >
            <span aria-hidden="true">↺</span>
            重置
          </button>
        </div>
      </div>
    </section>
  );
}
