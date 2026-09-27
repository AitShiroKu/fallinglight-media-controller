import React, { useState, useRef, useEffect } from 'react';
import { useFileStore, FileItem, FolderItem } from '../stores/useFileStore';
import { usePlaylistStore } from '../stores/usePlaylistStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import { audioEngine } from '../services/audio-engine';
import { useI18n } from '../services/i18n';
import CreateFolderModal from './CreateFolderModal';
import MoveFileModal from './MoveFileModal';
import YouTubeDownloader from './YouTubeDownloader';
import {
  Folder,
  FolderPlus,
  Upload,
  Search,
  Trash2,
  Play,
  Pause,
  Plus,
  FolderInput,
  Home,
  ChevronRight,
  ChevronDown,
  Music,
  Video as VideoIcon,
  GripVertical,
  RefreshCw,
  X,
  Download,
  Sparkles,
} from 'lucide-react';

interface FileManagerProps {
  onNavigateToPlayer?: () => void;
}

export default function FileManager({ onNavigateToPlayer }: FileManagerProps = {}) {
  const {
    files,
    folders,
    currentFolder,
    searchQuery,
    isLoading,
    isUploading,
    uploadProgress,
    uploadStatusText,
    draggedFilePath,
    loadFiles,
    navigateTo,
    setSearchQuery,
    deleteFolder,
    deleteFile,
    moveFile,
    uploadFiles,
    setDraggedFilePath,
  } = useFileStore();

  const { addTrack, playFolder, playFile } = usePlaylistStore();
  const { currentTrack, isPlaying, togglePlay } = usePlayerStore();
  const { t } = useI18n();

  // Modals
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [movingFilePath, setMovingFilePath] = useState<string | null>(null);

  // Responsive Panels State
  const [isFoldersCollapsed, setIsFoldersCollapsed] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);

  // Drag over states
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [isDragOverDropZone, setIsDragOverDropZone] = useState(false);
  const [isWindowDragOver, setIsWindowDragOver] = useState(false);

  // Hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Filter folders: direct children of currentFolder
  const currentFolders = folders.filter((f) => {
    if (!currentFolder) {
      // Root: show folders with no '/'
      return !f.path.includes('/');
    }
    // Subfolder: must start with currentFolder + '/', and not have further slashes
    if (f.path.startsWith(currentFolder + '/')) {
      const rest = f.path.slice(currentFolder.length + 1);
      return !rest.includes('/');
    }
    return false;
  });

  // Filter files:
  // If searchQuery is present: match across all files
  // If no searchQuery: match files belonging directly to currentFolder
  const searchLower = searchQuery.trim().toLowerCase();
  const displayedFiles = files.filter((f) => {
    if (searchLower) {
      return f.name.toLowerCase().includes(searchLower) || f.path.toLowerCase().includes(searchLower);
    }
    return f.folder === currentFolder;
  });

  // Breadcrumbs
  const breadcrumbSegments = currentFolder ? currentFolder.split('/') : [];

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      navigateTo('');
    } else {
      const subpath = breadcrumbSegments.slice(0, index + 1).join('/');
      navigateTo(subpath);
    }
  };

  const handleDropOnFolder = async (targetFolder: string) => {
    if (!draggedFilePath) return;
    await moveFile(draggedFilePath, targetFolder);
    setDraggedFilePath(null);
    setDragOverTarget(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files, currentFolder);
      e.target.value = '';
    }
  };

  const handleQuickPlay = async (file: FileItem) => {
    // Synchronously unlock AudioContext within the user gesture event
    audioEngine.resumeContext();
    await playFile(file.path);
  };

  const handlePlayFolder = async (folderPath: string) => {
    // Synchronously unlock AudioContext within the user gesture event
    audioEngine.resumeContext();
    await playFolder(folderPath);
  };

  const handleDeleteFile = async (filePath: string) => {
    if (confirm(`${t('confirm_delete')} (${filePath})`)) {
      await deleteFile(filePath);
    }
  };

  const handleDeleteFolder = async (folderPath: string) => {
    if (confirm(`${t('confirm_delete_folder')} (${folderPath})`)) {
      await deleteFolder(folderPath);
    }
  };

  return (
    <div
      className="relative flex-1 flex flex-col gap-3 overflow-hidden h-full"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          setIsWindowDragOver(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsWindowDragOver(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          setIsWindowDragOver(false);
          uploadFiles(e.dataTransfer.files, currentFolder);
        }
      }}
    >
      {/* Window Wide Drag Drop Overlay */}
      {isWindowDragOver && (
        <div className="absolute inset-0 z-50 bg-dark-950/85 backdrop-blur-sm border-2 border-dashed border-accent rounded-3xl flex flex-col items-center justify-center gap-3 animate-in fade-in duration-150 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-accent/20 text-accent flex items-center justify-center animate-bounce">
            <Upload className="w-8 h-8" />
          </div>
          <p className="text-base font-bold text-white">
            {t('drop_overlay_text') || 'Drop files anywhere to upload'}
          </p>
          <p className="text-xs text-accent font-mono">
            Target: {currentFolder ? `/${currentFolder}` : '(Root)'}
          </p>
        </div>
      )}

      {/* Create Folder Modal */}
      <CreateFolderModal
        isOpen={isCreateFolderOpen}
        onClose={() => setIsCreateFolderOpen(false)}
      />

      {/* Move File Modal */}
      <MoveFileModal
        filePath={movingFilePath}
        onClose={() => setMovingFilePath(null)}
      />

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        className="hidden"
        accept="audio/*,video/*,.mp3,.mp4,.wav,.flac,.ogg,.m4a,.aac,.wma,.avi,.mkv,.webm"
      />

      {/* Top Header & Breadcrumbs Toolbar — Single Consolidated Responsive Bar */}
      <div className="bg-dark-800/80 border border-dark-500/80 rounded-2xl p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-2.5 shadow-lg shrink-0">
        {/* Left: Breadcrumbs Navigation with Drop Target Support & Scope Indicator */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs min-w-0">
          {/* Root Breadcrumb */}
          <button
            onClick={() => handleBreadcrumbClick(-1)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOverTarget('__root__');
            }}
            onDragLeave={() => {
              if (dragOverTarget === '__root__') setDragOverTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDropOnFolder('');
            }}
            className={`touch-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-semibold transition ${
              currentFolder === ''
                ? 'bg-accent/20 text-accent border border-accent/40 shadow-sm'
                : 'text-gray-300 hover:bg-dark-700/60 hover:text-white border border-transparent'
            } ${dragOverTarget === '__root__' ? 'ring-2 ring-accent bg-accent/30 scale-105' : ''}`}
            title={t('drop_on_root_hint')}
          >
            <Home className="w-3.5 h-3.5" />
            <span>{t('folder_root')}</span>
          </button>

          {/* Subfolder Breadcrumb Segments */}
          {breadcrumbSegments.map((segment, idx) => {
            const fullSubpath = breadcrumbSegments.slice(0, idx + 1).join('/');
            const isLast = idx === breadcrumbSegments.length - 1;
            const isOver = dragOverTarget === fullSubpath;

            return (
              <React.Fragment key={fullSubpath}>
                <ChevronRight className="w-3.5 h-3.5 text-dark-500 shrink-0" />
                <button
                  onClick={() => handleBreadcrumbClick(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverTarget(fullSubpath);
                  }}
                  onDragLeave={() => {
                    if (dragOverTarget === fullSubpath) setDragOverTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnFolder(fullSubpath);
                  }}
                  className={`touch-btn flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold transition ${
                    isLast
                      ? 'bg-accent/20 text-accent border border-accent/40 shadow-sm'
                      : 'text-gray-300 hover:bg-dark-700/60 hover:text-white border border-transparent'
                  } ${isOver ? 'ring-2 ring-accent bg-accent/30 scale-105' : ''}`}
                  title={`${t('drop_on_folder_hint')}: ${segment}`}
                >
                  <Folder className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                  <span>{segment}</span>
                </button>
              </React.Fragment>
            );
          })}

          {/* Scope Badge */}
          <span className="hidden sm:inline-flex items-center text-[10px] font-mono text-accent font-semibold bg-dark-900/90 px-2 py-0.5 rounded-md border border-dark-600/50 ml-0.5">
            {currentFolder ? `/${currentFolder}` : '(Root)'}
          </span>
        </div>

        {/* Center: Compact Search Input */}
        <div className="relative flex-1 min-w-[160px] max-w-xs sm:max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_files_placeholder')}
            className="w-full bg-dark-900/90 border border-dark-600/70 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder-dark-500 focus:border-accent focus:outline-none transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-white p-0.5 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Right: Actions Group */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Create Folder */}
          <button
            onClick={() => setIsCreateFolderOpen(true)}
            className="touch-btn min-h-[32px] px-2.5 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 border border-dark-500 text-xs font-semibold text-gray-200 flex items-center gap-1.5 transition active:scale-95"
            title={t('btn_new_folder')}
          >
            <FolderPlus className="w-3.5 h-3.5 text-accent" />
            <span className="hidden md:inline">{t('btn_new_folder')}</span>
          </button>

          {/* Upload Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="touch-btn min-h-[32px] px-3 py-1.5 rounded-xl bg-accent hover:bg-accent-light text-white text-xs font-bold shadow-sm shadow-accent/25 flex items-center gap-1.5 transition active:scale-95"
            title={t('btn_upload')}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t('btn_upload')}</span>
          </button>

          {/* Tools / YouTube Drawer Toggle */}
          <button
            onClick={() => setIsToolsOpen(!isToolsOpen)}
            className={`touch-btn min-h-[32px] px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 ${
              isToolsOpen
                ? 'bg-accent/20 border-accent text-accent shadow-sm'
                : 'bg-dark-700 hover:bg-dark-600 border-dark-500 text-gray-300 hover:text-white'
            }`}
            title={t('btn_tools_panel') || 'Tools & Import'}
          >
            <Download className="w-3.5 h-3.5 text-red-400" />
            <span className="hidden lg:inline">{t('btn_tools_panel') || 'Tools'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isToolsOpen ? 'rotate-180 text-accent' : ''
              }`}
            />
          </button>

          {/* Refresh Files */}
          <button
            onClick={() => loadFiles(currentFolder)}
            className="touch-btn min-h-[32px] w-8 h-8 rounded-xl bg-dark-700 hover:bg-dark-600 border border-dark-500 text-muted hover:text-white flex items-center justify-center transition active:scale-95"
            title="Refresh Files"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-accent' : ''}`} />
          </button>
        </div>

        {/* Upload Progress Banner (if actively uploading) */}
        {isUploading && (
          <div className="w-full bg-dark-900/95 border border-accent/40 rounded-xl p-2.5 flex flex-col gap-1.5 animate-in fade-in">
            <div className="flex items-center justify-between text-xs">
              <span className="text-accent font-semibold flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 animate-bounce" />
                {uploadStatusText || 'Uploading...'}
              </span>
              <span className="font-mono font-bold text-accent">{uploadProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-dark-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-accent-light transition-all duration-150"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area: Compact Folders + Collapsible Tools + Media Files Table */}
      <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0">
        {/* Folders High-Density Section (Collapsible) */}
        {!searchQuery && currentFolders.length > 0 && (
          <div className="bg-dark-800/80 border border-dark-500/80 rounded-2xl p-2.5 sm:p-3 flex flex-col gap-2 shadow-lg shrink-0 transition-all">
            {/* Folder Header with Collapse Toggle */}
            <div
              onClick={() => setIsFoldersCollapsed(!isFoldersCollapsed)}
              className="flex items-center justify-between cursor-pointer select-none py-0.5"
            >
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-yellow-400" />
                <span className="text-xs sm:text-sm font-bold text-gray-200">
                  {t('tab_files_folder')}
                </span>
                <span className="text-[10px] font-mono text-muted bg-dark-900/80 px-2 py-0.5 rounded-full border border-dark-600/50">
                  {currentFolders.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted hidden sm:inline">
                  {t('drop_on_folder_hint')}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-muted hover:text-white transition-transform duration-200 ${
                    isFoldersCollapsed ? '-rotate-90' : ''
                  }`}
                />
              </div>
            </div>

            {/* Compact Folder Chips Grid */}
            {!isFoldersCollapsed && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 pt-1 border-t border-dark-700/60 animate-in fade-in duration-150">
                {currentFolders.map((folder) => {
                  const isOver = dragOverTarget === folder.path;

                  return (
                    <div
                      key={folder.path}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverTarget(folder.path);
                      }}
                      onDragLeave={() => {
                        if (dragOverTarget === folder.path) setDragOverTarget(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDropOnFolder(folder.path);
                      }}
                      className={`group/folder relative px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-1.5 min-h-[38px] ${
                        isOver
                          ? 'bg-accent/20 border-accent shadow-md shadow-accent/20 scale-[1.02]'
                          : 'bg-dark-900/70 hover:bg-dark-700/60 border-dark-600/60 hover:border-dark-500'
                      }`}
                      onClick={() => navigateTo(folder.path)}
                      title={`${folder.name} (${folder.fileCount} files, ${folder.totalSizeFormatted})`}
                    >
                      {/* Folder Info */}
                      <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                        <Folder className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                        <span className="font-semibold text-xs text-gray-100 truncate group-hover/folder:text-accent transition">
                          {folder.name}
                        </span>
                        <span className="text-[10px] font-mono text-muted bg-dark-950/80 px-1 rounded border border-dark-700/50 shrink-0">
                          {folder.fileCount}
                        </span>
                      </div>

                      {/* Folder Quick Actions */}
                      <div
                        className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover/folder:opacity-100 transition"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayFolder(folder.path);
                          }}
                          className="touch-btn w-6 h-6 rounded-lg bg-dark-800 hover:bg-accent/20 text-accent hover:text-accent-light flex items-center justify-center transition"
                          title={t('btn_play_folder')}
                        >
                          <Play className="w-2.5 h-2.5 fill-current translate-x-0.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteFolder(folder.path)}
                          className="touch-btn w-6 h-6 rounded-lg bg-dark-800 hover:bg-rose-500/20 text-muted hover:text-rose-400 flex items-center justify-center transition"
                          title={t('confirm_delete')}
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Collapsible Tools Deck (Upload Drop Zone + YouTube Downloader) */}
        {isToolsOpen && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 shrink-0 animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Drag & Drop Upload Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOverDropZone(true);
              }}
              onDragLeave={() => setIsDragOverDropZone(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOverDropZone(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  uploadFiles(e.dataTransfer.files, currentFolder);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-3 sm:p-4 flex flex-col justify-between gap-2.5 text-center sm:text-left cursor-pointer transition-all ${
                isDragOverDropZone
                  ? 'border-accent bg-accent/15 scale-[1.01]'
                  : 'border-dark-600/70 hover:border-dark-500 bg-dark-950/40 hover:bg-dark-900/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-semibold text-gray-200">
                    {t('drop_zone_text')}
                  </p>
                  <p className="text-[11px] text-muted">
                    {t('drop_zone_target')}{' '}
                    <span className="font-mono text-accent font-semibold">
                      {currentFolder || t('folder_root')}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  className="touch-btn px-3.5 py-1.5 rounded-xl bg-dark-700 hover:bg-dark-600 text-gray-200 text-xs font-semibold border border-dark-500 transition shrink-0"
                >
                  {t('btn_upload')}
                </button>
              </div>
            </div>

            {/* YouTube Downloader Deck */}
            <YouTubeDownloader />
          </div>
        )}

        {/* Media Files Table — Maximized Vertical Height */}
        <div className="flex-1 bg-dark-800/80 border border-dark-500/80 rounded-2xl p-3 sm:p-4 flex flex-col gap-2.5 shadow-xl overflow-hidden min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-gray-200 flex items-center gap-2">
                <Music className="w-4 h-4 text-accent" />
                <span>{t('files_title')}</span>
                <span className="text-xs font-mono text-muted bg-dark-900/80 px-2 py-0.5 rounded-full border border-dark-600/50">
                  {displayedFiles.length}
                </span>
              </h3>
              {searchQuery && (
                <span className="text-xs text-muted font-mono italic">
                  (Filter: &quot;{searchQuery}&quot;)
                </span>
              )}
            </div>

            <span className="text-[11px] text-muted hidden sm:inline">
              Drag row handle to move into any folder
            </span>
          </div>

          <div className="flex-1 overflow-auto rounded-xl border border-dark-600/60 bg-dark-950/60 min-h-0">
            {displayedFiles.length === 0 ? (
              <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center p-6 gap-2 text-muted">
                <div className="w-12 h-12 rounded-2xl bg-dark-800 border border-dark-600/60 flex items-center justify-center text-dark-500 shadow-inner">
                  <Music className="w-6 h-6" />
                </div>
                <p className="text-xs max-w-xs">
                  {searchQuery ? t('no_search_results') : t('no_files')}
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-dark-800/95 sticky top-0 z-10 border-b border-dark-600/60 uppercase text-[10px] font-mono text-muted backdrop-blur-sm">
                  <tr>
                    <th className="py-2 px-2.5 w-8 text-center"></th>
                    <th className="py-2 px-2.5">{t('col_filename')}</th>
                    {searchQuery && <th className="py-2 px-2.5 w-24">Folder</th>}
                    <th className="py-2 px-2.5 w-20 text-right">{t('col_size')}</th>
                    <th className="py-2 px-2.5 w-28 hidden md:table-cell">{t('col_modified')}</th>
                    <th className="py-2 px-2.5 w-44 text-center">{t('col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-600/30">
                  {displayedFiles.map((file) => {
                    const isCurrentTrack = currentTrack && (
                      currentTrack.title === file.name ||
                      currentTrack.url.endsWith('/' + encodeURIComponent(file.name)) ||
                      currentTrack.url.endsWith('/' + file.path.split('/').map(encodeURIComponent).join('/'))
                    );

                    return (
                      <tr
                        key={file.path}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', file.path);
                          setDraggedFilePath(file.path);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggedFilePath(null);
                          setDragOverTarget(null);
                        }}
                        onDoubleClick={() => handleQuickPlay(file)}
                        className={`transition-all group/row cursor-pointer ${
                          isCurrentTrack
                            ? 'bg-accent/15 border-l-2 border-accent text-white font-medium'
                            : 'hover:bg-dark-700/50 text-gray-200'
                        }`}
                      >
                        {/* Drag Grip Handle */}
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center">
                            <GripVertical className="w-3.5 h-3.5 text-dark-500 group-hover/row:text-accent transition" />
                          </div>
                        </td>

                        {/* File Name & Icon */}
                        <td
                          className="py-2 px-2.5 cursor-pointer"
                          onClick={() => handleQuickPlay(file)}
                          title="Click to play"
                        >
                          <div className="flex items-center gap-2 truncate">
                            {isCurrentTrack && isPlaying ? (
                              <div className="flex items-center gap-0.5 text-accent shrink-0">
                                <span className="w-1 h-3 bg-accent animate-pulse rounded-full" />
                                <span className="w-1 h-4 bg-accent animate-bounce rounded-full" />
                                <span className="w-1 h-2 bg-accent animate-pulse rounded-full" />
                              </div>
                            ) : file.isVideo ? (
                              <VideoIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            ) : (
                              <Music className="w-3.5 h-3.5 text-accent shrink-0" />
                            )}
                            <span className={`truncate font-medium text-xs ${
                              isCurrentTrack ? 'text-accent-light font-bold' : 'text-gray-100 group-hover/row:text-accent transition'
                            }`}>
                              {file.name}
                            </span>
                          </div>
                        </td>

                        {/* Folder Badge (Shown when searching across all directories) */}
                        {searchQuery && (
                          <td className="py-2 px-2.5">
                            <span className="text-[10px] font-mono text-muted bg-dark-800 px-1.5 py-0.5 rounded-md border border-dark-600/50 truncate block max-w-[100px]">
                              {file.folder || '(Root)'}
                            </span>
                          </td>
                        )}

                        {/* Size */}
                        <td className="py-2 px-2.5 text-right font-mono text-[10px] sm:text-[11px] text-muted">
                          {file.sizeFormatted}
                        </td>

                        {/* Modified Date */}
                        <td className="py-2 px-2.5 text-[10px] sm:text-[11px] font-mono text-muted hidden md:table-cell">
                          {file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString() : '—'}
                        </td>

                        {/* Actions: Add to Playlist / Play / Download / Move / Delete */}
                        <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            {/* Add to Playlist */}
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                addTrack(file.path, 1, true);
                              }}
                              className="touch-btn w-7 h-7 rounded-lg bg-dark-700 hover:bg-accent/20 text-accent flex items-center justify-center transition active:scale-95"
                              title={t('btn_add_file')}
                            >
                              <Plus className="w-3 h-3" />
                            </button>

                            {/* Quick Play */}
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCurrentTrack && isPlaying) {
                                  togglePlay();
                                } else {
                                  handleQuickPlay(file);
                                }
                              }}
                              className={`touch-btn w-7 h-7 rounded-lg flex items-center justify-center transition active:scale-95 ${
                                isCurrentTrack && isPlaying
                                  ? 'bg-emerald-500 text-dark-950 font-bold shadow-lg shadow-emerald-500/30'
                                  : 'bg-dark-700 hover:bg-emerald-500/20 text-emerald-400'
                              }`}
                              title={isCurrentTrack && isPlaying ? "Pause" : "Play Now"}
                            >
                              {isCurrentTrack && isPlaying ? (
                                <Pause className="w-3 h-3 fill-current" />
                              ) : (
                                <Play className="w-3 h-3 fill-current translate-x-0.5" />
                              )}
                            </button>

                            {/* Download File */}
                            <a
                              href={`/uploads/${encodeURI(file.path)}`}
                              download={file.name}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              className="touch-btn w-7 h-7 rounded-lg bg-dark-700 hover:bg-sky-500/20 text-muted hover:text-sky-400 flex items-center justify-center transition active:scale-95"
                              title={t('btn_download_file') || 'Download File'}
                            >
                              <Download className="w-3 h-3" />
                            </a>

                            {/* Move Modal */}
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setMovingFilePath(file.path);
                              }}
                              className="touch-btn w-7 h-7 rounded-lg bg-dark-700 hover:bg-cyan-500/20 text-muted hover:text-cyan-400 flex items-center justify-center transition active:scale-95"
                              title={t('btn_move_file')}
                            >
                              <FolderInput className="w-3 h-3" />
                            </button>

                            {/* Delete File */}
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFile(file.path);
                              }}
                              className="touch-btn w-7 h-7 rounded-lg bg-dark-700 hover:bg-rose-500/20 text-muted hover:text-rose-400 flex items-center justify-center transition active:scale-95"
                              title={t('confirm_delete')}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
