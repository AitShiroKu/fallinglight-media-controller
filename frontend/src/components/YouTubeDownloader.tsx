import React, { useState, useEffect, useRef } from 'react';
import { useFileStore } from '../stores/useFileStore';
import { useI18n } from '../services/i18n';
import {
  Download,
  Music,
  Video as VideoIcon,
  Folder,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';

export default function YouTubeDownloader() {
  const { folders, currentFolder, loadFiles } = useFileStore();
  const { t } = useI18n();

  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'mp3' | 'mp4'>('mp3');
  const [targetFolder, setTargetFolder] = useState(currentFolder);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const pollTimerRef = useRef<any>(null);

  // Sync targetFolder with currentFolder when currentFolder changes
  useEffect(() => {
    setTargetFolder(currentFolder);
  }, [currentFolder]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();
    if (!cleanUrl || isDownloading) return;

    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      setErrorMessage('Please enter a valid YouTube URL (http/https)');
      return;
    }

    setIsDownloading(true);
    setProgress(0);
    setErrorMessage('');
    setSuccessMessage('');
    setStatusMessage(format === 'mp4' ? t('youtube_loading_mp4') : t('youtube_loading'));

    try {
      const res = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: cleanUrl,
          format,
          folder: targetFolder,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || t('youtube_error'));
      }

      const jobId = data.jobId;

      // Poll progress
      pollTimerRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/youtube/progress/${jobId}`);
          if (!pollRes.ok) return;
          const pollData = await pollRes.json();

          if (pollData.progress !== undefined) {
            setProgress(Math.round(pollData.progress));
          }

          if (pollData.status === 'success') {
            clearInterval(pollTimerRef.current);
            setIsDownloading(false);
            setProgress(100);
            setSuccessMessage(t('youtube_success'));
            setStatusMessage('');
            setUrl('');
            loadFiles(targetFolder);
            setTimeout(() => setSuccessMessage(''), 5000);
          } else if (pollData.status === 'error') {
            clearInterval(pollTimerRef.current);
            setIsDownloading(false);
            setErrorMessage(pollData.error || t('youtube_error'));
            setStatusMessage('');
          }
        } catch {
          // Keep polling
        }
      }, 1000);
    } catch (err: any) {
      setIsDownloading(false);
      setErrorMessage(err.message || t('youtube_error'));
      setStatusMessage('');
    }
  };

  return (
    <div className="bg-dark-800/80 border border-dark-500/80 rounded-2xl p-3 sm:p-4 flex flex-col justify-between gap-2.5 shadow-lg">
      {/* Header with Title & Format Toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-red-500/20 text-red-500 flex items-center justify-center font-bold text-xs">
            ▶
          </div>
          <h3 className="text-xs sm:text-sm font-bold text-accent">
            {t('youtube_title')}
          </h3>
        </div>

        {/* Format Selector: MP3 vs MP4 */}
        <div className="flex items-center bg-dark-950/80 border border-dark-600/70 rounded-xl p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setFormat('mp3')}
            className={`touch-btn px-2.5 py-1 rounded-lg flex items-center gap-1.5 font-bold transition text-[11px] ${
              format === 'mp3'
                ? 'bg-accent text-white shadow-sm'
                : 'text-muted hover:text-white'
            }`}
          >
            <Music className="w-3 h-3" />
            <span>{t('yt_format_mp3')}</span>
          </button>
          <button
            type="button"
            onClick={() => setFormat('mp4')}
            className={`touch-btn px-2.5 py-1 rounded-lg flex items-center gap-1.5 font-bold transition text-[11px] ${
              format === 'mp4'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-muted hover:text-white'
            }`}
          >
            <VideoIcon className="w-3 h-3" />
            <span>{t('yt_format_mp4')}</span>
          </button>
        </div>
      </div>

      {/* Destination Folder Selector */}
      <div className="flex items-center justify-between text-xs gap-2 px-0.5">
        <div className="flex items-center gap-1.5 text-muted">
          <Folder className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
          <span className="text-[11px]">{t('yt_destination_folder')}</span>
        </div>
        <select
          value={targetFolder}
          onChange={(e) => setTargetFolder(e.target.value)}
          className="bg-dark-900 border border-dark-600/70 rounded-xl px-2.5 py-1 text-xs text-gray-200 focus:border-accent focus:outline-none max-w-[200px] truncate"
        >
          <option value="">(Root) {t('folder_root')}</option>
          {folders.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
      </div>

      {/* URL Input Form */}
      <form onSubmit={handleDownload} className="flex gap-2 items-center">
        <div className="relative flex-1">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isDownloading}
            placeholder={t('youtube_placeholder')}
            className="w-full bg-dark-900/90 border border-dark-600/70 rounded-xl pl-3 pr-7 py-1.5 text-xs text-white placeholder-dark-500 focus:border-accent focus:outline-none transition disabled:opacity-60"
          />
          {url && !isDownloading && (
            <button
              type="button"
              onClick={() => setUrl('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white p-0.5 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={!url.trim() || isDownloading}
          className={`touch-btn min-h-[32px] px-3 py-1.5 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50 ${
            format === 'mp4'
              ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/25'
              : 'bg-accent hover:bg-accent-light shadow-accent/25'
          }`}
        >
          {isDownloading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{progress > 0 ? `${progress}%` : '...'}</span>
            </>
          ) : (
            <>
              <Download className="w-3 h-3" />
              <span>
                {format === 'mp4'
                  ? t('btn_fetch_youtube_mp4')
                  : t('btn_fetch_youtube_mp3')}
              </span>
            </>
          )}
        </button>
      </form>

      {/* Progress & Feedback Notifications */}
      {isDownloading && (
        <div className="bg-dark-900/90 border border-accent/40 rounded-2xl p-2.5 flex flex-col gap-1.5 animate-in fade-in">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-accent font-medium truncate flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              {statusMessage || 'Downloading media...'}
            </span>
            <span className="font-mono font-bold text-accent shrink-0">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-dark-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                format === 'mp4' ? 'bg-indigo-500' : 'bg-accent'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Success Notification */}
      {successMessage && (
        <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs px-3 py-2 rounded-xl flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="truncate">{successMessage}</span>
        </div>
      )}

      {/* Error Notification */}
      {errorMessage && (
        <div className="bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs px-3 py-2 rounded-xl flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
