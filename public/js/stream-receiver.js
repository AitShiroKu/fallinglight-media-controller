/**
 * Stream Receiver — Client-side logic for the streaming receiver page.
 *
 * Connects to the server via WebSocket, receives commands from the Controller,
 * and plays audio locally using HTML5 Audio + Web Audio API.
 * Sends state updates back to the Controller every second.
 */
(function () {
  'use strict';

  // ── Mode Detection (/stream, /stream/audio, /stream/video) ──
  var path = window.location.pathname.toLowerCase();
  var urlParams = new URLSearchParams(window.location.search);
  var streamMode = urlParams.get('mode') || (path.endsWith('/audio') ? 'audio' : path.endsWith('/video') ? 'video' : 'both');

  // Highlight active mode pill in header
  function initModeUI() {
    var pillBoth = document.getElementById('mode-pill-both');
    var pillAudio = document.getElementById('mode-pill-audio');
    var pillVideo = document.getElementById('mode-pill-video');
    var modeLabel = document.getElementById('video-mode-label');
    var headerIcon = document.getElementById('header-mode-icon');

    [pillBoth, pillAudio, pillVideo].forEach(function (p) {
      if (p) p.classList.remove('border-accent', 'text-accent', 'bg-accent/20');
    });

    if (streamMode === 'audio') {
      if (pillAudio) pillAudio.classList.add('border-accent', 'text-accent', 'bg-accent/20');
      if (modeLabel) modeLabel.textContent = 'AUDIO STREAM ONLY';
      if (headerIcon) {
        if (window.Icons) headerIcon.innerHTML = window.Icons.get('music', { size: 32, className: 'text-accent' });
        else headerIcon.textContent = 'Audio';
      }
    } else if (streamMode === 'video') {
      if (pillVideo) pillVideo.classList.add('border-accent', 'text-accent', 'bg-accent/20');
      if (modeLabel) modeLabel.textContent = 'VIDEO STREAM ONLY';
      if (headerIcon) {
        if (window.Icons) headerIcon.innerHTML = window.Icons.get('video', { size: 32, className: 'text-accent' });
        else headerIcon.textContent = 'Video';
      }
    } else {
      if (pillBoth) pillBoth.classList.add('border-accent', 'text-accent', 'bg-accent/20');
      if (modeLabel) modeLabel.textContent = 'LIVE STREAM (ALL)';
      if (headerIcon) {
        if (window.Icons) headerIcon.innerHTML = window.Icons.get('broadcast', { size: 32, className: 'text-accent' });
        else headerIcon.textContent = 'Live';
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModeUI);
  } else {
    initModeUI();
  }

  // ── Audio/Video Elements (self-contained for receiver) ──
  var audioEl = new Audio();
  audioEl.crossOrigin = 'anonymous';
  audioEl.preload = 'auto';
  audioEl.id = 'receiver-audio';
  audioEl.style.display = 'none';
  if (document.body) {
    document.body.appendChild(audioEl);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.appendChild(audioEl);
    });
  }

  var videoEl = null;
  var videoContainer = null;
  var pureView = null;
  var videoHud = null;
  var hudTimer = null;
  var currentResolution = 'original';
  try {
    var savedRes = localStorage.getItem('fallinglight_receiver_res');
    if (savedRes) currentResolution = savedRes;
  } catch (e) {}

  function getVideoSrc(trackFilename, resolution) {
    if (!trackFilename) return '';
    var res = resolution || currentResolution || 'original';
    if (res === 'original' || res === 'auto') {
      return '/uploads/' + trackFilename.split('/').map(encodeURIComponent).join('/');
    }
    return '/api/streaming/video-rendition?file=' + encodeURIComponent(trackFilename) + '&res=' + encodeURIComponent(res);
  }

  function getResolutionDisplay(res) {
    switch (res) {
      case '1080p': return '1080p';
      case '720p': return '720p';
      case '480p': return '480p';
      case '360p': return '360p';
      default: return 'Auto';
    }
  }

  function updateResolutionUI() {
    var labelText = getResolutionDisplay(currentResolution);
    var hudLabel = document.getElementById('hud-quality-label');
    if (hudLabel) hudLabel.textContent = labelText;
    var dashLabel = document.getElementById('dash-quality-label');
    if (dashLabel) dashLabel.textContent = labelText;

    var optionBtns = document.querySelectorAll('.quality-option');
    for (var i = 0; i < optionBtns.length; i++) {
      var btn = optionBtns[i];
      var optRes = btn.getAttribute('data-res');
      var check = btn.querySelector('.quality-check');
      if (optRes === currentResolution) {
        if (check) check.classList.remove('hidden');
        btn.classList.add('text-accent', 'font-bold');
        btn.classList.remove('text-gray-300');
      } else {
        if (check) check.classList.add('hidden');
        btn.classList.remove('text-accent', 'font-bold');
        btn.classList.add('text-gray-300');
      }
    }
  }

  function setReceiverResolution(newRes) {
    if (!newRes || newRes === currentResolution) return;
    currentResolution = newRes;
    try {
      localStorage.setItem('fallinglight_receiver_res', newRes);
    } catch (e) {}
    updateResolutionUI();

    // Hot-swap video stream if currently playing a video file
    var activeTrack = currentTrack;
    if (!activeTrack && videoEl && videoEl.src) {
      try {
        var parsedUrl = new URL(videoEl.src, window.location.href);
        if (parsedUrl.pathname.startsWith('/uploads/')) {
          activeTrack = decodeURIComponent(parsedUrl.pathname.replace(/^\/uploads\//, ''));
        } else if (parsedUrl.pathname.startsWith('/api/streaming/video-rendition')) {
          activeTrack = parsedUrl.searchParams.get('file') || '';
        }
      } catch (e) {}
    }

    if (videoEl && activeTrack && (isCurrentMediaVideo || isVideoPath(activeTrack))) {
      var wasPlaying = !videoEl.paused;
      var curTime = videoEl.currentTime || 0;
      var newSrc = getVideoSrc(activeTrack, currentResolution);

      var curFull = '';
      var targetFull = '';
      try {
        curFull = new URL(videoEl.src || '', window.location.href).href;
        targetFull = new URL(newSrc, window.location.href).href;
      } catch (e) {}

      if (curFull && targetFull && curFull !== targetFull) {
        var restoreSeek = function () {
          videoEl.removeEventListener('loadedmetadata', restoreSeek);
          try {
            if (curTime > 0 && curTime < (videoEl.duration || Infinity)) {
              videoEl.currentTime = curTime;
            }
          } catch (err) {}
          if (wasPlaying) {
            safePlayMedia(videoEl, streamMode === 'video');
          }
        };
        videoEl.addEventListener('loadedmetadata', restoreSeek);
        videoEl.src = newSrc;
        videoEl.load();
      }
    }
  }

  function showHUD() {
    if (!videoHud) return;
    videoHud.classList.remove('opacity-0', 'pointer-events-none');
    videoHud.classList.add('opacity-100', 'pointer-events-auto');
    if (pureView) pureView.classList.remove('cursor-none');

    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = setTimeout(function () {
      hideHUD();
    }, 2500);
  }

  function hideHUD() {
    if (!videoHud) return;
    videoHud.classList.remove('opacity-100', 'pointer-events-auto');
    videoHud.classList.add('opacity-0', 'pointer-events-none');
    if (pureView && videoEl && !videoEl.paused) {
      pureView.classList.add('cursor-none');
    }
  }

  function getResolutionTag(w, h, ext) {
    if (!w || !h) return '';
    var q = '';
    if (h >= 2160 || w >= 3840) q = '4K UHD';
    else if (h >= 1440 || w >= 2560) q = '1440p 2K';
    else if (h >= 1080 || w >= 1920) q = '1080p FHD';
    else if (h >= 720 || w >= 1280) q = '720p HD';
    else if (h >= 480) q = '480p';
    else q = h + 'p';
    return q + ' (' + w + '×' + h + ')' + (ext ? ' ' + ext.toUpperCase() : '');
  }

  function initVideoEl() {
    pureView = document.getElementById('pure-video-view');
    videoHud = document.getElementById('video-hud');

    if (streamMode === 'video') {
      // Configure Clean Full-Bleed Video Canvas Mode
      videoEl = document.getElementById('receiver-video-pure');
      videoContainer = pureView;

      document.body.classList.remove('pt-10', 'items-center', 'justify-center');
      document.body.classList.add('p-0', 'm-0', 'bg-black', 'overflow-hidden');

      var prBanner = document.getElementById('pr-warning-banner');
      if (prBanner) prBanner.classList.add('hidden');
      var unlockOverlay = document.getElementById('unlock-overlay');
      if (unlockOverlay) { unlockOverlay.classList.add('hidden'); unlockOverlay.style.display = 'none'; }
      var streamContainer = document.getElementById('stream-container');
      if (streamContainer) streamContainer.classList.add('hidden');
      if (pureView) pureView.classList.remove('hidden');

      // Setup HUD interactions on pure video view
      if (pureView) {
        pureView.addEventListener('mousemove', showHUD);
        pureView.addEventListener('pointermove', showHUD);
        pureView.addEventListener('focusin', showHUD);
        pureView.addEventListener('mouseleave', hideHUD);
        pureView.addEventListener('focusout', function (e) {
          if (!pureView.contains(e.relatedTarget)) hideHUD();
        });
      }

      var btnPureFs = document.getElementById('btn-pure-fullscreen');
      if (btnPureFs) {
        btnPureFs.addEventListener('click', function () {
          if (!document.fullscreenElement) {
            (pureView || document.documentElement).requestFullscreen().catch(function () {});
          } else {
            document.exitFullscreen().catch(function () {});
          }
        });
      }
    } else {
      videoEl = document.getElementById('receiver-video');
      videoContainer = document.getElementById('video-container');
    }

    if (videoEl) {
      videoEl.crossOrigin = 'anonymous';
      videoEl.preload = 'auto';
      videoEl.playsInline = true;

      videoEl.addEventListener('timeupdate', updateProgress);
      videoEl.addEventListener('loadedmetadata', function () {
        var timeTotal = document.getElementById('stream-time-total');
        if (timeTotal && isFinite(videoEl.duration)) timeTotal.textContent = formatTime(videoEl.duration);
        var hudTotal = document.getElementById('hud-time-total');
        if (hudTotal && isFinite(videoEl.duration)) hudTotal.textContent = formatTime(videoEl.duration);

        // Update resolution badge in HUD
        var resBadge = document.getElementById('hud-resolution-badge');
        if (resBadge && videoEl.videoWidth && videoEl.videoHeight) {
          var ext = currentTrack ? currentTrack.slice(currentTrack.lastIndexOf('.') + 1) : 'MP4';
          resBadge.textContent = getResolutionTag(videoEl.videoWidth, videoEl.videoHeight, ext);
          resBadge.classList.remove('hidden');
        }
      });
      videoEl.addEventListener('play', updatePlayState);
      videoEl.addEventListener('pause', updatePlayState);
      videoEl.addEventListener('ended', onMediaEnded);

      videoEl.addEventListener('click', function () {
        pauseToggle();
      });
      videoEl.addEventListener('dblclick', function () {
        if (!document.fullscreenElement) {
          (videoContainer || document.documentElement).requestFullscreen().catch(function () {});
        } else {
          document.exitFullscreen().catch(function () {});
        }
      });
    }

    var btnFs = document.getElementById('btn-fullscreen');
    if (btnFs) {
      btnFs.addEventListener('click', function () {
        if (!document.fullscreenElement) {
          (videoContainer || videoEl).requestFullscreen().catch(function () {});
        } else {
          document.exitFullscreen().catch(function () {});
        }
      });
    }

    // Setup Quality dropdown toggles and option handlers
    function setupQualityDropdown(btnId, menuId) {
      var btn = document.getElementById(btnId);
      var menu = document.getElementById(menuId);
      if (!btn || !menu) return;

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isHidden = menu.classList.contains('hidden');
        var allMenus = document.querySelectorAll('#hud-quality-menu, #dash-quality-menu');
        for (var i = 0; i < allMenus.length; i++) {
          allMenus[i].classList.add('hidden');
        }
        if (isHidden) {
          menu.classList.remove('hidden');
          if (typeof showHUD === 'function') showHUD();
        }
      });
    }

    setupQualityDropdown('btn-hud-quality', 'hud-quality-menu');
    setupQualityDropdown('btn-dash-quality', 'dash-quality-menu');

    document.addEventListener('click', function (e) {
      if (!e.target.closest('#hud-quality-dropdown') && !e.target.closest('#dash-quality-dropdown')) {
        var hm = document.getElementById('hud-quality-menu');
        if (hm) hm.classList.add('hidden');
        var dm = document.getElementById('dash-quality-menu');
        if (dm) dm.classList.add('hidden');
      }
    });

    var optionBtns = document.querySelectorAll('.quality-option');
    for (var i = 0; i < optionBtns.length; i++) {
      optionBtns[i].addEventListener('click', function (e) {
        e.stopPropagation();
        var targetRes = this.getAttribute('data-res');
        setReceiverResolution(targetRes);
        var hm = document.getElementById('hud-quality-menu');
        if (hm) hm.classList.add('hidden');
        var dm = document.getElementById('dash-quality-menu');
        if (dm) dm.classList.add('hidden');
      });
    }

    updateResolutionUI();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVideoEl);
  } else {
    initVideoEl();
  }

  var audioCtx = null;
  var analyserL = null;
  var analyserR = null;
  var audioSourceNode = null;
  var videoSourceNode = null;
  var splitter = null;
  var connectedElement = null;

  var currentVolume = 0.8;
  var isDucked = false;
  var preDuckVolume = 0.8;
  var currentTrack = null;
  var currentLoop = 0;
  var maxLoop = 1;
  var isCurrentMediaVideo = false;

  var dataL = null;
  var dataR = null;
  var vuIntervalId = null;

  // ── WebSocket ─────────────────────────────────────────
  var ws = null;
  var reconnectTimer = null;
  var roomId = null;
  var isConnected = false;
  var controllerConnected = false;

  function isVideoPath(name) {
    return /\.(mp4|webm|mkv|avi)$/i.test(name || '');
  }

  function getActiveMedia() {
    return (isCurrentMediaVideo && streamMode !== 'audio' && videoEl) ? videoEl : audioEl;
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
    if (!targetEl) return;
    ensureContext();
    try {
      if (targetEl === audioEl) {
        if (!audioSourceNode) {
          audioSourceNode = audioCtx.createMediaElementSource(audioEl);
          audioSourceNode.connect(splitter);
          splitter.connect(analyserL, 0);
          splitter.connect(analyserR, 1);
          audioSourceNode.connect(audioCtx.destination);
        }
      } else if (targetEl === videoEl) {
        if (!videoSourceNode) {
          videoSourceNode = audioCtx.createMediaElementSource(videoEl);
          videoSourceNode.connect(splitter);
          splitter.connect(analyserL, 0);
          splitter.connect(analyserR, 1);
          videoSourceNode.connect(audioCtx.destination);
        }
      }
    } catch (e) {
      console.warn('[StreamReceiver] AudioSource connection note:', e);
    }
  }

  function safePlayMedia(el, initialMuted) {
    if (!el) return;
    el.muted = initialMuted;
    var p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) {
        console.warn('[StreamReceiver] Play rejected (autoplay policy), falling back to muted play:', err);
        if (!el.muted) {
          el.muted = true;
          el.play().then(function () {
            console.log('[StreamReceiver] Recovered video playback with muted fallback');
          }).catch(function (e2) {
            console.error('[StreamReceiver] Autoplay fallback failed:', e2);
          });
        }
      });
    }
  }

  // ── Playback ──────────────────────────────────────────
  function play(url, filename, loop, isVideoHint) {
    ensureContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});

    currentTrack = filename || url;
    maxLoop = (loop !== undefined && loop !== null) ? loop : 1;
    currentLoop = 0;
    isCurrentMediaVideo = isVideoHint !== undefined ? !!isVideoHint : isVideoPath(currentTrack);

    var mediaIcon = document.getElementById('stream-media-icon');
    if (mediaIcon && window.Icons) {
      mediaIcon.innerHTML = window.Icons.get(isCurrentMediaVideo ? 'video' : 'music', { size: 24, className: isCurrentMediaVideo ? 'text-indigo-400' : 'text-accent' });
    }

    var standbyEl = document.getElementById('video-standby');

    if (isCurrentMediaVideo) {
      if (streamMode === 'audio') {
        // Audio-only mode: hide video, play audio
        if (videoContainer) videoContainer.classList.add('hidden');
        if (videoEl) { videoEl.pause(); videoEl.src = ''; }

        audioEl.src = url;
        audioEl.volume = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
        safePlayMedia(audioEl, false);
        connectSource(audioEl);
        startVU();

      } else if (streamMode === 'video') {
        // Video-only mode: show clean video canvas, mute audio
        if (audioEl) { audioEl.pause(); audioEl.src = ''; }
        if (standbyEl) standbyEl.classList.add('hidden');
        if (videoContainer) videoContainer.classList.remove('hidden');

        if (videoEl) {
          videoEl.classList.remove('hidden');
          videoEl.src = getVideoSrc(currentTrack, currentResolution);
          videoEl.volume = 0;
          safePlayMedia(videoEl, true);
        }
        stopVU();

        var hudTitle = document.getElementById('hud-track-title');
        if (hudTitle) hudTitle.textContent = currentTrack.replace(/\.[^/.]+$/, '');
        showHUD();

      } else {
        // Default: Both Video and Audio
        if (audioEl) { audioEl.pause(); audioEl.src = ''; }
        if (videoContainer) videoContainer.classList.remove('hidden');

        if (videoEl) {
          videoEl.src = getVideoSrc(currentTrack, currentResolution);
          videoEl.volume = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
          safePlayMedia(videoEl, false);
          connectSource(videoEl);
        }
        startVU();
      }
    } else {
      // Audio-only track
      if (videoContainer) videoContainer.classList.add('hidden');
      if (videoEl) { videoEl.pause(); videoEl.src = ''; }
      if (standbyEl && streamMode === 'video') {
        standbyEl.classList.remove('hidden');
        var standbyMsg = document.getElementById('video-standby-msg');
        if (standbyMsg) standbyMsg.textContent = 'เพลงเสียงเท่านั้น: ' + currentTrack;
      }

      audioEl.src = url;
      if (streamMode === 'video') {
        audioEl.muted = true;
        stopVU();
      } else {
        audioEl.volume = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
        safePlayMedia(audioEl, false);
        connectSource(audioEl);
        startVU();
      }
    }

    updateNowPlaying();
  }

  function pauseToggle() {
    var media = getActiveMedia();
    if (!media) return;

    if (media.paused) {
      media.play().catch(function () {});
      if (streamMode !== 'video') startVU();
    } else {
      media.pause();
      stopVU();
    }
    updatePlayState();
  }

  function stop() {
    if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
    if (videoEl) { videoEl.pause(); videoEl.currentTime = 0; }
    stopVU();
    var standbyEl = document.getElementById('video-standby');
    if (standbyEl && streamMode === 'video') {
      standbyEl.classList.remove('hidden');
      if (videoEl) videoEl.classList.add('hidden');
    }
    updatePlayState();
  }

  function setVolume(v) {
    currentVolume = Math.max(0, Math.min(1, v));
    var vol = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
    if (audioEl && streamMode !== 'video') audioEl.volume = vol;
    if (videoEl && streamMode === 'both') videoEl.volume = vol;
    updateVolumeUI();
  }

  function seekTo(ratio, seconds) {
    var media = getActiveMedia();
    if (media && media.duration && isFinite(media.duration) && media.duration > 0) {
      if (seconds !== undefined && isFinite(seconds)) {
        media.currentTime = Math.max(0, Math.min(media.duration - 0.5, seconds));
      } else if (ratio !== undefined && isFinite(ratio)) {
        var maxSeek = Math.max(0, media.duration - 0.5);
        var target = Math.max(0, Math.min(maxSeek, ratio * media.duration));
        media.currentTime = target;
      }
    }
  }

  function duckAudio(active) {
    var duckEl = document.getElementById('duck-indicator');
    if (active && !isDucked) {
      isDucked = true;
      preDuckVolume = currentVolume;
      var duckVol = Math.max(0, currentVolume * 0.15);
      if (audioEl && streamMode !== 'video') audioEl.volume = duckVol;
      if (videoEl && streamMode === 'both') videoEl.volume = duckVol;
      if (duckEl) duckEl.classList.remove('hidden');
    } else if (!active && isDucked) {
      isDucked = false;
      if (audioEl && streamMode !== 'video') audioEl.volume = currentVolume;
      if (videoEl && streamMode === 'both') videoEl.volume = currentVolume;
      if (duckEl) duckEl.classList.add('hidden');
    }
  }

  function onMediaEnded() {
    currentLoop++;
    var media = getActiveMedia();
    if (maxLoop === 0) {
      // Infinite loop
      if (media) {
        media.currentTime = 0;
        media.play().catch(function () {});
      }
    } else if (currentLoop < maxLoop) {
      if (media) {
        media.currentTime = 0;
        media.play().catch(function () {});
      }
    } else {
      // Track finished all loops
      stopVU();
      updatePlayState();
      sendState();
      wsSend({ type: 'track_ended' });
    }
    updateNowPlaying();
  }

  audioEl.addEventListener('ended', onMediaEnded);

  // ── VU Meter ──────────────────────────────────────────
  function sendVu(l, r) {
    if (!controllerConnected) return;
    if (Math.random() < 0.05) {
      console.log('[StreamReceiver] Sending VU levels to controller:', l, r);
    }
    wsSend({
      type: 'vu_update',
      l: Math.round(l * 100) / 100,
      r: Math.round(r * 100) / 100
    });
  }

  function startVU() {
    if (vuIntervalId) return;
    vuIntervalId = setInterval(vuTick, 40);
  }

  function stopVU() {
    if (vuIntervalId) {
      clearInterval(vuIntervalId);
      vuIntervalId = null;
    }
    setVU(0, 0);
    sendVu(0, 0);
  }

  function vuTick() {
    if (!analyserL || !analyserR) {
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
    sendVu(avgL, avgR);
  }

  function setVU(l, r) {
    var vuL = document.getElementById('stream-vu-left');
    var vuR = document.getElementById('stream-vu-right');
    var vuDb = document.getElementById('stream-vu-db');
    if (vuL) vuL.style.height = (l * 100) + '%';
    if (vuR) vuR.style.height = (r * 100) + '%';
    if (vuDb) {
      var peak = Math.max(l, r);
      vuDb.textContent = peak > 0.001 ? (20 * Math.log10(peak)).toFixed(0) + ' dB' : '-∞ dB';
    }
  }

  // ── UI Updates ────────────────────────────────────────
  function updateNowPlaying() {
    var titleEl = document.getElementById('stream-track-title');
    var fileEl = document.getElementById('stream-track-file');
    var loopBadge = document.getElementById('stream-loop-badge');
    var loopText = document.getElementById('stream-loop-text');

    if (currentTrack) {
      var displayName = currentTrack.replace(/\.[^/.]+$/, '');
      if (titleEl) titleEl.textContent = displayName;
      if (fileEl) {
        var folderIcon = window.Icons ? window.Icons.get('folder', { size: 12, className: 'inline mr-1 text-muted' }) : '';
        fileEl.innerHTML = folderIcon + '<span>' + currentTrack + '</span>';
      }

      if (maxLoop !== 1) {
        if (loopBadge) loopBadge.classList.remove('hidden');
        if (loopText) {
          if (maxLoop === 0) {
            loopText.textContent = '∞ (' + (currentLoop + 1) + ')';
          } else {
            loopText.textContent = (currentLoop + 1) + '/' + maxLoop;
          }
        }
      } else {
        if (loopBadge) loopBadge.classList.add('hidden');
      }
    } else {
      if (titleEl) titleEl.textContent = '—';
      if (fileEl) fileEl.textContent = 'ไม่มีเพลงที่เล่น';
      if (loopBadge) loopBadge.classList.add('hidden');
    }
  }

  function updatePlayState() {
    var stateEl = document.getElementById('stream-playing-state');
    var media = getActiveMedia();
    if (stateEl && media) {
      if (media.paused) {
        var pauseIcon = window.Icons ? window.Icons.get('pause', { size: 12, className: 'inline mr-1' }) : '';
        stateEl.innerHTML = pauseIcon + '<span>Paused</span>';
        stateEl.className = 'text-xs sm:text-sm text-muted font-bold mt-1 px-3 py-0.5 rounded-full bg-dark-700/50 border border-dark-500 inline-flex items-center';
      } else {
        var playIcon = window.Icons ? window.Icons.get('play', { size: 12, className: 'inline mr-1' }) : '';
        stateEl.innerHTML = playIcon + '<span>Playing</span>';
        stateEl.className = 'text-xs sm:text-sm text-accent font-bold mt-1 px-3 py-0.5 rounded-full bg-accent/10 border border-accent/20 inline-flex items-center';
      }
    }
  }

  function updateProgress() {
    var bar = document.getElementById('stream-progress');
    var timeCurrent = document.getElementById('stream-time-current');
    var timeTotal = document.getElementById('stream-time-total');
    var hudBar = document.getElementById('hud-progress-bar');
    var hudCur = document.getElementById('hud-time-current');
    var hudTot = document.getElementById('hud-time-total');
    var media = getActiveMedia();

    if (media && media.duration && isFinite(media.duration)) {
      var pct = (media.currentTime / media.duration) * 100;
      if (bar) bar.style.width = pct + '%';
      if (timeCurrent) timeCurrent.textContent = formatTime(media.currentTime);
      if (timeTotal) timeTotal.textContent = formatTime(media.duration);
      if (hudBar) hudBar.style.width = pct + '%';
      if (hudCur) hudCur.textContent = formatTime(media.currentTime);
      if (hudTot) hudTot.textContent = formatTime(media.duration);
    }
  }

  audioEl.addEventListener('timeupdate', updateProgress);
  audioEl.addEventListener('loadedmetadata', function () {
    var timeTotal = document.getElementById('stream-time-total');
    if (timeTotal && isFinite(audioEl.duration)) timeTotal.textContent = formatTime(audioEl.duration);
  });
  audioEl.addEventListener('play', updatePlayState);
  audioEl.addEventListener('pause', updatePlayState);

  // ── Connection Status UI ──────────────────────────────
  function setConnectionStatus(status) {
    var icon = document.getElementById('status-icon');
    var label = document.getElementById('status-label');
    var sub = document.getElementById('status-sub');
    var card = document.getElementById('status-card');
    var npCard = document.getElementById('now-playing');

    switch (status) {
      case 'waiting':
        if (icon) {
          icon.className = 'text-4xl mb-3 flex items-center justify-center pulse-waiting text-yellow-400';
          icon.innerHTML = window.Icons ? window.Icons.get('broadcast', { size: 48, className: 'text-yellow-400' }) : '';
        }
        if (label) { label.textContent = 'กำลังรอการเชื่อมต่อจากรีโมท...'; label.className = 'text-xl font-bold text-yellow-400'; }
        if (sub) sub.textContent = 'เปิดหน้านี้ทิ้งไว้บนคอมพิวเตอร์ห้องโสตฯ';
        if (card) card.className = 'bg-dark-800 border border-dark-500 rounded-2xl p-8 mb-6 text-center glow-accent transition-all duration-500';
        if (npCard) npCard.classList.add('hidden');
        break;

      case 'connected':
        if (icon) {
          icon.className = 'text-4xl mb-3 flex items-center justify-center pulse-connected text-green-400';
          icon.innerHTML = window.Icons ? window.Icons.get('check', { size: 48, className: 'text-green-400' }) : '';
        }
        if (label) { label.textContent = 'เชื่อมต่อกับรีโมทแล้ว!'; label.className = 'text-xl font-bold text-green-400'; }
        if (sub) sub.textContent = 'พร้อมรับคำสั่งจากมือถือ / แล็ปท็อป';
        if (card) card.className = 'bg-dark-800 border border-green-500/30 rounded-2xl p-8 mb-6 text-center transition-all duration-500';
        if (npCard) npCard.classList.remove('hidden');
        break;

      case 'disconnected':
        if (icon) {
          icon.className = 'text-4xl mb-3 flex items-center justify-center text-red-400';
          icon.innerHTML = window.Icons ? window.Icons.get('warning', { size: 48, className: 'text-red-400' }) : '';
        }
        if (label) { label.textContent = 'ขาดการเชื่อมต่อ'; label.className = 'text-xl font-bold text-red-400'; }
        if (sub) sub.textContent = 'กำลังเชื่อมต่อใหม่...';
        if (card) card.className = 'bg-dark-800 border border-red-500/30 rounded-2xl p-8 mb-6 text-center transition-all duration-500';
        break;

      case 'standby':
      case 'no_room':
        if (icon) {
          icon.className = 'text-4xl mb-3 flex items-center justify-center pulse-waiting text-amber-400';
          icon.innerHTML = window.Icons ? window.Icons.get('broadcast', { size: 48, className: 'text-amber-400' }) : '';
        }
        if (label) {
          label.textContent = 'รอการเริ่มออกอากาศจากส่วนกลาง...';
          label.className = 'text-xl font-bold text-amber-400';
        }
        if (sub) {
          sub.textContent = 'เปิดหน้านี้ทิ้งไว้บนคอมพิวเตอร์ลำโพง ระบบจะเชื่อมต่อและเล่นเสียงอัตโนมัติทันทีที่ส่วนกลางเริ่มออกอากาศ';
        }
        if (card) {
          card.className = 'bg-dark-800 border border-amber-500/30 rounded-2xl p-8 mb-6 text-center transition-all duration-500';
        }
        if (npCard) npCard.classList.add('hidden');
        break;
    }
  }

  // ── WebSocket Connection ──────────────────────────────
  function connect() {
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var roomParam = urlParams.get('room') || '';
    var url = protocol + '//' + window.location.host + '/ws/streaming?role=receiver' + (roomParam ? '&room=' + encodeURIComponent(roomParam) : '');

    updateConnectionInfo('WebSocket: กำลังเชื่อมต่อเซิร์ฟเวอร์...');

    ws = new WebSocket(url);

    ws.onopen = function () {
      isConnected = true;
      updateConnectionInfo('WebSocket: เชื่อมต่อกับเซิร์ฟเวอร์แล้ว (รอเริ่มออกอากาศ)');
      setConnectionStatus('standby');
    };

    ws.onmessage = function (event) {
      var data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      handleMessage(data);
    };

    ws.onclose = function () {
      isConnected = false;
      controllerConnected = false;
      updateConnectionInfo('WebSocket: กำลังรอการเชื่อมต่อใหม่...');
      setConnectionStatus('standby');
      scheduleReconnect(2000);
    };

    ws.onerror = function () {
      // onclose handles reconnect
    };
  }

  function scheduleReconnect(ms) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, ms);
  }

  function wsSend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ── Handle incoming messages from Controller ──────────
  function handleMessage(data) {
    switch (data.type) {
      case 'connected':
        if (data.standby) {
          setConnectionStatus('standby');
          updateConnectionInfo('สถานะ: รอส่วนกลางเริ่มออกอากาศ (สแตนด์บาย)');
        } else {
          setConnectionStatus('waiting');
          updateConnectionInfo('สถานะ: รอรีโมทเชื่อมต่อ');
        }
        break;

      case 'room_ready':
        roomId = data.roomId;
        setConnectionStatus('waiting');
        updateConnectionInfo('สถานะ: ห้องพร้อมแล้ว กำลังรอรีโมท');
        break;

      case 'peer_connected':
        if (data.role === 'controller') {
          controllerConnected = true;
          setConnectionStatus('connected');
          updateConnectionInfo('สถานะ: เชื่อมต่อกับรีโมทส่วนกลางแล้ว');
          sendState(); // Send state immediately to sync UI!
        }
        break;

      case 'peer_disconnected':
        if (data.role === 'controller') {
          controllerConnected = false;
          setConnectionStatus('waiting');
          updateConnectionInfo('สถานะ: รีโมทตัดการเชื่อมต่อชั่วคราว');
        }
        break;

      case 'room_closed':
        controllerConnected = false;
        stop();
        setConnectionStatus('standby');
        updateConnectionInfo('สถานะ: การออกอากาศสิ้นสุด (สแตนด์บายรอรอบถัดไป)');
        break;

      case 'play':
        if (data.filename) {
          var encodedFile = (data.filename || '').split('/').map(encodeURIComponent).join('/');
          play('/uploads/' + encodedFile, data.filename, data.loop, data.isVideo);
        }
        break;

      case 'resume':
        var mediaResume = getActiveMedia();
        if (mediaResume && mediaResume.paused) {
          safePlayMedia(mediaResume, streamMode === 'video');
          if (streamMode !== 'video') startVU();
          updatePlayState();
        }
        break;

      case 'pause':
        var mediaPause = getActiveMedia();
        if (mediaPause && !mediaPause.paused) {
          mediaPause.pause();
          stopVU();
          updatePlayState();
        }
        break;

      case 'stop':
        stop();
        break;

      case 'volume':
        if (data.level !== undefined) {
          setVolume(data.level / 100);
        }
        break;

      case 'seek':
        if (data.seconds !== undefined || data.ratio !== undefined) {
          seekTo(data.ratio, data.seconds);
        }
        break;

      case 'duck':
        duckAudio(!!data.active);
        break;

      case 'playlist_sync':
        // Receive full playlist — play the specified track
        if (data.filename) {
          var encodedSync = (data.filename || '').split('/').map(encodeURIComponent).join('/');
          play('/uploads/' + encodedSync, data.filename, data.loop, data.isVideo);
        }
        if (data.volume !== undefined) {
          setVolume(data.volume / 100);
        }
        break;
      case 'pong':
        // Heartbeat keepalive response
        break;

      case 'error':
        console.error('[StreamReceiver] Error:', data.message);
        break;
    }
  }

  // ── Send state updates to Controller ──────────────────
  function sendState() {
    if (!controllerConnected) return;
    var media = getActiveMedia();
    wsSend({
      type: 'state_update',
      playing: media ? !media.paused : false,
      currentTime: media ? (media.currentTime || 0) : 0,
      duration: media ? (media.duration || 0) : 0,
      track: currentTrack,
      volume: Math.round(currentVolume * 100),
      loop: currentLoop,
      maxLoop: maxLoop,
      ducked: isDucked,
      isVideo: isCurrentMediaVideo,
      streamMode: streamMode,
    });
  }

  // Send state every second
  setInterval(sendState, 1000);

  // Keepalive ping every 15s to keep WebSocket connection active
  setInterval(function () {
    if (isConnected && ws && ws.readyState === 1) {
      wsSend({ type: 'ping' });
    }
  }, 15000);

  // ── Helpers ───────────────────────────────────────────
  function formatTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    var m = (sec / 60) | 0;
    var s = (sec % 60) | 0;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateConnectionInfo(text) {
    var el = document.getElementById('connection-info');
    if (el) el.textContent = text;
  }

  // Clock
  function tickClock() {
    var el = document.getElementById('stream-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ── Auto-connect and Audio Unlock ─────────────────────
  var unlockOverlay = document.getElementById('unlock-overlay');
  var unlockBtn = document.getElementById('btn-unlock-audio');

  function unlockAudio() {
    ensureContext();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(function () {
        console.log('[StreamReceiver] AudioContext active, state:', audioCtx.state);
      }).catch(function (err) {
        console.warn('[StreamReceiver] AudioContext resume warning:', err);
      });
    }
    // Attempt gesture unlock on audio element
    try {
      var p = audioEl.play();
      if (p) {
        p.then(function () {
          if (!currentTrack) audioEl.pause();
        }).catch(function () {});
      }
    } catch (e) {}

    // Immediately disable pointer events and fade out
    if (unlockOverlay) {
      unlockOverlay.style.pointerEvents = 'none';
      unlockOverlay.classList.add('opacity-0');
      setTimeout(function () {
        unlockOverlay.classList.add('hidden');
        unlockOverlay.style.display = 'none';
      }, 300);
    }
  }

  // Expose globally
  window.unlockAudio = unlockAudio;
  window.StreamReceiver = {
    getVideoSrc: getVideoSrc,
    setReceiverResolution: setReceiverResolution,
    updateResolutionUI: updateResolutionUI,
    getResolution: function () { return currentResolution; },
    play: play,
    handleMessage: handleMessage
  };

  if (unlockBtn) {
    unlockBtn.addEventListener('click', unlockAudio);
  }
  if (unlockOverlay) {
    unlockOverlay.addEventListener('click', unlockAudio);
    unlockOverlay.addEventListener('touchstart', unlockAudio);
  }

  // Resume AudioContext on any interaction with the document
  function resumeOnInteraction() {
    ensureContext();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(function () {
        console.log('[StreamReceiver] AudioContext resumed via user interaction');
      });
    }
  }
  document.addEventListener('click', resumeOnInteraction);
  document.addEventListener('touchstart', resumeOnInteraction);
  document.addEventListener('keydown', resumeOnInteraction);

  // ── Browser Close / Unload Warning Detection ──────────
  window.addEventListener('beforeunload', function (e) {
    var msg = 'โปรแกรมนี้จำเป็นต้องใช้ในห้องประชาสัมพันธ์ และต้องทำงานตลอดเวลา คุณยืนยันที่จะปิดหรือไม่?';
    e.preventDefault();
    e.returnValue = msg;
    return msg;
  });

  // Start connection
  connect();
})();
