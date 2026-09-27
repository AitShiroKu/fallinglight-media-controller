import React, { useEffect, useState } from 'react';
import { useI18n } from './services/i18n';
import { useAuthStore } from './stores/useAuthStore';
import { usePlayerStore } from './stores/usePlayerStore';
import { useVUStore } from './stores/useVUStore';
import { usePlaylistStore } from './stores/usePlaylistStore';
import { useFileStore } from './stores/useFileStore';
import { useSettingsStore } from './stores/useSettingsStore';
import { useStreamingStore } from './stores/useStreamingStore';
import PlayerDeck from './components/PlayerDeck';
import PlaylistDeck from './components/PlaylistDeck';
import FileManager from './components/FileManager';
import SchedulerDeck from './components/SchedulerDeck';
import SettingsDeck from './components/SettingsDeck';
import AuthModal from './components/AuthModal';
import { schedulerEngine } from './services/scheduler-engine';
import {
  Music,
  Folder,
  Calendar,
  Settings,
  Radio,
  Globe,
  LogOut,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
} from 'lucide-react';

function QuickVUBar() {
  const left = useVUStore((s) => s.vu.left);
  return (
    <div className="hidden md:flex items-center gap-1.5 bg-dark-950/80 px-2.5 py-1 rounded-lg border border-dark-600/50">
      <span className="text-[9px] font-mono text-muted">VU</span>
      <div className="w-16 h-2 bg-dark-700 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-rose-500 transition-all duration-75"
          style={{ width: `${Math.round(left * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function App() {
  const { lang, toggleLang, t } = useI18n();
  const { isAuthenticated, checkAuth, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'player' | 'schedule' | 'files' | 'settings'>('player');
  const [clockTime, setClockTime] = useState('');
  const [scheduledAlert, setScheduledAlert] = useState<string | null>(null);

  // Collapsible Sidebar State (persisted in localStorage)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fallinglight_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fallinglight_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  const { isDucked, toggleDucking } = usePlayerStore();
  const { items: playlistItems, currentIndex } = usePlaylistStore();
  const { files, folders, loadFiles } = useFileStore();
  const { settings, loadSettings } = useSettingsStore();
  const { isStreaming, receiverCount, checkStatus } = useStreamingStore();

  useEffect(() => {
    // Check authentication & streaming on initial load
    checkAuth();

    // Start live broadcast clock
    const updateClock = () => {
      setClockTime(new Date().toLocaleTimeString('en-US', { hour12: false }));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);

    return () => clearInterval(timer);
  }, [checkAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      loadSettings();
      loadFiles();
      checkStatus();

      // Start autonomous client scheduler engine
      schedulerEngine.start();
      const unsubAlert = schedulerEngine.onAlert((msg) => {
        setScheduledAlert(msg);
      });

      return () => {
        unsubAlert();
        schedulerEngine.stop();
      };
    }
  }, [isAuthenticated, loadSettings, loadFiles, checkStatus]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (settings?.warnOnClose) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [settings?.warnOnClose]);

  return (
    <div className="flex flex-col h-screen w-screen bg-dark-900 text-gray-100 overflow-hidden font-sans select-none">
      {/* Auth Modal Gate */}
      <AuthModal />

      {/* Scheduled Job Alert Toast */}
      {scheduledAlert && (
        <div className="fixed top-16 right-4 sm:right-8 z-50 bg-indigo-600/95 text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-2xl border border-indigo-400/50 flex items-center gap-2.5 backdrop-blur-md animate-bounce">
          <div className="w-6 h-6 rounded-full bg-yellow-400 text-dark-900 flex items-center justify-center font-bold shrink-0">
            <Bell className="w-3.5 h-3.5" />
          </div>
          <span>{scheduledAlert}</span>
        </div>
      )}

      {/* Top Broadcast Bar */}
      <header className="h-14 bg-dark-800/90 backdrop-blur-md border-b border-dark-500/70 px-3 sm:px-6 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Sidebar Collapse Toggle Button */}
          <button
            onClick={toggleSidebar}
            className="touch-btn hidden md:flex items-center justify-center w-8 h-8 rounded-xl bg-dark-700 hover:bg-dark-600 border border-dark-500 text-muted hover:text-white transition"
            title={isSidebarCollapsed ? t('expand_sidebar') : t('collapse_sidebar')}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4 text-accent" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>

          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center text-white shadow-lg shadow-accent/25 shrink-0">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-2">
              FallingLight
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">
                React v2
              </span>
            </h1>
            <p className="text-[10px] text-muted -mt-0.5 hidden sm:block">
              {t('header_subtitle')} — PR Room Deck
            </p>
          </div>
        </div>

        {/* Center: Live Broadcast Clock & Mini VU Meter & Streaming Status */}
        <div className="flex items-center gap-3 sm:gap-4">
          {isStreaming && (
            <div className="hidden sm:flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-emerald-400 font-mono text-xs animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-bold text-[10px] uppercase">STREAM LIVE ({receiverCount})</span>
            </div>
          )}

          <div className="font-mono text-xs sm:text-sm font-semibold text-accent-light tracking-wider bg-dark-950/70 px-3 py-1 rounded-lg border border-dark-600/50 shadow-inner">
            {clockTime || '00:00:00'}
          </div>

          {/* Quick VU indicator */}
          <QuickVUBar />
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Mic Ducking Quick Button */}
          <button
            onClick={toggleDucking}
            className={`touch-btn min-h-[36px] px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm ${
              isDucked
                ? 'bg-rose-500 border border-rose-400 text-white shadow-rose-500/30 animate-pulse'
                : 'bg-dark-700 hover:bg-dark-600 text-yellow-400 border border-dark-500/80'
            }`}
            title="Microphone Ducking"
          >
            <Radio className="w-3.5 h-3.5" />
            <span className="text-[11px] hidden sm:inline">
              {isDucked ? t('btn_mic_active') : t('btn_mic')}
            </span>
          </button>

          {/* Language Switcher */}
          <button
            onClick={toggleLang}
            className="touch-btn min-h-[36px] px-2.5 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 border border-dark-500 text-xs font-semibold text-gray-300 flex items-center gap-1.5 transition"
            title="Switch Language"
          >
            <Globe className="w-3.5 h-3.5 text-accent" />
            <span className="uppercase text-[11px] font-bold">{lang}</span>
          </button>

          {/* Logout Button */}
          {isAuthenticated && (
            <button
              onClick={logout}
              className="touch-btn min-h-[36px] w-9 h-9 rounded-xl bg-dark-700 hover:bg-rose-500/20 text-muted hover:text-rose-400 border border-dark-500 flex items-center justify-center transition"
              title={t('btn_logout')}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar Navigation (Collapsible) */}
        <aside
          className={`${
            isSidebarCollapsed ? 'w-16 p-2 items-center' : 'w-52 p-3.5'
          } bg-dark-800/50 border-r border-dark-500/60 hidden md:flex flex-col gap-1.5 shrink-0 transition-all duration-300 ease-in-out`}
        >
          {/* Header row with collapse toggle inside sidebar */}
          <div
            className={`flex items-center w-full ${
              isSidebarCollapsed ? 'justify-center' : 'justify-between px-1'
            } mb-1`}
          >
            {!isSidebarCollapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                Menu
              </span>
            )}
            <button
              onClick={toggleSidebar}
              className="touch-btn w-7 h-7 rounded-lg bg-dark-700/60 hover:bg-dark-600 border border-dark-600/60 text-muted hover:text-white flex items-center justify-center transition"
              title={isSidebarCollapsed ? t('expand_sidebar') : t('collapse_sidebar')}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-3.5 h-3.5 text-accent" />
              ) : (
                <PanelLeftClose className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <button
            onClick={() => setActiveTab('player')}
            className={`flex items-center ${
              isSidebarCollapsed ? 'justify-center w-11 h-11' : 'gap-2.5 px-3 py-2.5 w-full'
            } rounded-xl text-xs font-semibold transition ${
              activeTab === 'player'
                ? 'bg-accent text-white shadow-md shadow-accent/25 font-bold'
                : 'text-gray-300 hover:bg-dark-700/60'
            }`}
            title={isSidebarCollapsed ? t('tab_player') : undefined}
          >
            <Music className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span>{t('tab_player')}</span>}
          </button>

          <button
            onClick={() => setActiveTab('files')}
            className={`flex items-center ${
              isSidebarCollapsed ? 'justify-center w-11 h-11' : 'gap-2.5 px-3 py-2.5 w-full'
            } rounded-xl text-xs font-semibold transition ${
              activeTab === 'files'
                ? 'bg-accent text-white shadow-md shadow-accent/25 font-bold'
                : 'text-gray-300 hover:bg-dark-700/60'
            }`}
            title={isSidebarCollapsed ? t('tab_files') : undefined}
          >
            <Folder className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span>{t('tab_files')}</span>}
          </button>

          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex items-center ${
              isSidebarCollapsed ? 'justify-center w-11 h-11' : 'gap-2.5 px-3 py-2.5 w-full'
            } rounded-xl text-xs font-semibold transition ${
              activeTab === 'schedule'
                ? 'bg-accent text-white shadow-md shadow-accent/25 font-bold'
                : 'text-gray-300 hover:bg-dark-700/60'
            }`}
            title={isSidebarCollapsed ? t('tab_schedule') : undefined}
          >
            <Calendar className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span>{t('tab_schedule')}</span>}
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center ${
              isSidebarCollapsed ? 'justify-center w-11 h-11' : 'gap-2.5 px-3 py-2.5 w-full'
            } rounded-xl text-xs font-semibold transition ${
              activeTab === 'settings'
                ? 'bg-accent text-white shadow-md shadow-accent/25 font-bold'
                : 'text-gray-300 hover:bg-dark-700/60'
            }`}
            title={isSidebarCollapsed ? t('tab_settings') : undefined}
          >
            <Settings className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span>{t('tab_settings')}</span>}
          </button>

          {/* System Telemetry Info */}
          {!isSidebarCollapsed ? (
            <div className="mt-auto p-3 bg-dark-900/70 rounded-2xl border border-dark-600/40 text-[11px] text-muted flex flex-col gap-1 animate-in fade-in duration-200">
              <span className="font-semibold text-gray-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                Engine Status
              </span>
              <div className="flex justify-between">
                <span>Web Audio:</span>
                <span className="text-emerald-400 font-mono">Active</span>
              </div>
              <div className="flex justify-between">
                <span>Files / Folders:</span>
                <span className="font-mono text-gray-300">
                  {files.length} / {folders.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Playlist Items:</span>
                <span className="font-mono text-accent-light">{playlistItems.length}</span>
              </div>
            </div>
          ) : (
            <div
              className="mt-auto flex flex-col items-center gap-1 p-2 bg-dark-900/70 rounded-xl border border-dark-600/40 text-muted w-11 text-center cursor-default"
              title={`Engine: Active | Files: ${files.length} | Folders: ${folders.length} | Playlist: ${playlistItems.length}`}
            >
              <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
              <span className="font-mono text-[9px] text-accent-light font-bold">
                {playlistItems.length}
              </span>
            </div>
          )}
        </aside>

        {/* Tab Content Area */}
        <main className="flex-1 overflow-auto p-3 sm:p-5 flex flex-col gap-4">
          {/* Tab 1: Broadcast Player & Playlist Deck */}
          <div className={`flex-1 flex-col lg:flex-row gap-5 h-full overflow-hidden ${activeTab === 'player' ? 'flex' : 'hidden'}`}>
            <PlayerDeck />
            <PlaylistDeck />
          </div>

          {/* Tab 2: File Manager & YouTube Downloader */}
          <div className={`flex-1 flex-col h-full overflow-hidden ${activeTab === 'files' ? 'flex' : 'hidden'}`}>
            <FileManager onNavigateToPlayer={() => setActiveTab('player')} />
          </div>

          {/* Tab 3: Scheduler */}
          <div className={`flex-1 flex-col h-full overflow-hidden ${activeTab === 'schedule' ? 'flex' : 'hidden'}`}>
            <SchedulerDeck />
          </div>

          {/* Tab 4: System Settings */}
          <div className={`flex-1 flex-col h-full overflow-hidden ${activeTab === 'settings' ? 'flex' : 'hidden'}`}>
            <SettingsDeck />
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Dock */}
      <nav className="h-16 bg-dark-800/95 backdrop-blur-md border-t border-dark-500/70 flex md:hidden items-center justify-around shrink-0 z-30 px-2">
        <button
          onClick={() => setActiveTab('player')}
          className={`touch-btn flex flex-col items-center justify-center w-16 h-12 rounded-xl transition ${
            activeTab === 'player' ? 'text-accent font-bold' : 'text-muted hover:text-white'
          }`}
        >
          <Music className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">{t('tab_player')}</span>
        </button>

        <button
          onClick={() => setActiveTab('files')}
          className={`touch-btn flex flex-col items-center justify-center w-16 h-12 rounded-xl transition ${
            activeTab === 'files' ? 'text-accent font-bold' : 'text-muted hover:text-white'
          }`}
        >
          <Folder className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">{t('tab_files')}</span>
        </button>

        <button
          onClick={() => setActiveTab('schedule')}
          className={`touch-btn flex flex-col items-center justify-center w-16 h-12 rounded-xl transition ${
            activeTab === 'schedule' ? 'text-accent font-bold' : 'text-muted hover:text-white'
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">{t('tab_schedule')}</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`touch-btn flex flex-col items-center justify-center w-16 h-12 rounded-xl transition ${
            activeTab === 'settings' ? 'text-accent font-bold' : 'text-muted hover:text-white'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">{t('tab_settings')}</span>
        </button>
      </nav>
    </div>
  );
}
