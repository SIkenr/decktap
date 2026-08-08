import { useCallback, useEffect, useRef, useState } from 'react';

interface ConnectionStatus {
  text: string;
  tone: 'neutral' | 'warning' | 'success' | 'error';
}

export type ControllerPageTurnMode = 'vertical' | 'horizontal';
export type ControllerTargetStatus = 'unconfigured' | 'locked' | 'lost';

export interface ControllerTarget {
  appName: string | null;
  status: ControllerTargetStatus;
}

export interface CommandFeedback {
  text: string;
  tone: 'pending' | 'success' | 'warning' | 'error';
}

export type PairingStage = 'connecting' | 'code-required' | 'submitting' | 'paired' | 'error';

export enum WebSocketCommand {
  PREV = 'prev',
  NEXT = 'next',
  PREV_HORIZONTAL = 'prev-horizontal',
  NEXT_HORIZONTAL = 'next-horizontal'
}

const PROTOCOL_VERSION = 2;
const PAIRING_STORAGE_KEY = 'decktap.pairingToken';
const AUTH_FAILURE_CODES = new Set([4001, 4002, 4003, 4004, 4008]);

const COMMAND_ERROR_TEXT: Record<string, string> = {
  'target-lost': '控制目标已关闭，请在电脑上重新选择',
  'focus-failed': '无法恢复目标窗口焦点，本次没有发送按键',
  'keyboard-unavailable': '电脑端键盘控制不可用，请检查权限或重新启动',
  'control-failed': '电脑没有完成本次操作，请查看电脑端日志',
};

function readPairingToken(): string | null {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const tokenFromQr = fragment.get('pairing');

  if (tokenFromQr) {
    try {
      window.sessionStorage.setItem(PAIRING_STORAGE_KEY, tokenFromQr);
    } catch {
      // Pairing still works in browsers that block storage.
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return tokenFromQr;
  }

  try {
    return window.sessionStorage.getItem(PAIRING_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const pairingTokenRef = useRef<string | null>(null);
  const pairedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandSequenceRef = useRef(0);
  const pendingCommandIdRef = useRef<string | null>(null);
  const shouldReconnectRef = useRef(true);
  const isConnecting = useRef(false);
  const [isPaired, setIsPaired] = useState(false);
  const [controllerPageTurnMode, setControllerPageTurnMode] = useState<ControllerPageTurnMode | null>(null);
  const [controllerTarget, setControllerTarget] = useState<ControllerTarget>({
    appName: null,
    status: 'unconfigured',
  });
  const [commandFeedback, setCommandFeedback] = useState<CommandFeedback | null>(null);
  const [networkTimeOffsetMs, setNetworkTimeOffsetMs] = useState<number | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingStage, setPairingStage] = useState<PairingStage>('connecting');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    text: '等待安全连接',
    tone: 'neutral',
  });

  const setPairingFailed = useCallback((text: string) => {
    shouldReconnectRef.current = false;
    pairedRef.current = false;
    setIsPaired(false);
    setNetworkTimeOffsetMs(null);
    setPairingError(text);
    setPairingStage('error');
    try {
      window.sessionStorage.removeItem(PAIRING_STORAGE_KEY);
    } catch {
      // Nothing else is required when storage is unavailable.
    }
    setConnectionStatus({ text, tone: 'error' });
  }, []);

  const connect = useCallback(() => {
    if (!shouldReconnectRef.current || isConnecting.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    isConnecting.current = true;
    setPairingStage('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/control`);
    wsRef.current = socket;

    socket.onopen = () => {
      isConnecting.current = false;
      setConnectionStatus({ text: '正在检查设备授权…', tone: 'warning' });
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const message: unknown = JSON.parse(event.data);
        if (typeof message !== 'object' || message === null || !('type' in message)) return;

        if (message.type === 'paired' && 'v' in message && message.v === PROTOCOL_VERSION) {
          pairedRef.current = true;
          setIsPaired(true);
          setPairingError(null);
          setPairingStage('paired');
          setConnectionStatus({ text: '已安全连接', tone: 'success' });
          return;
        }

        if (message.type === 'pairing-required') {
          if (!pairingTokenRef.current) {
            setPairingFailed('此浏览器尚未授权，请重新扫描电脑上的二维码');
            return;
          }
          setPairingError(null);
          setPairingStage('code-required');
          setConnectionStatus({ text: '请输入电脑配对码', tone: 'warning' });
          return;
        }

        if (message.type === 'pairing-rejected') {
          if ('reason' in message && message.reason === 'invalid-code') {
            const remaining = 'remainingAttempts' in message && typeof message.remainingAttempts === 'number'
              ? Math.max(0, message.remainingAttempts)
              : null;
            setPairingError(remaining === null
              ? '数字配对码不正确，请重新输入'
              : `数字配对码不正确，还可尝试 ${remaining} 次`);
            setPairingStage(remaining === 0 ? 'error' : 'code-required');
            setConnectionStatus({ text: '数字配对失败', tone: 'error' });
            return;
          }
          setPairingFailed('扫码信息无效或已过期，请重新扫描二维码');
          socket.close();
          return;
        }

        if (message.type === 'command-rejected' && 'reason' in message && message.reason === 'rate-limit') {
          if ('id' in message && typeof message.id === 'string' && message.id !== pendingCommandIdRef.current) return;
          if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
          pendingCommandIdRef.current = null;
          setConnectionStatus({ text: '操作过快，请稍后再试', tone: 'warning' });
          setCommandFeedback({ text: '操作过快，请稍后再试', tone: 'warning' });
          window.setTimeout(() => {
            if (pairedRef.current) setConnectionStatus({ text: '已安全连接', tone: 'success' });
          }, 1200);
          return;
        }

        if (
          message.type === 'command-result'
          && 'id' in message
          && typeof message.id === 'string'
          && message.id === pendingCommandIdRef.current
          && 'status' in message
          && (message.status === 'ok' || message.status === 'error')
        ) {
          if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
          pendingCommandIdRef.current = null;
          if (message.status === 'ok') {
            setCommandFeedback({ text: '操作已完成', tone: 'success' });
            commandTimerRef.current = setTimeout(() => setCommandFeedback(null), 900);
          } else {
            const reason = 'reason' in message && typeof message.reason === 'string'
              ? message.reason
              : 'control-failed';
            setCommandFeedback({
              text: COMMAND_ERROR_TEXT[reason] || COMMAND_ERROR_TEXT['control-failed'],
              tone: 'error',
            });
            if (reason === 'target-lost') {
              setControllerTarget((current) => ({ ...current, status: 'lost' }));
            }
          }
          return;
        }

        if (
          message.type === 'controller-config'
          && 'pageTurnMode' in message
          && (message.pageTurnMode === 'vertical' || message.pageTurnMode === 'horizontal')
        ) {
          setControllerPageTurnMode(message.pageTurnMode);
        }

        if (
          message.type === 'controller-config'
          && 'serverTime' in message
          && typeof message.serverTime === 'number'
          && Number.isFinite(message.serverTime)
          && message.serverTime >= 0
        ) {
          setNetworkTimeOffsetMs(message.serverTime - Date.now());
        }

        if (
          message.type === 'controller-config'
          && 'target' in message
          && typeof message.target === 'object'
          && message.target !== null
          && 'status' in message.target
          && (message.target.status === 'unconfigured'
            || message.target.status === 'locked'
            || message.target.status === 'lost')
        ) {
          setControllerTarget({
            appName: 'appName' in message.target && typeof message.target.appName === 'string'
              ? message.target.appName
              : null,
            status: message.target.status,
          });
        }
      } catch {
        // Unknown messages never change authenticated controller state.
      }
    };

    socket.onclose = (event) => {
      if (wsRef.current === socket) wsRef.current = null;
      pairedRef.current = false;
      setIsPaired(false);
      setNetworkTimeOffsetMs(null);
      setPairingStage('connecting');
      isConnecting.current = false;
      if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
      pendingCommandIdRef.current = null;
      setCommandFeedback(null);

      if (AUTH_FAILURE_CODES.has(event.code)) {
        const text = event.code === 4001
          ? '电脑已更新配对码，请重新扫描二维码'
          : event.code === 4002
            ? '电脑已断开此设备，请重新扫描二维码'
            : event.code === 4004
              ? '已有新设备完成配对，当前设备授权已撤销'
            : '安全配对失败，请重新扫描二维码';
        setPairingFailed(text);
        return;
      }

      if (!shouldReconnectRef.current) return;

      setConnectionStatus({ text: '连接已断开，正在重试…', tone: 'error' });
      if (shouldReconnectRef.current) retryTimerRef.current = setTimeout(connect, 1000);
    };

    socket.onerror = () => {
      isConnecting.current = false;
      setConnectionStatus({ text: '连接异常，正在重试…', tone: 'error' });
    };
  }, [setPairingFailed]);

  const submitPairingCode = useCallback((code: string) => {
    const normalizedCode = code.replace(/\D/g, '').slice(0, 6);
    const token = pairingTokenRef.current;
    if (!/^\d{6}$/.test(normalizedCode)) {
      setPairingError('请输入电脑上显示的 6 位数字配对码');
      return false;
    }
    if (!token) {
      setPairingFailed('扫码信息缺失，请重新扫描电脑上的二维码');
      return false;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setPairingError('连接尚未就绪，请稍后重试');
      return false;
    }
    setPairingError(null);
    setPairingStage('submitting');
    setConnectionStatus({ text: '正在验证数字配对码…', tone: 'warning' });
    wsRef.current.send(JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'pair',
      token,
      code: normalizedCode,
    }));
    return true;
  }, [setPairingFailed]);

  const sendCommand = useCallback((command: WebSocketCommand) => {
    if (pairedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      commandSequenceRef.current += 1;
      const id = `${Date.now().toString(36)}-${commandSequenceRef.current.toString(36)}`;
      pendingCommandIdRef.current = id;
      setCommandFeedback({ text: '正在等待电脑确认…', tone: 'pending' });
      wsRef.current.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'command', command, id }));
      if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
      commandTimerRef.current = setTimeout(() => {
        pendingCommandIdRef.current = null;
        setCommandFeedback({ text: '电脑未确认本次操作，请检查目标窗口', tone: 'warning' });
      }, 2000);
    }
  }, []);

  useEffect(() => {
    pairingTokenRef.current = readPairingToken();
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      isConnecting.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
      pendingCommandIdRef.current = null;
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }
    };
  }, [connect]);

  return {
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
  };
}
