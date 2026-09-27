import React, { useEffect, useState } from 'react';
import { useStreamingStore } from '../stores/useStreamingStore';
import { useI18n } from '../services/i18n';
import {
  Activity,
  X,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Clock,
  Radio,
  Users,
} from 'lucide-react';

interface StreamingDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function StreamingDebugModal({ isOpen, onClose }: StreamingDebugModalProps) {
  const {
    debugData,
    loadDebugInfo,
    pruneSockets,
    resetRoom,
  } = useStreamingStore();

  const { t } = useI18n();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadDebugInfo();
      const interval = setInterval(loadDebugInfo, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen, loadDebugInfo]);

  if (!isOpen) return null;

  const handlePrune = async () => {
    setLoading(true);
    await pruneSockets();
    setLoading(false);
  };

  const handleReset = async () => {
    if (confirm(t('stream_reset_confirm'))) {
      setLoading(true);
      await resetRoom();
      setLoading(false);
      onClose();
    }
  };

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs}s`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-dark-800 border border-dark-500 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/20 text-accent flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t('stream_debug_title')}</h3>
              <p className="text-[10px] text-muted -mt-0.5">Real-time room telemetry & socket health</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="touch-btn text-muted hover:text-white p-1 rounded-lg hover:bg-dark-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Telemetry Stats Grid */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-dark-900/80 p-3 rounded-2xl border border-dark-600/50 flex flex-col gap-1">
            <span className="text-[10px] text-muted uppercase font-mono">Room Status</span>
            <span className={`font-bold font-mono ${debugData?.active ? 'text-emerald-400' : 'text-muted'}`}>
              {debugData?.active ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>

          <div className="bg-dark-900/80 p-3 rounded-2xl border border-dark-600/50 flex flex-col gap-1">
            <span className="text-[10px] text-muted uppercase font-mono">{t('stream_debug_uptime')}</span>
            <span className="font-mono font-bold text-accent">
              {debugData?.uptimeSeconds !== undefined ? formatUptime(debugData.uptimeSeconds) : '—'}
            </span>
          </div>

          <div className="bg-dark-900/80 p-3 rounded-2xl border border-dark-600/50 flex flex-col gap-1">
            <span className="text-[10px] text-muted uppercase font-mono">{t('stream_debug_sockets')}</span>
            <span className="font-mono font-bold text-gray-200">
              {debugData?.receiverCount ?? 0}
            </span>
          </div>
        </div>

        {/* Connected Receivers List */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-accent" />
              Connected Sockets
            </span>
            <button
              onClick={() => loadDebugInfo()}
              className="touch-btn text-[11px] text-muted hover:text-accent flex items-center gap-1 transition"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>

          <div className="bg-dark-900/90 rounded-2xl border border-dark-600/60 p-2 max-h-40 overflow-y-auto">
            {!debugData || !debugData.receivers || debugData.receivers.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted">
                No active receiver connections
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {debugData.receivers.map((r) => (
                  <div
                    key={r.index}
                    className="flex items-center justify-between p-2 rounded-xl bg-dark-800/80 text-xs font-mono"
                  >
                    <span className="text-gray-300">
                      #{r.index} — {r.remoteAddress}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                      r.readyState === 1
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {r.readyState === 1 ? 'OPEN' : 'CLOSING'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-dark-600/60">
          <button
            onClick={handlePrune}
            disabled={loading}
            className="touch-btn w-full sm:w-auto px-4 py-2 rounded-xl bg-dark-700 hover:bg-dark-600 text-gray-200 text-xs font-semibold border border-dark-500 flex items-center justify-center gap-1.5 transition disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('btn_prune_sockets')}</span>
          </button>

          <button
            onClick={handleReset}
            disabled={loading}
            className="touch-btn w-full sm:w-auto px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/25 flex items-center justify-center gap-1.5 transition disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('btn_force_reset_stream')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
