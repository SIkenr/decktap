import { useEffect, useMemo, useState } from 'react';
import '../styles/timer.css';

interface TimerProps {
  networkTimeOffsetMs: number | null;
}

interface StoredTimerState {
  elapsedSeconds: number;
  isRunning: boolean;
  startedAt: number | null;
}

const TIMER_STORAGE_KEY = 'decktap.presentationTimer';

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

function readStoredTimerState(): StoredTimerState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TIMER_STORAGE_KEY) || '{}');
    const elapsedSeconds = Number(parsed.elapsedSeconds);
    const startedAt = Number(parsed.startedAt);
    return {
      elapsedSeconds: Number.isSafeInteger(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0,
      isRunning: parsed.isRunning === true,
      startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
    };
  } catch {
    return { elapsedSeconds: 0, isRunning: false, startedAt: null };
  }
}

function writeStoredTimerState(state: StoredTimerState) {
  try {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The timer still works for the current page when browser storage is unavailable.
  }
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

export function NetworkTime({ networkTimeOffsetMs }: TimerProps) {
  const [currentTimestamp, setCurrentTimestamp] = useState(Date.now());

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
    <section className="time-card network-time-card" aria-label="网络时间">
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
    </section>
  );
}

export function PresentationTimer() {
  const [timerState, setTimerState] = useState<StoredTimerState>(readStoredTimerState);
  const [currentTimestamp, setCurrentTimestamp] = useState(Date.now());

  const elapsedSeconds = timerState.isRunning && timerState.startedAt
    ? timerState.elapsedSeconds + Math.max(0, Math.floor((currentTimestamp - timerState.startedAt) / 1000))
    : timerState.elapsedSeconds;

  useEffect(() => {
    writeStoredTimerState(timerState);
  }, [timerState]);

  useEffect(() => {
    if (!timerState.isRunning) return undefined;
    const updateTimer = () => setCurrentTimestamp(Date.now());
    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [timerState.isRunning]);

  const startTimer = () => {
    setTimerState((previous) => (
      previous.isRunning
        ? previous
        : { elapsedSeconds: previous.elapsedSeconds, isRunning: true, startedAt: Date.now() }
    ));
  };

  const pauseTimer = () => {
    setTimerState((previous) => {
      if (!previous.isRunning || !previous.startedAt) return previous;
      return {
        elapsedSeconds: previous.elapsedSeconds + Math.max(0, Math.floor((Date.now() - previous.startedAt) / 1000)),
        isRunning: false,
        startedAt: null,
      };
    });
  };

  const resetTimer = () => {
    setTimerState({ elapsedSeconds: 0, isRunning: false, startedAt: null });
  };

  return (
    <section className="time-card presentation-timer-card" aria-label="计时器">
      <div className="time-card-heading">
        <div>
          <span className="section-kicker">本次演示</span>
          <h2>计时器</h2>
        </div>
        <span className={timerState.isRunning ? 'timer-state running' : 'timer-state'}>
          {timerState.isRunning ? '计时中' : elapsedSeconds > 0 ? '已暂停' : '未开始'}
        </span>
      </div>
      <output className="timer-display" aria-live="off">{formatDuration(elapsedSeconds)}</output>
      <div className="timer-controls">
        <button
          type="button"
          className="timer-button primary"
          disabled={timerState.isRunning}
          onClick={startTimer}
        >
          <span aria-hidden="true">▶</span>
          开始
        </button>
        <button
          type="button"
          className="timer-button"
          disabled={!timerState.isRunning}
          onClick={pauseTimer}
        >
          <span aria-hidden="true">Ⅱ</span>
          暂停
        </button>
        <button
          type="button"
          className="timer-button subtle"
          disabled={elapsedSeconds === 0}
          onClick={resetTimer}
        >
          <span aria-hidden="true">↺</span>
          重置
        </button>
      </div>
    </section>
  );
}
