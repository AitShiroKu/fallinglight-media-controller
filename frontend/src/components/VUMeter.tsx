import React from 'react';
import { VUData } from '../services/audio-engine';
import { useVUStore } from '../stores/useVUStore';

interface VUMeterProps {
  vu?: VUData;
  className?: string;
}

export default function VUMeter({ vu: propVU, className = '' }: VUMeterProps) {
  const storeVU = useVUStore((s) => s.vu);
  const vu = propVU || storeVU;
  const leftPercent = Math.min(100, Math.round(vu.left * 100));
  const rightPercent = Math.min(100, Math.round(vu.right * 100));

  return (
    <div className={`bg-dark-950/90 rounded-xl p-3 border border-dark-600/50 flex flex-col gap-2 shadow-inner ${className}`}>
      <div className="flex items-center justify-between text-[10px] font-mono text-muted tracking-wider uppercase px-0.5">
        <span>VU Level (Stereo)</span>
        <div className="flex gap-2">
          <span>L: {vu.leftDb > -60 ? `${vu.leftDb.toFixed(1)}dB` : '-∞'}</span>
          <span>R: {vu.rightDb > -60 ? `${vu.rightDb.toFixed(1)}dB` : '-∞'}</span>
        </div>
      </div>

      {/* Channel Bars */}
      <div className="flex flex-col gap-1.5">
        {/* Left Channel */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-muted w-3">L</span>
          <div className="flex-1 h-3 bg-dark-800 rounded-md overflow-hidden relative border border-dark-600/40">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-rose-500 transition-all duration-75"
              style={{ width: `${leftPercent}%` }}
            />
            {/* Overlay grid lines for -20dB, -10dB, -3dB markings */}
            <div className="absolute inset-0 flex justify-between px-1 pointer-events-none opacity-20">
              <div className="w-px h-full bg-white" />
              <div className="w-px h-full bg-white" />
              <div className="w-px h-full bg-white" />
              <div className="w-px h-full bg-white" />
            </div>
          </div>
        </div>

        {/* Right Channel */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-muted w-3">R</span>
          <div className="flex-1 h-3 bg-dark-800 rounded-md overflow-hidden relative border border-dark-600/40">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-rose-500 transition-all duration-75"
              style={{ width: `${rightPercent}%` }}
            />
            {/* Overlay grid lines */}
            <div className="absolute inset-0 flex justify-between px-1 pointer-events-none opacity-20">
              <div className="w-px h-full bg-white" />
              <div className="w-px h-full bg-white" />
              <div className="w-px h-full bg-white" />
              <div className="w-px h-full bg-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
