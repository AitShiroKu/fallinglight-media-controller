/**
 * Stream Receiver — Client-side logic for the streaming receiver page.
 *
 * Connects to the server via WebSocket, receives commands from the Controller,
 * and plays audio locally using HTML5 Audio + Web Audio API.
 * Sends state updates back to the Controller every second.
 */
(function () {
  'use strict';

  // ── Audio Engine (self-contained for receiver) ────────
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

  var audioCtx = null;
  var analyserL = null;
  var analyserR = null;
  var sourceNode = null;
  var splitter = null;
  var isCtxConnected = false;

  var currentVolume = 0.8;
  var isDucked = false;
  var preDuckVolume = 0.8;
  var currentTrack = null;
  var currentLoop = 0;
  var maxLoop = 1;

  var dataL = null;
  var dataR = null;
  var vuIntervalId = null;

  // ── WebSocket ─────────────────────────────────────────
  var ws = null;
  var reconnectTimer = null;
  var roomId = null;
  var isConnected = false;
  var controllerConnected = false;

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
      isCtxConnected = true;
    }
  }

  // ── Audio Playback ────────────────────────────────────
  function play(url, filename, loop) {
    ensureContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    currentTrack = filename || url;
    maxLoop = (loop !== undefined && loop !== null) ? loop : 1;
    currentLoop = 0;

    audioEl.src = url;
    audioEl.volume = isDucked ? Math.max(0, currentVolume * 0.15) : currentVolume;
    var p = audioEl.play();
    if (p) p.catch(function () {});
    connectSource();
    startVU();
    updateNowPlaying();
  }

  function pauseToggle() {
    if (audioEl.paused) {
      audioEl.play().catch(function () {});
      startVU();
    } else {
      audioEl.pause();
      stopVU();
    }
    updatePlayState();
  }

  function stop() {
    audioEl.pause();
    audioEl.currentTime = 0;
    stopVU();
    updatePlayState();
  }

  function setVolume(v) {
    currentVolume = Math.max(0, Math.min(1, v));
    if (!isDucked) {
      audioEl.volume = currentVolume;
    }
    updateVolumeUI();
  }

  function seekTo(ratio) {
    if (audioEl.duration && isFinite(audioEl.duration)) {
      audioEl.currentTime = ratio * audioEl.duration;
    }
  }

  function duckAudio(active) {
    var duckEl = document.getElementById('duck-indicator');
    if (active && !isDucked) {
      isDucked = true;
      preDuckVolume = audioEl.volume;
      audioEl.volume = Math.max(0, currentVolume * 0.15);
      if (duckEl) duckEl.classList.remove('hidden');
    } else if (!active && isDucked) {
      isDucked = false;
      audioEl.volume = currentVolume;
      if (duckEl) duckEl.classList.add('hidden');
    }
  }

  // ── Track ended → loop or notify ─────────────────────
  audioEl.addEventListener('ended', function () {
    currentLoop++;
    if (maxLoop === 0) {
      // Infinite loop
      audioEl.currentTime = 0;
      audioEl.play().catch(function () {});
    } else if (currentLoop < maxLoop) {
      audioEl.currentTime = 0;
      audioEl.play().catch(function () {});
    } else {
      // Track finished all loops
      stopVU();
      updatePlayState();
      sendState();
      // Notify controller that track ended
      wsSend({ type: 'track_ended' });
    }
    updateNowPlaying();
  });

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
      if (fileEl) fileEl.textContent = '📁 ' + currentTrack;

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
    if (stateEl) {
      if (audioEl.paused) {
        stateEl.textContent = '⏸ Paused';
        stateEl.className = 'text-sm text-muted font-bold mt-1';
      } else {
        stateEl.textContent = '▶ Playing';
        stateEl.className = 'text-sm text-accent font-bold mt-1';
      }
    }
  }

  function updateVolumeUI() {
    var bar = document.getElementById('stream-vol-bar');
    var label = document.getElementById('stream-vol-label');
    var icon = document.getElementById('stream-vol-icon');
    if (bar) bar.style.width = (currentVolume * 100) + '%';
    if (label) label.textContent = Math.round(currentVolume * 100) + '%';
    if (icon) {
      if (currentVolume === 0) icon.textContent = '🔇';
      else if (currentVolume < 0.5) icon.textContent = '🔉';
      else icon.textContent = '🔊';
    }
  }

  function updateProgress() {
    var bar = document.getElementById('stream-progress');
    var timeCurrent = document.getElementById('stream-time-current');
    var timeTotal = document.getElementById('stream-time-total');

    if (audioEl.duration && isFinite(audioEl.duration)) {
      var pct = (audioEl.currentTime / audioEl.duration) * 100;
      if (bar) bar.style.width = pct + '%';
      if (timeCurrent) timeCurrent.textContent = formatTime(audioEl.currentTime);
      if (timeTotal) timeTotal.textContent = formatTime(audioEl.duration);
    }
  }

  audioEl.addEventListener('timeupdate', updateProgress);
  audioEl.addEventListener('loadedmetadata', function () {
    var timeTotal = document.getElementById('stream-time-total');
    if (timeTotal) timeTotal.textContent = formatTime(audioEl.duration);
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
        if (icon) { icon.textContent = '📡'; icon.className = 'text-5xl mb-4 pulse-waiting'; }
        if (label) { label.textContent = 'กำลังรอการเชื่อมต่อจากรีโมท...'; label.className = 'text-xl font-bold text-yellow-400'; }
        if (sub) sub.textContent = 'เปิดหน้านี้ทิ้งไว้บนคอมพิวเตอร์ห้องโสตฯ';
        if (card) card.className = 'bg-dark-800 border border-dark-500 rounded-2xl p-8 mb-6 text-center glow-accent transition-all duration-500';
        if (npCard) npCard.classList.add('hidden');
        break;

      case 'connected':
        if (icon) { icon.textContent = '🟢'; icon.className = 'text-5xl mb-4 pulse-connected'; }
        if (label) { label.textContent = 'เชื่อมต่อกับรีโมทแล้ว!'; label.className = 'text-xl font-bold text-green-400'; }
        if (sub) sub.textContent = 'พร้อมรับคำสั่งจากมือถือ / แล็ปท็อป';
        if (card) card.className = 'bg-dark-800 border border-green-500/30 rounded-2xl p-8 mb-6 text-center transition-all duration-500';
        if (npCard) npCard.classList.remove('hidden');
        break;

      case 'disconnected':
        if (icon) { icon.textContent = '🔴'; icon.className = 'text-5xl mb-4'; }
        if (label) { label.textContent = 'ขาดการเชื่อมต่อ'; label.className = 'text-xl font-bold text-red-400'; }
        if (sub) sub.textContent = 'กำลังเชื่อมต่อใหม่...';
        if (card) card.className = 'bg-dark-800 border border-red-500/30 rounded-2xl p-8 mb-6 text-center transition-all duration-500';
        break;

      case 'no_room':
        if (icon) { icon.textContent = '⏳'; icon.className = 'text-5xl mb-4'; }
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
          play('/uploads/' + encodeURIComponent(data.filename), data.filename, data.loop);
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
          play('/uploads/' + encodeURIComponent(data.filename), data.filename, data.loop);
        }
        if (data.volume !== undefined) {
          setVolume(data.volume / 100);
        }
        break;

      case 'error':
        console.error('[StreamReceiver] Error:', data.message);
        break;
    }
  }

  // ── Send state updates to Controller ──────────────────
  function sendState() {
    if (!controllerConnected) return;
    wsSend({
      type: 'state_update',
      playing: !audioEl.paused,
      currentTime: audioEl.currentTime || 0,
      duration: audioEl.duration || 0,
      track: currentTrack,
      volume: Math.round(currentVolume * 100),
      loop: currentLoop,
      maxLoop: maxLoop,
      ducked: isDucked,
    });
  }

  // Send state every second
  setInterval(sendState, 1000);

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
