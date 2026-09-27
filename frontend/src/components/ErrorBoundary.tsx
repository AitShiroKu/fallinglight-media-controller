import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught an error]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleClearAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.href = '/';
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-dark-950 text-dark-100 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-dark-900/90 backdrop-blur border border-red-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 shrink-0">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h1 className="text-xl font-bold text-white tracking-wide">
                  Application Encountered an Error
                </h1>
                <p className="text-sm text-dark-400">
                  เกิดข้อผิดพลาดขึ้นในระบบ หน้าจอไม่สามารถแสดงผลได้ตามปกติ
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="bg-dark-950 border border-dark-800 rounded-xl p-4 overflow-hidden">
                <div className="text-xs font-semibold text-red-400 mb-1 uppercase tracking-wider">
                  Error Details
                </div>
                <div className="text-xs font-mono text-dark-300 break-words whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {this.state.error.name}: {this.state.error.message}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                onClick={this.handleReload}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-medium transition shadow-lg shadow-primary-600/20"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload / โหลดใหม่</span>
              </button>

              <button
                onClick={this.handleClearAndReload}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-white rounded-xl text-sm font-medium border border-dark-700/60 transition"
              >
                <Trash2 className="w-4 h-4 text-amber-400" />
                <span>Reset Cache / ล้างแคช</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
