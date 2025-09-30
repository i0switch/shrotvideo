import React from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, message: msg };
  }

  componentDidCatch(error: unknown, info: unknown) {
    try {
      // 最低限のログ
      // @ts-ignore
      console.error('[ErrorBoundary]', error, info);
      // Electron 環境ならメインへ転送
      // @ts-ignore
      if (window?.electronAPI?.onLogMessage) {
        // onLogMessageは購読APIなので、送信用にlogs APIを利用
        // @ts-ignore
        window.logs?.read?.().catch(() => {}); // no-op to ensure bridge loaded
      }
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, color: '#fff', background: '#8b0000' }}>
          <div style={{ fontWeight: 700 }}>レンダラーでエラーが発生しました</div>
          <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}>
            {this.state.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
