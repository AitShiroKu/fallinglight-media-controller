import React, { useState, useEffect } from 'react';
import { useSettingsStore, AppSettings } from '../stores/useSettingsStore';
import { useStreamingStore } from '../stores/useStreamingStore';
import { useI18n } from '../services/i18n';
import StreamingDebugModal from './StreamingDebugModal';
import { copyToClipboard } from '../utils/clipboard';
import {
  Settings,
  Radio,
  Copy,
  Check,
  Activity,
  Volume2,
  Sliders,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';

export default function SettingsDeck() {
  const { settings, saveSettings } = useSettingsStore();
  const {
    isStreaming,
    roomId,
    receiverCount,
    enableStreaming,
    disableStreaming,
    checkStatus,
  } = useStreamingStore();

  const { t } = useI18n();

  const [form, setForm] = useState<AppSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copiedUniversal, setCopiedUniversal] = useState(false);
  const [copiedRoom, setCopiedRoom] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleToggleStreaming = async () => {
    if (isStreaming) {
      await disableStreaming();
    } else {
      await enableStreaming();
    }
  };

  const handleCopyUniversalLink = async (subPath = '/stream') => {
    const url = `${window.location.origin}${subPath}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopiedUniversal(true);
      setTimeout(() => setCopiedUniversal(false), 3000);
    }
  };

  const handleCopyRoomLink = async () => {
    if (!roomId) return;
    const url = `${window.location.origin}/stream?room=${roomId}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopiedRoom(true);
      setTimeout(() => setCopiedRoom(false), 3000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const ok = await saveSettings(form);
    setIsSaving(false);
    if (ok) {
      setStatusMessage(t('settings_saved'));
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full flex flex-col gap-5 pb-10">
      {/* Streaming Diagnostics Modal */}
      <StreamingDebugModal
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
      />

      {/* Header Banner */}
      <div className="bg-dark-800/80 border border-dark-500/80 rounded-3xl p-5 sm:p-6 flex items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-accent/20 text-accent flex items-center justify-center">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
              {t('settings_title')}
            </h2>
            <p className="text-xs text-muted -mt-0.5">
              Audio engine, streaming broadcast & telemetry configuration
            </p>
          </div>
        </div>

        {statusMessage && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs px-3.5 py-1.5 rounded-xl animate-in fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Card 1: Remote Streaming Broadcast Room */}
      <div className="bg-dark-800/80 border border-dark-500/80 rounded-3xl p-5 sm:p-6 flex flex-col gap-4 shadow-xl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
              isStreaming ? 'bg-emerald-500/20 text-emerald-400' : 'bg-dark-700 text-muted'
            }`}>
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                WebSocket Remote Streaming
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold ${
                  isStreaming
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-dark-700 text-muted'
                }`}>
                  {isStreaming ? t('streaming_connected') : t('streaming_off')}
                </span>
              </h3>
              <p className="text-[11px] text-muted">
                Synchronize playback with remote receivers across campus or LAN
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsDebugOpen(true)}
              className="touch-btn min-h-[36px] px-3 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 border border-dark-500 text-xs font-semibold text-gray-200 flex items-center gap-1.5 transition"
            >
              <Activity className="w-3.5 h-3.5 text-accent" />
              <span>{t('btn_stream_debug')}</span>
            </button>

            <button
              onClick={handleToggleStreaming}
              className={`touch-btn min-h-[36px] px-4 py-1.5 rounded-xl text-xs font-bold shadow-md transition ${
                isStreaming
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/25'
                  : 'bg-accent hover:bg-accent-light text-white shadow-accent/25'
              }`}
            >
              {isStreaming ? t('streaming_disable') : t('streaming_enable')}
            </button>
          </div>
        </div>

        {/* Connection Link Cards */}
        <div className="flex flex-col gap-3">
          {/* Universal Link Card (Recommended for campus speaker PCs) */}
          <div className="bg-dark-900/90 border border-emerald-500/30 rounded-2xl p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  Universal Broadcast URL (แนะนำสำหรับคอมพิวเตอร์ลำโพงทั้งหมด)
                </span>
                <p className="text-[11px] text-muted">
                  เปิดหน้านี้ทิ้งไว้บนคอมพิวเตอร์ลำโพงล่วงหน้าได้เลย ระบบจะเชื่อมต่อและรับเสียงอัตโนมัติทันทีที่เริ่มเปิดระบบ
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCopyUniversalLink('/stream')}
                className="touch-btn px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                {copiedUniversal ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUniversal ? 'Copied' : 'คัดลอก Universal Link'}</span>
              </button>
            </div>
            <div className="font-mono text-xs text-gray-300 bg-dark-950/80 px-3 py-1.5 rounded-xl border border-dark-700 select-all truncate">
              {`${typeof window !== 'undefined' ? window.location.origin : ''}/stream`}
            </div>

            {/* Quick mode sub-links */}
            <div className="flex items-center gap-2 pt-1 flex-wrap text-[11px] text-muted">
              <span>โหมดพิเศษ:</span>
              <button
                type="button"
                onClick={() => handleCopyUniversalLink('/stream/audio')}
                className="px-2 py-0.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-300 border border-dark-600 transition"
              >
                /stream/audio (เฉพาะเสียง)
              </button>
              <button
                type="button"
                onClick={() => handleCopyUniversalLink('/stream/video')}
                className="px-2 py-0.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-300 border border-dark-600 transition"
              >
                /stream/video (เฉพาะภาพ)
              </button>
            </div>
          </div>

          {/* Active Session Info (When streaming is active) */}
          {isStreaming && roomId && (
            <div className="bg-dark-900/60 border border-dark-600/70 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
              <div className="flex flex-col gap-0.5 text-xs truncate">
                <span className="text-[10px] uppercase font-mono text-muted">Specific Session URL (สำหรับระบุห้องเจาะจง):</span>
                <span className="font-mono text-accent font-semibold truncate text-[11px]">
                  {`${window.location.origin}/stream?room=${roomId}`}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-xl border border-emerald-500/20">
                  {receiverCount} เครื่องเชื่อมต่ออยู่
                </span>

                <button
                  type="button"
                  onClick={handleCopyRoomLink}
                  className="touch-btn px-3 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 text-white text-xs font-semibold flex items-center gap-1.5 border border-dark-500 transition"
                >
                  {copiedRoom ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedRoom ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Card 2: System Broadcast Audio Settings Form */}
      <form onSubmit={handleSubmit} className="bg-dark-800/80 border border-dark-500/80 rounded-3xl p-5 sm:p-6 flex flex-col gap-5 shadow-xl">
        <div className="flex items-center gap-2.5 pb-2 border-b border-dark-700">
          <Sliders className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-bold text-white">Audio Engine & Behavior</h3>
        </div>

        {/* Default Volume */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-gray-300">{t('label_default_volume')}</label>
            <span className="font-mono text-accent font-bold">
              {Math.round((form.defaultVolume ?? 0.8) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={form.defaultVolume ?? 0.8}
            onChange={(e) => setForm({ ...form, defaultVolume: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-dark-700 rounded-full appearance-none cursor-pointer accent-accent"
          />
        </div>

        {/* Fade Duration & Duck Volume Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Fade Duration */}
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-gray-300">{t('label_fade_duration')}</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={form.fadeDuration ?? 1.5}
              onChange={(e) => setForm({ ...form, fadeDuration: parseFloat(e.target.value) })}
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2 text-white focus:border-accent focus:outline-none font-mono"
            />
          </div>

          {/* Duck Volume (%) */}
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-gray-300">{t('label_duck_volume')}</label>
            <input
              type="number"
              min="0"
              max="100"
              value={Math.round((form.duckVolume ?? 0.12) * 100)}
              onChange={(e) => setForm({ ...form, duckVolume: parseFloat(e.target.value) / 100 })}
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2 text-white focus:border-accent focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* Duck Duration & YouTube Audio Quality */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Duck Duration (ms) */}
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-gray-300">{t('label_duck_duration')}</label>
            <input
              type="number"
              step="50"
              min="0"
              max="5000"
              value={form.duckDuration ?? 300}
              onChange={(e) => setForm({ ...form, duckDuration: parseInt(e.target.value) })}
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2 text-white focus:border-accent focus:outline-none font-mono"
            />
          </div>

          {/* YouTube Audio Quality */}
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-gray-300">{t('label_yt_quality')}</label>
            <select
              value={form.ytQuality ?? '0'}
              onChange={(e) => setForm({ ...form, ytQuality: e.target.value })}
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2 text-white focus:border-accent focus:outline-none"
            >
              <option value="0">{t('yt_quality_high')}</option>
              <option value="5">{t('yt_quality_medium')}</option>
              <option value="9">{t('yt_quality_low')}</option>
            </select>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-3 pt-2 border-t border-dark-700/60 text-xs">
          {/* Warn Before Close */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.warnOnClose ?? true}
              onChange={(e) => setForm({ ...form, warnOnClose: e.target.checked })}
              className="w-4 h-4 rounded accent-accent cursor-pointer"
            />
            <span className="text-gray-200 font-medium">{t('label_warn_on_close')}</span>
          </label>
        </div>

        {/* Submit Button */}
        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="touch-btn min-h-[44px] px-6 py-2.5 bg-accent hover:bg-accent-light text-white font-bold text-xs rounded-xl shadow-lg shadow-accent/25 flex items-center gap-2 transition active:scale-95 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>{isSaving ? 'Saving...' : t('btn_save_settings')}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
