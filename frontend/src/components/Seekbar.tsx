import React, { useState, useEffect, useRef } from 'react';

interface SeekbarProps {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));

  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${m}:${pad(s)}`;
}

export default function Seekbar({ currentTime, duration, onSeek }: SeekbarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const activeTime = isDragging ? dragTime : currentTime;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (activeTime / duration) * 100)) : 0;

  const calculateTimeFromPointer = (e: PointerEvent | React.PointerEvent): number => {
    if (!trackRef.current || duration <= 0) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // Never seek beyond (duration - 0.5s) to avoid accidentally hitting the track's end
    const maxSeekable = Math.max(0, duration - 0.5);
    return Math.min(maxSeekable, pos * duration);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    const newTime = calculateTimeFromPointer(e);
    setDragTime(newTime);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const newTime = calculateTimeFromPointer(e);
    setDragTime(newTime);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    setIsDragging(false);
    const finalTime = calculateTimeFromPointer(e);
    onSeek(finalTime);
  };

  return (
    <div className="flex flex-col gap-1.5 w-full select-none">
      {/* Interactive Progress Track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setIsDragging(false)}
        className="relative h-6 flex items-center cursor-pointer group touch-none"
      >
        {/* Background Track */}
        <div className="w-full h-2 bg-dark-950/80 rounded-full overflow-hidden border border-dark-600/50">
          {/* Buffered / Elapsed bar */}
          <div
            className="h-full bg-gradient-to-r from-accent to-accent-light rounded-full transition-all duration-75"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Thumb */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-lg shadow-accent/50 border-2 border-accent transition-transform pointer-events-none ${
            isDragging ? 'scale-125' : 'scale-90 group-hover:scale-110'
          }`}
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* Time Labels */}
      <div className="flex items-center justify-between text-[11px] font-mono text-muted px-0.5">
        <span>{formatTime(activeTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
