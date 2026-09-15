/**
 * Audio Engine — HTML5 Audio + Web Audio API for client-side playback.
 * 
 * Features:
 * - Playback via HTML5 Audio element
 * - Real VU meter data via Web Audio API AnalyserNode
 * - Smooth fade engine using requestAnimationFrame
 * - Mic ducking (manual toggle)
 */
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────
  let audioEl = new Audio();
  audioEl.crossOrigin = 'anonymous';
  audioEl.preload = 'auto';

  let videoEl = null;
  let videoContainer = null;
  let isVideoMedia = false;

  let audioCtx = null;
  let analyserL = null;
  let analyserR = null;
  let sourceNode = null;
  let splitter = null;
  let isCtxConnected = false;

  let currentVolume = 0.8;
  let preMuteVolume = 0.8;
  let isMuted = false;
  let isDucked = false;
  let preDuckVolume = 0.8;
  let remoteMode = false;   // When true, relay commands to stream receiver

  // Remote streaming state (for remoteMode proxying)
  let remotePlaying = false;
  let remoteTrack = null;
  let remoteVolume = 80;
  let remoteDuration = 0;
  let remoteCurrentTime = 0;

  // Settings configuration (updated via settings manager)
  let configFadeDuration = 1500; // in ms
  let configDuckVolume = 0.12;   // 0.0 to 1.0
  let configDuckDuration = 300;  // in ms

  // Fade state
  let fadeRafId = null;
  let fadeStartVol = 0;
  let fadeEndVol = 0;
  let fadeDuration = 0;
  let fadeStartTime = 0;
  let fadeCallback = null;

  // VU data buffers
  let dataL = null;
  let dataR = null;
  let vuRafId = null;

  function isVideoPath(name) {
    return /\.(mp4|webm|mkv|avi)$/i.test(name || '');
  }

  function initVideoElements() {
    if (!videoEl) {
      videoEl = document.getElementById('controller-video');
      videoContainer = document.getElementById('video-preview-container');
      if (videoEl) {
        videoEl.crossOrigin = 'anonymous';
        videoEl.preload = 'auto';

        videoEl.addEventListener('timeupdate', function () {
          if (!isVideoMedia || remoteMode) return;
          var seekBar = document.getElementById('seek-bar');
          var timeCurrent = document.getElementById('time-current');
          if (seekBar && videoEl.duration) {
            seekBar.value = (videoEl.currentTime / videoEl.duration * 1000) | 0;
          }
          if (timeCurrent) timeCurrent.textContent = formatTime(videoEl.currentTime);
        });

        videoEl.addEventListener('loadedmetadata', function () {
          if (!isVideoMedia || remoteMode) return;
          var timeTotal = document.getElementById('time-total');
          if (timeTotal) timeTotal.textContent = formatTime(videoEl.duration);
        });

        videoEl.addEventListener('play', function () {
          if (isVideoMedia && !remoteMode) updatePlayButton(true);
        });

        videoEl.addEventListener('pause', function () {
          if (isVideoMedia && !remoteMode) updatePlayButton(false);
        });

        videoEl.addEventListener('ended', function () {
          if (!isVideoMedia || remoteMode) return;
          updatePlayButton(false);
          stopVU();
          if (window.playlist) window.playlist.onTrackEnded();
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVideoElements);
  } else {
    initVideoElements();
  }

  function getActiveMedia() {
    initVideoElements();
    return (isVideoMedia && videoEl) ? videoEl : audioEl;
  }

  // ── Audio Context Setup ───────────────────────────────
  function ensureContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyserL = audioCtx.createAnalyser();
    analyserR = audioCtx.createAnalyser();
    analyserL.fftSize = 256;
    analyserR.fftSize = 256;
    splitter = audioCtx.createChannelSplitter(2);

    dataL = new Uint8Array(analyserL.frequencyBinCount);
    dataR = new Uint8Array(analyserR.frequencyBinCount);
  }

  function connectSource(targetEl) {
    ensureContext();
    targetEl = targetEl || getActiveMedia();
    try {
      sourceNode = audioCtx.createMediaElementSource(targetEl);
      sourceNode.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      sourceNode.connect(audioCtx.destination);
      isCtxConnected = true;
    } catch (e) {
      // Already connected (only one MediaElementSource per element allowed)
      isCtxConnected = true;
    }
  }

  // ── Playback ──────────────────────────────────────────
  function play(url) {
    // In remote mode, extract filename and send to receiver
    if (remoteMode && window.streamController) {
      var filename = decodeURIComponent(url.replace(/^\/uploads\//, ''));
      window.streamController.sendPlay(filename);
      updatePlayButton(true);
      return;
    }

    initVideoElements();
    ensureContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    isVideoMedia = isVideoPath(url);

    if (isVideoMedia && videoEl) {
      // Pause and clear audio element
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.src = '';

      if (videoContainer) videoContainer.classList.remove('hidden');
      videoEl.src = url;
      videoEl.volume = isDucked ? configDuckVolume : currentVolume;
      videoEl.muted = isMuted;
      const p = videoEl.play();
      if (p) p.catch(() => {});
      connectSource(videoEl);
    } else {
      // Audio only playback
      if (videoEl) {
        videoEl.pause();
        videoEl.src = '';
      }
      if (videoContainer) videoContainer.classList.add('hidden');

      audioEl.src = url;
      audioEl.volume = isDucked ? configDuckVolume : currentVolume;
      audioEl.muted = isMuted;
      const p = audioEl.play();
      if (p) p.catch(() => {});
      connectSource(audioEl);
    }

    startVU();
  }

  function pause() {
    if (remoteMode && window.streamController) {
      window.streamController.sendPause();
      return;
    }

    var media = getActiveMedia();
    if (media.paused) {
      media.play().catch(() => {});
      startVU();
    } else {
      media.pause();
    }
  }

  function stop() {
    if (remoteMode && window.streamController) {
      window.streamController.sendStop();
      updatePlayButton(false);
      return;
    }

    var media = getActiveMedia();
    media.pause();
    media.currentTime = 0;
    if (videoEl && !isVideoMedia) {
      videoEl.pause();
      videoEl.src = '';
    }
    stopVU();
    updatePlayButton(false);
  }

  function stopWithFade(durationMs) {
    if (remoteMode && window.streamController) {
      window.streamController.sendStop();
      updatePlayButton(false);
      updateStatus('Stopped');
      return;
    }

    var media = getActiveMedia();
    durationMs = durationMs || configFadeDuration;
    startFade(media.volume, 0, durationMs, function () {
      stop();
      media.volume = currentVolume;
      updatePlayButton();
      updateStatus('Stopped');
    });
  }

  function seekTo(ratio) {
    if (remoteMode && window.streamController) {
      window.streamController.sendSeek(ratio);
      return;
    }

    var media = getActiveMedia();
    if (media.duration && isFinite(media.duration)) {
      media.currentTime = ratio * media.duration;
    }
  }

  // ── Volume ────────────────────────────────────────────
  function setVolume(v) {
    currentVolume = Math.max(0, Math.min(1, v));

    if (remoteMode && window.streamController) {
      window.streamController.sendVolume(currentVolume * 100);
    }

    var media = getActiveMedia();
    if (!isDucked && !fadeRafId) {
      media.volume = currentVolume;
    }
    isMuted = currentVolume === 0;
    media.muted = isMuted;
    updateVolumeUI();
  }

  function toggleMute() {
    if (isMuted) {
      isMuted = false;
      setVolume(preMuteVolume || 0.8);
    } else {
      preMuteVolume = currentVolume;
      isMuted = true;
      setVolume(0);
    }
  }

  // ── Ducking ───────────────────────────────────────────
  function toggleDuck() {
    if (isDucked) {
      unduck();
    } else {
      duck();
    }
  }

  function duck(targetVol, durationMs) {
    if (remoteMode && window.streamController) {
      isDucked = true;
      window.streamController.sendDuck(true);
      updateMicButton(true);
      updateStatus(window.appI18n ? window.appI18n.tr('status_mic_on') : 'MIC ON — Ducked');
      return;
    }

    targetVol = targetVol !== undefined ? targetVol : configDuckVolume;
    durationMs = durationMs || configDuckDuration;
    if (isDucked) return;
    isDucked = true;
    var media = getActiveMedia();
    preDuckVolume = media.volume;
    startFade(media.volume, targetVol, durationMs);
    updateMicButton(true);
    updateStatus(window.appI18n ? window.appI18n.tr('status_mic_on') : 'MIC ON — Ducked');
  }

  function unduck(durationMs) {
    if (remoteMode && window.streamController) {
      isDucked = false;
      window.streamController.sendDuck(false);
      updateMicButton(false);
      updateStatus(window.appI18n ? window.appI18n.tr('status_mic_off') : 'MIC OFF');
      return;
    }

    durationMs = durationMs || configFadeDuration;
    if (!isDucked) return;
    isDucked = false;
    var media = getActiveMedia();
    startFade(media.volume, currentVolume, durationMs);
    updateMicButton(false);
    updateStatus(window.appI18n ? window.appI18n.tr('status_mic_off') : 'MIC OFF');
  }

  // ── Fade Engine ───────────────────────────────────────
  function startFade(fromVol, toVol, durationMs, cb) {
    if (fadeRafId) cancelAnimationFrame(fadeRafId);
    fadeStartVol = fromVol;
    fadeEndVol = toVol;
    fadeDuration = Math.max(durationMs, 1);
    fadeStartTime = performance.now();
    fadeCallback = cb || null;
    fadeStep();
  }

  function fadeStep() {
    var elapsed = performance.now() - fadeStartTime;
    var progress = Math.min(elapsed / fadeDuration, 1);
    // Cubic ease-out
    var eased = 1 - Math.pow(1 - progress, 3);
    var vol = fadeStartVol + (fadeEndVol - fadeStartVol) * eased;
    var media = getActiveMedia();
    media.volume = Math.max(0, Math.min(1, vol));

    if (progress < 1) {
      fadeRafId = requestAnimationFrame(fadeStep);
    } else {
      fadeRafId = null;
      media.volume = fadeEndVol;
      if (fadeCallback) {
        var cb = fadeCallback;
        fadeCallback = null;
        cb();
      }
    }
  }

  // ── VU Meter ──────────────────────────────────────────
  function startVU() {
    if (vuRafId) return;
    vuTick();
  }

  function stopVU() {
    if (vuRafId) {
      cancelAnimationFrame(vuRafId);
      vuRafId = null;
    }
    setVU(0, 0);
  }

  function vuTick() {
    if (!analyserL || !analyserR) {
      vuRafId = requestAnimationFrame(vuTick);
      return;
    }

    analyserL.getByteFrequencyData(dataL);
    analyserR.getByteFrequencyData(dataR);

    var sumL = 0, sumR = 0;
    var len = dataL.length;
    for (var i = 0; i < len; i++) {
      sumL += dataL[i];
      sumR += dataR[i];
    }
    var avgL = sumL / (len * 255);
    var avgR = sumR / (len * 255);

    setVU(avgL, avgR);

    vuRafId = requestAnimationFrame(vuTick);
  }

  function setVU(l, r) {
    var vuL = document.getElementById('vu-left');
    var vuR = document.getElementById('vu-right');
    var vuDb = document.getElementById('vu-db');
    if (vuL) vuL.style.height = (l * 100) + '%';
    if (vuR) vuR.style.height = (r * 100) + '%';
    if (vuDb) {
      var peak = Math.max(l, r);
      vuDb.textContent = peak > 0.001 ? (20 * Math.log10(peak)).toFixed(0) + ' dB' : '-∞ dB';
    }
  }

  // ── Audio Element Events ──────────────────────────────
  audioEl.addEventListener('timeupdate', function () {
    if (isVideoMedia || remoteMode) return;
    var seekBar = document.getElementById('seek-bar');
    var timeCurrent = document.getElementById('time-current');
    if (seekBar && audioEl.duration) {
      seekBar.value = (audioEl.currentTime / audioEl.duration * 1000) | 0;
    }
    if (timeCurrent) timeCurrent.textContent = formatTime(audioEl.currentTime);
  });

  audioEl.addEventListener('loadedmetadata', function () {
    if (isVideoMedia || remoteMode) return;
    var timeTotal = document.getElementById('time-total');
    if (timeTotal) timeTotal.textContent = formatTime(audioEl.duration);
  });

  audioEl.addEventListener('play', function () {
    if (!isVideoMedia && !remoteMode) updatePlayButton(true);
  });

  audioEl.addEventListener('pause', function () {
    if (!isVideoMedia && !remoteMode) updatePlayButton(false);
  });

  audioEl.addEventListener('ended', function () {
    if (isVideoMedia || remoteMode) return;
    updatePlayButton(false);
    stopVU();
    if (window.playlist) window.playlist.onTrackEnded();
  });

  // ── UI Helpers ────────────────────────────────────────
  function updatePlayButton(playing) {
    var btn = document.getElementById('btn-play');
    if (btn && window.Icons) {
      btn.innerHTML = window.Icons.get(playing ? 'pause' : 'play', { size: 28 });
    }
  }

  function updateVolumeUI() {
    var slider = document.getElementById('vol-slider');
    var label = document.getElementById('vol-label');
    var btn = document.getElementById('btn-mute');
    if (slider) slider.value = currentVolume * 100;
    if (label) label.textContent = Math.round(currentVolume * 100) + '%';
    if (btn && window.Icons) {
      var iconName = currentVolume === 0 ? 'volume-x' : (currentVolume < 0.5 ? 'volume-1' : 'volume');
      btn.innerHTML = window.Icons.get(iconName, { size: 20 });
    }
  }

  function updateMicButton(active) {
    var btn = document.getElementById('btn-mic');
    if (!btn) return;
    var tr = window.appI18n ? window.appI18n.tr : function(k){return k;};
    var micIcon = window.Icons ? window.Icons.get('mic', { size: 20, className: active ? 'text-white' : 'text-yellow-400' }) : '';
    if (active) {
      btn.className = 'touch-btn w-full min-h-[50px] py-3.5 px-4 rounded-2xl border-2 border-accent bg-accent text-white font-bold text-sm flex items-center justify-center gap-2.5 transition mic-pulse shadow-lg shadow-accent/40';
      btn.innerHTML = micIcon + ' <span>' + tr('btn_mic_active') + '</span>';
    } else {
      btn.className = 'touch-btn w-full min-h-[50px] py-3.5 px-4 bg-dark-700 hover:bg-dark-600 border-2 border-yellow-500/80 rounded-2xl font-bold text-sm text-yellow-400 flex items-center justify-center gap-2.5 transition shadow-md';
      btn.innerHTML = micIcon + ' <span>' + tr('btn_mic') + '</span>';
    }
  }

  function updateStatus(text) {
    var el = document.getElementById('status-text');
    if (el) el.textContent = text;
  }

  function formatTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    var m = (sec / 60) | 0;
    var s = (sec % 60) | 0;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setRemoteVU(l, r) {
    if (remoteMode) {
      if (Math.random() < 0.05) {
        console.log('[AudioEngine] Applying VU levels to DOM:', l, r);
      }
      setVU(l, r);
    }
  }

  function handleFullscreenChange() {
    var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    var isContainerFs = isFs && (document.fullscreenElement === videoContainer || document.webkitFullscreenElement === videoContainer || document.fullscreenElement === videoEl);
    if (videoContainer) {
      if (isContainerFs) {
        videoContainer.classList.add('is-fullscreen');
      } else {
        videoContainer.classList.remove('is-fullscreen');
      }
    }
    var fsBtn = document.getElementById('btn-video-fullscreen');
    if (fsBtn) {
      fsBtn.title = isContainerFs ? 'Exit Fullscreen' : 'Fullscreen';
      var iconSpan = fsBtn.querySelector('[data-icon]');
      if (iconSpan) {
        iconSpan.setAttribute('data-icon', isContainerFs ? 'minimize' : 'maximize');
        if (window.Icons) {
          iconSpan.innerHTML = window.Icons.get(isContainerFs ? 'minimize' : 'maximize', { size: 14 });
        }
      }
    }
  }

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

  function toggleVideoPip() {
    initVideoElements();
    if (!videoEl) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(function () {});
    } else if (document.pictureInPictureEnabled) {
      videoEl.requestPictureInPicture().catch(function () {});
    }
  }

  function toggleVideoFullscreen() {
    initVideoElements();
    var target = videoContainer || videoEl;
    if (!target) return;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (target.requestFullscreen) {
        target.requestFullscreen().catch(function () {});
      } else if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  // ── Public API ────────────────────────────────────────
  window.audioEngine = {
    play: play,
    pause: pause,
    stop: stop,
    stopWithFade: stopWithFade,
    seekTo: seekTo,
    setVolume: setVolume,
    toggleMute: toggleMute,
    toggleDuck: toggleDuck,
    duck: duck,
    unduck: unduck,
    toggleVideoPip: toggleVideoPip,
    toggleVideoFullscreen: toggleVideoFullscreen,
    setFadeDuration: function (sec) { configFadeDuration = sec * 1000; },
    setDuckVolume: function (vol) { configDuckVolume = vol; },
    setDuckDuration: function (ms) { configDuckDuration = ms; },
    setRemoteMode: function (enabled) {
      remoteMode = !!enabled;
      if (!remoteMode) {
        stopVU();
      }
    },
    setRemoteState: function (state) {
      remotePlaying = !!state.playing;
      remoteTrack = state.track || null;
      remoteVolume = state.volume !== undefined ? state.volume : 80;
      remoteDuration = state.duration || 0;
      remoteCurrentTime = state.currentTime || 0;

      initVideoElements();
      if (remoteMode && videoEl && videoContainer) {
        if (remoteTrack && isVideoPath(remoteTrack)) {
          isVideoMedia = true;
          videoContainer.classList.remove('hidden');
          var encodedPath = remoteTrack.split('/').map(encodeURIComponent).join('/');
          var fullVideoSrc = '/uploads/' + encodedPath;
          if (!videoEl.src.endsWith(encodedPath)) {
            videoEl.src = fullVideoSrc;
          }
          videoEl.muted = true; // Mute preview to avoid echo with stream receiver
          if (Math.abs(videoEl.currentTime - remoteCurrentTime) > 0.5) {
            videoEl.currentTime = remoteCurrentTime;
          }
          if (remotePlaying && videoEl.paused) {
            videoEl.play().catch(function () {});
          } else if (!remotePlaying && !videoEl.paused) {
            videoEl.pause();
          }
        } else {
          isVideoMedia = false;
          videoContainer.classList.add('hidden');
          if (videoEl.src) {
            videoEl.pause();
            videoEl.src = '';
          }
        }
      }
    },
    setRemoteVU: setRemoteVU,
    get isPlaying() {
      if (remoteMode) return remotePlaying;
      var media = getActiveMedia();
      return !media.paused;
    },
    get isPaused() {
      if (remoteMode) return !remotePlaying;
      var media = getActiveMedia();
      return media.paused;
    },
    get duration() {
      if (remoteMode) return remoteDuration;
      var media = getActiveMedia();
      return media.duration || 0;
    },
    get currentTime() {
      if (remoteMode) return remoteCurrentTime;
      var media = getActiveMedia();
      return media.currentTime || 0;
    },
    get volume() { return remoteMode ? remoteVolume / 100 : currentVolume; },
    get isDucked() { return isDucked; },
    get remoteMode() { return remoteMode; },
    get remoteTrack() { return remoteTrack; },
    get isVideoMedia() { return isVideoMedia; },
    getActiveMedia: getActiveMedia,
    audioEl: audioEl,
    get videoEl() { return videoEl; },
  };
})();
