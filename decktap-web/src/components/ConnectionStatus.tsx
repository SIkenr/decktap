import type { FC } from 'react';

// 定义 props 类型
interface ConnectionStatusProps {
  status: {
    text: string;
    tone: 'neutral' | 'warning' | 'success' | 'error';
  };
}

export const ConnectionStatus: FC<ConnectionStatusProps> = ({ status }) => {
  return (
    <div className={`connection-pill ${status.tone}`} role="status" aria-live="polite">
      <span className="connection-dot" aria-hidden="true" />
      {status.text}
    </div>
  );
};
