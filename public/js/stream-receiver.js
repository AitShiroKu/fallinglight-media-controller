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
  function initVideoEl() {
    videoEl = document.getElementById('receiver-video');
    videoContainer = document.getElementById('video-container');
    if (videoEl) {
      videoEl.crossOrigin = 'anonymous';
      videoEl.preload = 'auto';
      videoEl.addEventListener('timeupdate', updateProgress);
      videoEl.addEventListener('loadedmetadata', function () {
        var timeTotal = document.getElementById('stream-time-total');
        if (timeTotal && isFinite(videoEl.duration)) timeTotal.textContent = formatTime(videoEl.duration);
      });
      videoEl.addEventListener('play', updatePlayState);
      videoEl.addEventListener('pause', updatePlayState);
      videoEl.addEventListener('ended', onMediaEnded);
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
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVideoEl);
  } else {
    initVideoEl();
  }

  var audioCtx = null;
  var analyserL = null;
  var analyserR = null;
  var sourceNode = null;
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
    if (!targetEl || connectedElement === targetEl) return;
    ensureContext();
    try {
      sourceNode = audioCtx.createMediaElementSource(targetEl);
      sourceNode.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      sourceNode.connect(audioCtx.destination);
      connectedElement = targetEl;
    } catch (e) {
      connectedElement = targetEl;
    }
  }

  // ── Playback ──────────────────────────────────────────
  function play(url, filename, loop) {
    ensureContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    currentTrack = filename || url;
    maxLoop = (loop !== undefined && loop !== null) ? loop : 1;
    currentLoop = 0;
    isCurrentMediaVideo = isVideoPath(currentTrack);

    var mediaIcon = document.getElementById('stream-media-icon');
    if (mediaIcon && window.Icons) {
      mediaIcon.innerHTML = window.Icons.get(isCurrentMediaVideo ? 'video' : 'music', { size: 24, className: isCurrentMediaVideo ? 'text-indigo-400' : 'text-accent' });
    }

    if (isCurrentMediaVideo) {
      if (streamMode === 'audio') {
        // Audio-only mode: hide video, play audio
        if (videoContainer) videoContainer.classList.add('hidden');
        if (videoEl) { videoEl.pause(); videoEl.src = ''; }

        audioEl.src = url;
        audioEl.muted = false;
        audioEl.volume = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
        var pa = audioEl.play();
        if (pa) pa.catch(function () {});
        connectSource(audioEl);
        startVU();

      } else if (streamMode === 'video') {
        // Video-only mode: show video, mute audio
        if (audioEl) { audioEl.pause(); audioEl.src = ''; }
        if (videoContainer) videoContainer.classList.remove('hidden');

        if (videoEl) {
          videoEl.src = url;
          videoEl.muted = true;
          videoEl.volume = 0;
          var pv = videoEl.play();
          if (pv) pv.catch(function () {});
        }
        stopVU();

      } else {
        // Default: Both Video and Audio
        if (audioEl) { audioEl.pause(); audioEl.src = ''; }
        if (videoContainer) videoContainer.classList.remove('hidden');

        if (videoEl) {
          videoEl.src = url;
          videoEl.muted = false;
          videoEl.volume = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
          var pb = videoEl.play();
          if (pb) pb.catch(function () {});
          connectSource(videoEl);
        }
        startVU();
      }
    } else {
      // Audio-only track
      if (videoContainer) videoContainer.classList.add('hidden');
      if (videoEl) { videoEl.pause(); videoEl.src = ''; }

      audioEl.src = url;
      if (streamMode === 'video') {
        audioEl.muted = true;
        stopVU();
      } else {
        audioEl.muted = false;
        audioEl.volume = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
        connectSource(audioEl);
        startVU();
      }
      var p = audioEl.play();
      if (p) p.catch(function () {});
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
    updatePlayState();
  }

  function setVolume(v) {
    currentVolume = Math.max(0, Math.min(1, v));
    var vol = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
    if (audioEl && streamMode !== 'video') audioEl.volume = vol;
    if (videoEl && streamMode === 'both') videoEl.volume = vol;
    updateVolumeUI();
  }

  function seekTo(ratio) {
    var media = getActiveMedia();
    if (media && media.duration && isFinite(media.duration)) {
      media.currentTime = ratio * media.duration;
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
    var media = getActiveMedia();

    if (media && media.duration && isFinite(media.duration)) {
      var pct = (media.currentTime / media.duration) * 100;
      if (bar) bar.style.width = pct + '%';
      if (timeCurrent) timeCurrent.textContent = formatTime(media.currentTime);
      if (timeTotal) timeTotal.textContent = formatTime(media.duration);
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

      case 'no_room':
        if (icon) {
          icon.className = 'text-4xl mb-3 flex items-center justify-center text-muted';
          icon.innerHTML = window.Icons ? window.Icons.get('clock', { size: 48, className: 'text-muted' }) : '';
        }
        if (label) { label.textContent = 'ยังไม่มี Streaming Room'; label.className = 'text-xl font-bold text-muted'; }
        if (sub) sub.textContent = 'กรุณาเปิด Streaming จากหน้า Controller ก่อน';
        if (card) card.className = 'bg-dark-800 border border-dark-500 rounded-2xl p-8 mb-6 text-center transition-all duration-500';
        if (npCard) npCard.classList.add('hidden');
        break;
    }
  }

  // ── WebSocket Connection ──────────────────────────────
  function connect() {
    // First, check if there's an active room
    fetch('/api/streaming/status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.active) {
          setConnectionStatus('no_room');
          updateConnectionInfo('ไม่มี Room — จะลองอีกใน 5 วินาที');
          scheduleReconnect(5000);
          return;
        }
        roomId = data.roomId;
        connectWs();
      })
      .catch(function () {
        setConnectionStatus('disconnected');
        updateConnectionInfo('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์');
        scheduleReconnect(5000);
      });
  }

  function connectWs() {
    if (ws) {
      try { ws.close(); } catch (e) {}
    }

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = protocol + '//' + window.location.host + '/ws/streaming?role=receiver&room=' + roomId;

    ws = new WebSocket(url);

    ws.onopen = function () {
      isConnected = true;
      updateConnectionInfo('WebSocket: เชื่อมต่อแล้ว');
      setConnectionStatus('waiting');
    };

    ws.onmessage = function (event) {
      var data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      handleMessage(data);
    };

    ws.onclose = function () {
      isConnected = false;
      controllerConnected = false;
      updateConnectionInfo('WebSocket: ตัดการเชื่อมต่อ');
      setConnectionStatus('disconnected');
      scheduleReconnect(3000);
    };

    ws.onerror = function () {
      // onclose will fire after
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
        updateConnectionInfo('WebSocket: เชื่อมต่อแล้ว (role: receiver)');
        break;

      case 'peer_connected':
        if (data.role === 'controller') {
          controllerConnected = true;
          setConnectionStatus('connected');
          sendState(); // Send state immediately to sync UI!
        }
        break;

      case 'peer_disconnected':
        if (data.role === 'controller') {
          controllerConnected = false;
          setConnectionStatus('waiting');
        }
        break;

      case 'room_closed':
        controllerConnected = false;
        stop();
        setConnectionStatus('no_room');
        scheduleReconnect(5000);
        break;

      case 'play':
        if (data.filename) {
          var encodedFile = (data.filename || '').split('/').map(encodeURIComponent).join('/');
          play('/uploads/' + encodedFile, data.filename, data.loop);
        }
        break;

      case 'pause':
        pauseToggle();
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
        if (data.ratio !== undefined) {
          seekTo(data.ratio);
        }
        break;

      case 'duck':
        duckAudio(!!data.active);
        break;

      case 'playlist_sync':
        // Receive full playlist — play the specified track
        if (data.filename) {
          var encodedSync = (data.filename || '').split('/').map(encodeURIComponent).join('/');
          play('/uploads/' + encodedSync, data.filename, data.loop);
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

    // Always hide overlay on click so the UI is never stuck
    if (unlockOverlay) {
      unlockOverlay.classList.add('opacity-0');
      setTimeout(function () {
        unlockOverlay.classList.add('hidden');
      }, 500);
    }
  }

  if (unlockBtn) {
    unlockBtn.addEventListener('click', unlockAudio);
  }
  // Fallback: clicking the backdrop also works
  if (unlockOverlay) {
    unlockOverlay.addEventListener('click', function (e) {
      if (e.target === unlockOverlay) {
        unlockAudio();
      }
    });
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
