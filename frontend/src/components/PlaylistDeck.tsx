import React, { useRef, useState } from 'react';
import { usePlaylistStore, PlaylistItem } from '../stores/usePlaylistStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import { useI18n } from '../services/i18n';
import {
  Play,
  Pause,
  Trash2,
  GripVertical,
  Repeat,
  ArrowRightCircle,
  StopCircle,
  Plus,
  Music,
  Video as VideoIcon,
} from 'lucide-react';

export default function PlaylistDeck() {
  const { items, currentIndex, clearAll, removeTrack, moveTrack, setLoop, toggleAutoNext, playIndex } =
    usePlaylistStore();
  const { isPlaying, isPaused, togglePlay, pause, resume } = usePlayerStore();
  const { t } = useI18n();

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number, e: React.DragEvent) => {
    dragItem.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      moveTrack(dragItem.current, dragOverItem.current);
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDragOverIndex(null);
  };

  const handleLoopCycle = (index: number, currentLoop: number) => {
    // Cycle: 1x -> 2x -> 3x -> 0 (Infinite) -> 1x
    const loopCycle = [1, 2, 3, 0];
    const currIdx = loopCycle.indexOf(currentLoop);
    const nextLoop = currIdx === -1 || currIdx === loopCycle.length - 1 ? 1 : loopCycle[currIdx + 1];
    setLoop(index, nextLoop);
  };

  return (
    <div className="flex-1 bg-dark-800/80 border border-dark-500/80 rounded-3xl p-4 sm:p-5 flex flex-col gap-3.5 shadow-2xl overflow-hidden">
      {/* Deck Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm sm:text-base font-bold text-accent tracking-wide flex items-center gap-2">
            <Music className="w-4 h-4" />
            {t('playlist_title')}
          </h2>
          <span className="text-xs font-mono text-muted bg-dark-900/80 px-2 py-0.5 rounded-full border border-dark-600/50">
            {items.length} {t('tracks_in_playlist')}
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              onClick={clearAll}
              className="touch-btn min-h-[36px] px-3 py-1.5 rounded-xl bg-dark-700 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
              title={t('btn_clear')}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('btn_clear')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Playlist Table Container */}
      <div className="flex-1 overflow-auto rounded-2xl border border-dark-600/60 bg-dark-950/60">
        {items.length === 0 ? (
          <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-8 gap-3 text-muted">
            <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-dark-600/60 flex items-center justify-center text-dark-500 shadow-inner">
              <Music className="w-7 h-7" />
            </div>
            <p className="text-xs max-w-xs">{t('playlist_empty')}</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-dark-800/90 sticky top-0 z-10 border-b border-dark-600/60 uppercase text-[10px] font-mono text-muted">
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">#</th>
                <th className="py-2.5 px-3">{t('col_title')}</th>
                <th className="py-2.5 px-3 w-20 text-center">{t('col_loop')}</th>
                <th className="py-2.5 px-3 w-32 text-center">Auto-Next</th>
                <th className="py-2.5 px-3 w-24 text-center">{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-600/30">
              {items.map((item, index) => {
                const isActive = currentIndex === index;
                const isHovered = dragOverIndex === index;

                return (
                  <tr
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(index, e)}
                    onDragEnter={() => handleDragEnter(index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => {
                      if (isActive) {
                        if (isPlaying) pause();
                        else if (isPaused) resume();
                        else playIndex(index);
                      } else {
                        playIndex(index);
                      }
                    }}
                    className={`transition-all group/row cursor-pointer select-none ${
                      isActive
                        ? 'bg-accent/15 text-white font-medium'
                        : 'hover:bg-dark-700/50 text-gray-200'
                    } ${isHovered ? 'border-t-2 border-accent bg-accent/10' : ''}`}
                  >
                    {/* Index & Grip Handle */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <GripVertical className="w-3.5 h-3.5 text-dark-500 group-hover/row:text-accent transition shrink-0" />
                        <span className="font-mono text-[11px] w-4 text-muted">{index + 1}</span>
                      </div>
                    </td>

                    {/* Track Title */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2 truncate">
                        {item.isVideo ? (
                          <VideoIcon className="w-4 h-4 text-indigo-400 shrink-0" />
                        ) : (
                          <Music className="w-4 h-4 text-accent shrink-0" />
                        )}
                        <span className="truncate font-medium text-xs sm:text-sm">{item.name}</span>
                      </div>
                    </td>

                    {/* Loop Setting */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoopCycle(index, item.loop);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="touch-btn min-h-[30px] px-2.5 py-1 rounded-lg bg-dark-700/90 hover:bg-dark-600 text-gray-300 font-mono text-[11px] flex items-center justify-center gap-1 border border-dark-600/50 transition mx-auto"
                        title="Click to cycle loop count"
                      >
                        <Repeat className="w-3 h-3 text-muted" />
                        <span>{item.loop === 0 ? '∞' : `${item.loop}x`}</span>
                      </button>
                    </td>

                    {/* Auto-Next Toggle Pill */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAutoNext(index);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`touch-btn min-h-[30px] px-3 py-1 rounded-full text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all mx-auto ${
                          item.autoNext
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                        }`}
                        title={item.autoNext ? 'Play next track automatically' : 'Stop after this track'}
                      >
                        {item.autoNext ? (
                          <>
                            <ArrowRightCircle className="w-3.5 h-3.5" />
                            <span>Auto-Next</span>
                          </>
                        ) : (
                          <>
                            <StopCircle className="w-3.5 h-3.5" />
                            <span>Stop</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Actions: Play / Remove */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isActive) {
                              if (isPlaying) {
                                pause();
                              } else if (isPaused) {
                                resume();
                              } else {
                                playIndex(index);
                              }
                            } else {
                              playIndex(index);
                            }
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="touch-btn w-8 h-8 rounded-xl bg-dark-700 hover:bg-dark-600 text-accent flex items-center justify-center transition active:scale-95"
                          title="Play Track"
                        >
                          {isActive && isPlaying ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current translate-x-0.5" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTrack(index);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="touch-btn w-8 h-8 rounded-xl bg-dark-700 hover:bg-rose-500/20 text-muted hover:text-rose-400 flex items-center justify-center transition active:scale-95"
                          title="Remove Track"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
  );
}
