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

  function connectSource() {
    if (isCtxConnected) return;
    ensureContext();
    try {
      sourceNode = audioCtx.createMediaElementSource(audioEl);
      sourceNode.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      sourceNode.connect(audioCtx.destination);
      isCtxConnected = true;
    } catch (e) {
      // Already connected (only one MediaElementSource per element)
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

    ensureContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    audioEl.src = url;
    audioEl.volume = isDucked ? configDuckVolume : currentVolume;
    const p = audioEl.play();
    if (p) p.catch(() => {});
    connectSource();
    startVU();
  }

  function pause() {
    if (remoteMode && window.streamController) {
      window.streamController.sendPause();
      return;
    }

    if (audioEl.paused) {
      audioEl.play().catch(() => {});
      startVU();
    } else {
      audioEl.pause();
    }
  }

  function stop() {
    if (remoteMode && window.streamController) {
      window.streamController.sendStop();
      updatePlayButton(false);
      return;
    }

    audioEl.pause();
    audioEl.currentTime = 0;
    stopVU();
  }

  function stopWithFade(durationMs) {
    if (remoteMode && window.streamController) {
      window.streamController.sendStop();
      updatePlayButton(false);
      updateStatus('Stopped');
      return;
    }

    durationMs = durationMs || configFadeDuration;
    startFade(audioEl.volume, 0, durationMs, function () {
      stop();
      audioEl.volume = currentVolume;
      updatePlayButton();
      updateStatus('Stopped');
    });
  }

  function seekTo(ratio) {
    if (remoteMode && window.streamController) {
      window.streamController.sendSeek(ratio);
      return;
    }

    if (audioEl.duration && isFinite(audioEl.duration)) {
      audioEl.currentTime = ratio * audioEl.duration;
    }
  }

  // ── Volume ────────────────────────────────────────────
  function setVolume(v) {
    currentVolume = Math.max(0, Math.min(1, v));

    if (remoteMode && window.streamController) {
      window.streamController.sendVolume(currentVolume * 100);
    }

    if (!isDucked && !fadeRafId) {
      audioEl.volume = currentVolume;
    }
    isMuted = currentVolume === 0;
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
      updateStatus(window.appI18n ? window.appI18n.tr('status_mic_on') : '🎙 MIC ON');
      return;
    }

    targetVol = targetVol !== undefined ? targetVol : configDuckVolume;
    durationMs = durationMs || configDuckDuration;
    if (isDucked) return;
    isDucked = true;
    preDuckVolume = audioEl.volume;
    startFade(audioEl.volume, targetVol, durationMs);
    updateMicButton(true);
    updateStatus(window.appI18n ? window.appI18n.tr('status_mic_on') : '🎙 MIC ON');
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
    startFade(audioEl.volume, currentVolume, durationMs);
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
    audioEl.volume = Math.max(0, Math.min(1, vol));

    if (progress < 1) {
      fadeRafId = requestAnimationFrame(fadeStep);
    } else {
      fadeRafId = null;
      audioEl.volume = fadeEndVol;
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
    var seekBar = document.getElementById('seek-bar');
    var timeCurrent = document.getElementById('time-current');
    if (seekBar && audioEl.duration) {
      seekBar.value = (audioEl.currentTime / audioEl.duration * 1000) | 0;
    }
    if (timeCurrent) timeCurrent.textContent = formatTime(audioEl.currentTime);
  });

  audioEl.addEventListener('loadedmetadata', function () {
    var timeTotal = document.getElementById('time-total');
    if (timeTotal) timeTotal.textContent = formatTime(audioEl.duration);
  });

  audioEl.addEventListener('play', function () {
    updatePlayButton(true);
  });

  audioEl.addEventListener('pause', function () {
    updatePlayButton(false);
  });

  audioEl.addEventListener('ended', function () {
    updatePlayButton(false);
    stopVU();
    if (window.playlist) window.playlist.onTrackEnded();
  });

  // ── UI Helpers ────────────────────────────────────────
  function updatePlayButton(playing) {
    var btn = document.getElementById('btn-play');
    if (btn) btn.textContent = playing ? '⏸' : '▶';
  }

  function updateVolumeUI() {
    var slider = document.getElementById('vol-slider');
    var label = document.getElementById('vol-label');
    var btn = document.getElementById('btn-mute');
    if (slider) slider.value = currentVolume * 100;
    if (label) label.textContent = Math.round(currentVolume * 100) + '%';
    if (btn) {
      if (currentVolume === 0) btn.textContent = '🔇';
      else if (currentVolume < 0.5) btn.textContent = '🔉';
      else btn.textContent = '🔊';
    }
  }

  function updateMicButton(active) {
    var btn = document.getElementById('btn-mic');
    if (!btn) return;
    var tr = window.appI18n ? window.appI18n.tr : function(k){return k;};
    if (active) {
      btn.className = 'w-full py-3 rounded-xl border-2 border-accent bg-accent text-white font-bold text-lg transition mic-pulse';
      btn.innerHTML = '🎙 ' + tr('btn_mic_active');
    } else {
      btn.className = 'w-full py-3 rounded-xl border-2 border-yellow-500 text-yellow-400 font-bold text-lg hover:bg-yellow-500/10 transition';
      btn.innerHTML = '🎙 ' + tr('btn_mic');
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
    },
    setRemoteVU: setRemoteVU,
    get isPlaying() { return remoteMode ? remotePlaying : !audioEl.paused; },
    get isPaused() { return remoteMode ? !remotePlaying : audioEl.paused; },
    get duration() { return remoteMode ? remoteDuration : (audioEl.duration || 0); },
    get currentTime() { return remoteMode ? remoteCurrentTime : (audioEl.currentTime || 0); },
    get volume() { return remoteMode ? remoteVolume / 100 : currentVolume; },
    get isDucked() { return isDucked; },
    get remoteMode() { return remoteMode; },
    get remoteTrack() { return remoteTrack; },
    audioEl: audioEl,
  };
})();
