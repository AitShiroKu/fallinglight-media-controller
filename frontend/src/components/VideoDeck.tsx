import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../services/audio-engine';
import { usePlayerStore } from '../stores/usePlayerStore';
import { Maximize, Minimize, PictureInPicture, Video as VideoIcon, Film } from 'lucide-react';

export default function VideoDeck() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  // Overlay visibility state & auto-hide timer
  const [isHovered, setIsHovered] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = () => {
    setIsControlsVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (isPlaying) {
      hideTimerRef.current = setTimeout(() => {
        setIsControlsVisible(false);
      }, 2500);
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    resetHideTimer();
  };

  const handleMouseMove = () => {
    setIsHovered(true);
    resetHideTimer();
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (isPlaying) {
      setIsControlsVisible(false);
    }
  };

  const handleFocus = () => {
    setIsHovered(true);
    resetHideTimer();
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (containerRef.current && containerRef.current.contains(e.relatedTarget as Node)) {
      return;
    }
    setIsHovered(false);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (isPlaying) {
      setIsControlsVisible(false);
    }
  };

  // Keep controls visible when paused; auto-hide when playing
  useEffect(() => {
    if (!isPlaying) {
      setIsControlsVisible(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    } else if (isHovered) {
      resetHideTimer();
    } else {
      setIsControlsVisible(false);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (videoRef.current) {
      audioEngine.setVideoElement(videoRef.current);
    }
    return () => {
      audioEngine.setVideoElement(null);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Listen to video metadata for real dimensions
  useEffect(() => {
    setVideoDimensions(null);
    const video = videoRef.current;
    if (!video) return;

    const updateDimensions = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
    };

    if (video.readyState >= 1) {
      updateDimensions();
    }

    video.addEventListener('loadedmetadata', updateDimensions);
    video.addEventListener('resize', updateDimensions);
    video.addEventListener('play', updateDimensions);

    return () => {
      video.removeEventListener('loadedmetadata', updateDimensions);
      video.removeEventListener('resize', updateDimensions);
      video.removeEventListener('play', updateDimensions);
    };
  }, [currentTrack?.url]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen toggle failed:', err);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPip(false);
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
        setIsPip(true);
      }
    } catch (err) {
      console.error('Picture-in-Picture toggle failed:', err);
    }
  };

  const hasVideo = currentTrack?.isVideo;

  // Format real resolution string
  const formatResolution = (w: number, h: number, filename?: string): string => {
    let quality = '';
    if (h >= 2160 || w >= 3840) {
      quality = '4K UHD';
    } else if (h >= 1440 || w >= 2560) {
      quality = '1440p 2K';
    } else if (h >= 1080 || w >= 1920) {
      quality = '1080p FHD';
    } else if (h >= 720 || w >= 1280) {
      quality = '720p HD';
    } else if (h >= 480) {
      quality = '480p';
    } else if (h >= 360) {
      quality = '360p';
    } else {
      quality = `${h}p`;
    }

    let ext = '';
    if (filename) {
      const dot = filename.lastIndexOf('.');
      if (dot !== -1) {
        ext = filename.slice(dot + 1).toUpperCase();
      }
    }

    const extPart = ext ? ` ${ext}` : '';
    return `${quality} (${w}×${h})${extPart}`;
  };

  const resolutionText = videoDimensions
    ? formatResolution(videoDimensions.width, videoDimensions.height, currentTrack?.title)
    : (currentTrack?.title?.slice(currentTrack.title.lastIndexOf('.') + 1).toUpperCase() || 'MP4');

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={`relative w-full bg-black rounded-2xl overflow-hidden border border-dark-600/60 shadow-2xl flex flex-col items-center justify-center transition-all outline-none ${
        isFullscreen
          ? 'fixed inset-0 z-50 rounded-none border-none max-h-screen'
          : 'aspect-video max-h-[260px] sm:max-h-[320px]'
      } ${isFullscreen && !isControlsVisible ? 'cursor-none' : ''}`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        className={`w-full h-full object-contain cursor-pointer ${hasVideo ? 'block' : 'hidden'}`}
      />

      {/* Placeholder / Visualizer when Audio-only */}
      {!hasVideo && (
        <div className="flex flex-col items-center justify-center text-center p-6 gap-3 select-none">
          <div className="w-16 h-16 rounded-2xl bg-dark-800/90 border border-dark-600/60 flex items-center justify-center text-accent shadow-xl">
            <Film className="w-8 h-8 animate-pulse" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-bold text-gray-300">
              {currentTrack ? currentTrack.title : 'No Media Loaded'}
            </span>
            <span className="text-[10px] text-muted font-mono">
              {hasVideo ? 'Video Playback Ready' : 'Audio Stream Deck Active'}
            </span>
          </div>
        </div>
      )}

      {/* Top Floating Overlay Controls (available when video is active) */}
      {hasVideo && (
        <div
          className={`absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20 bg-dark-950/75 backdrop-blur-md px-2 py-1 rounded-xl border border-dark-600/40 shadow-lg transition-all duration-300 ${
            isControlsVisible
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-1 pointer-events-none'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePiP();
            }}
            className={`touch-btn w-7 h-7 rounded-lg flex items-center justify-center transition ${
              isPip ? 'text-accent bg-accent/20' : 'text-gray-300 hover:text-white hover:bg-dark-700'
            }`}
            title="Picture-in-Picture"
          >
            <PictureInPicture className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className="touch-btn w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-white hover:bg-dark-700 transition"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* Video Badge (Dynamic Real Resolution & Auto-Hide) */}
      {hasVideo && (
        <div
          className={`absolute bottom-2.5 left-2.5 flex items-center gap-1.5 z-20 bg-dark-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-dark-600/40 text-[10px] font-mono text-indigo-300 font-semibold shadow-lg transition-all duration-300 ${
            isControlsVisible
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-1 pointer-events-none'
          }`}
        >
          <VideoIcon className="w-3 h-3 text-indigo-400 shrink-0" />
          <span>{resolutionText}</span>
        </div>
      )}
    </div>
  );
}
