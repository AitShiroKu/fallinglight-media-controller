import React, { useEffect, useRef, useState } from 'react';
import { useFileStore } from '../stores/useFileStore';
import { useI18n } from '../services/i18n';
import { Search, Music, Video as VideoIcon, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
  url: string;
  isLive: boolean;
}

interface QueueItem {
  key: string;
  title: string;
  format: 'mp3' | 'mp4';
  status: 'downloading' | 'success' | 'error';
  progress: number;
  error?: string;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export default function YouTubeBrowser() {
  const { folders, currentFolder, loadFiles } = useFileStore();
  const { t } = useI18n();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [targetFolder, setTargetFolder] = useState(currentFolder);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => setTargetFolder(currentFolder), [currentFolder]);
  useEffect(() => () => Object.values(timers.current).forEach(clearInterval), []);

  const updateItem = (key: string, patch: Partial<QueueItem>) =>
    setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setError('');
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&limit=12`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('ytb_search_error'));
      setResults(data.results ?? []);
      if (!data.results?.length) setError(t('ytb_no_results'));
    } catch (err: any) {
      setResults([]);
      setError(err.message || t('ytb_search_error'));
    } finally {
      setSearching(false);
    }
  };

  const startDownload = async (item: SearchResult, format: 'mp3' | 'mp4') => {
    const key = `${item.id}-${format}`;
    if (queue.some((q) => q.key === key && q.status === 'downloading')) return;
    setQueue((q) => [{ key, title: item.title, format, status: 'downloading', progress: 0 }, ...q.filter((i) => i.key !== key)]);
    const folder = targetFolder;
    try {
      const res = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, format, folder }),
      });
      const data = await res.json();
      if (!res.ok || !data.jobId) throw new Error(data.error || t('youtube_error'));
      timers.current[key] = setInterval(async () => {
        try {
          const p = await fetch(`/api/youtube/progress/${data.jobId}`);
          if (!p.ok) return;
          const job = await p.json();
          if (job.status === 'success') {
            clearInterval(timers.current[key]);
            updateItem(key, { status: 'success', progress: 100 });
            loadFiles(folder);
          } else if (job.status === 'error') {
            clearInterval(timers.current[key]);
            updateItem(key, { status: 'error', error: job.error });
          } else {
            updateItem(key, { progress: Math.round(job.progress ?? 0) });
          }
        } catch {
          /* keep polling */
        }
      }, 1000);
    } catch (err: any) {
      updateItem(key, { status: 'error', error: err.message });
    }
  };

  return (
    <div id="youtube-browser" className="bg-dark-800/80 border border-dark-500/80 rounded-2xl p-3 sm:p-4 flex flex-col gap-3 shadow-lg">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs sm:text-sm font-bold text-accent flex items-center gap-2">
          <Search className="w-4 h-4" />
          {t('ytb_title')}
        </h3>
        <select
          value={targetFolder}
          onChange={(e) => setTargetFolder(e.target.value)}
          aria-label={t('yt_destination_folder')}
          className="bg-dark-900 border border-dark-600/70 rounded-xl px-2.5 py-1 text-xs text-gray-200 max-w-[200px]"
        >
          <option value="">(Root) {t('folder_root')}</option>
          {folders.map((f) => (
            <option key={f.path} value={f.path}>{f.path}</option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          id="ytb-search-input"
          type="search"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ytb_placeholder')}
          className="flex-1 bg-dark-900/90 border border-dark-600/70 rounded-xl px-3 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="touch-btn px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
        >
          {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          {t('ytb_btn_search')}
        </button>
      </form>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto pr-1">
          {results.map((r) => (
            <div key={r.id} className="bg-dark-900/70 border border-dark-600/60 rounded-xl overflow-hidden flex flex-col">
              <div className="relative aspect-video bg-dark-950">
                <img src={r.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
                {(r.duration != null || r.isLive) && (
                  <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-mono px-1.5 rounded">
                    {r.isLive ? 'LIVE' : formatDuration(r.duration)}
                  </span>
                )}
              </div>
              <div className="p-2 flex flex-col gap-1.5 flex-1">
                <a href={r.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-gray-100 line-clamp-2 hover:text-accent" title={r.title}>
                  {r.title}
                </a>
                <span className="text-[11px] text-muted truncate">{r.channel}</span>
                <div className="flex gap-1.5 mt-auto">
                  <button type="button" disabled={r.isLive} onClick={() => startDownload(r, 'mp3')}
                    className="touch-btn flex-1 px-2 py-1 rounded-lg bg-accent/90 hover:bg-accent text-white text-[11px] font-bold flex items-center justify-center gap-1 disabled:opacity-40">
                    <Music className="w-3 h-3" /> MP3
                  </button>
                  <button type="button" disabled={r.isLive} onClick={() => startDownload(r, 'mp4')}
                    className="touch-btn flex-1 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center justify-center gap-1 disabled:opacity-40">
                    <VideoIcon className="w-3 h-3" /> MP4
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-gray-300">{t('ytb_queue')}</span>
            <button type="button" onClick={() => setQueue((q) => q.filter((i) => i.status === 'downloading'))}
              className="text-[11px] text-muted hover:text-white flex items-center gap-1">
              <X className="w-3 h-3" /> {t('ytb_clear_done')}
            </button>
          </div>
          {queue.map((i) => (
            <div key={i.key} className="bg-dark-900/80 border border-dark-600/50 rounded-lg px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                {i.status === 'downloading' && <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" />}
                {i.status === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                {i.status === 'error' && <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />}
                <span className="truncate flex-1 text-gray-200">[{i.format.toUpperCase()}] {i.title}</span>
                <span className="font-mono text-muted">{i.progress}%</span>
              </div>
              {i.status === 'downloading' && (
                <div className="w-full h-1 bg-dark-700 rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${i.progress}%` }} />
                </div>
              )}
              {i.error && <p className="text-rose-400 truncate mt-0.5" title={i.error}>{i.error}</p>}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted">{t('ytb_notice')}</p>
    </div>
  );
}
