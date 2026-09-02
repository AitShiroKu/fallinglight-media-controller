/**
 * Stream Controller — Client-side logic for the host/controller.
 *
 * When streaming mode is enabled, intercepts audio commands and
 * relays them via WebSocket to the Receiver(s) instead of playing locally.
 * Also receives state updates from the Receiver to update the Controller UI.
 */
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────
  var ws = null;
  var roomId = null;
  var isStreaming = false;
  var receiverCount = 0;
  var reconnectTimer = null;
  var sessionToken = null;

  // ── Enable/Disable Streaming ──────────────────────────
  function enableStreaming() {
    fetch('/api/streaming/enable', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          roomId = data.roomId;
          isStreaming = true;
          receiverCount = data.receiverCount || 0;

          // Get session token from cookie for WS auth
          sessionToken = getSessionCookie();

          connectWs();
          updateStreamingUI();

          // Enable remote mode on audio engine
          if (window.audioEngine && window.audioEngine.setRemoteMode) {
            window.audioEngine.setRemoteMode(true);
          }
        }
      })
      .catch(function (err) {
        console.error('[StreamController] Enable failed:', err);
        alert('Failed to enable streaming');
      });
  }

  function disableStreaming() {
    fetch('/api/streaming/disable', { method: 'POST' })
      .then(function () {
        cleanup();
      })
      .catch(function () {
        cleanup();
      });
  }

  function cleanup() {
    isStreaming = false;
    receiverCount = 0;
    roomId = null;
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Disable remote mode
    if (window.audioEngine && window.audioEngine.setRemoteMode) {
      window.audioEngine.setRemoteMode(false);
    }
    if (window.audioEngine && window.audioEngine.setRemoteState) {
      window.audioEngine.setRemoteState({ playing: false, track: null, duration: 0, currentTime: 0, volume: 80 });
    }

    updateStreamingUI();
  }

  function toggleStreaming() {
    if (isStreaming) {
      disableStreaming();
    } else {
      enableStreaming();
    }
  }

  // ── WebSocket Connection ──────────────────────────────
  function connectWs() {
    if (ws) {
      try { ws.close(); } catch (e) {}
    }

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = protocol + '//' + window.location.host + '/ws/streaming?role=controller&room=' + roomId;
    if (sessionToken) {
      url += '&token=' + encodeURIComponent(sessionToken);
    }

    ws = new WebSocket(url);

    ws.onopen = function () {
      updateStreamingUI();
    };

    ws.onmessage = function (event) {
      var data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      handleMessage(data);
    };

    ws.onclose = function () {
      if (isStreaming) {
        // Clear receiver count on connection loss so UI doesn't say "Connected"
        receiverCount = 0;
        updateStreamingUI();
        setStatus(window.appI18n ? window.appI18n.tr('streaming_waiting') : 'Waiting...');

        // Auto-reconnect
        reconnectTimer = setTimeout(function () {
          if (isStreaming && roomId) connectWs();
        }, 3000);
      }
    };

    ws.onerror = function () {
      // onclose handles reconnect
    };
  }

  function wsSend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ── Handle incoming messages from Receiver ────────────
  function handleMessage(data) {
    switch (data.type) {
      case 'connected':
        break;

      case 'peer_connected':
        if (data.role === 'receiver') {
          receiverCount = data.count || (receiverCount + 1);
          updateStreamingUI();
          setStatus('📡 Receiver connected (' + receiverCount + ')');
        }
        break;

      case 'peer_disconnected':
        if (data.role === 'receiver') {
          receiverCount = data.count !== undefined ? data.count : Math.max(0, receiverCount - 1);
          updateStreamingUI();
          setStatus('📡 Receiver disconnected (' + receiverCount + ' left)');
        }
        break;

      case 'room_closed':
        cleanup();
        break;

      case 'state_update':
        // Update Controller UI with Receiver's playback state
        updateReceiverState(data);
        break;

      case 'vu_update':
        if (Math.random() < 0.05) {
          console.log('[StreamController] Received VU levels from receiver:', data.l, data.r);
        }
        if (window.audioEngine && window.audioEngine.setRemoteVU) {
          window.audioEngine.setRemoteVU(data.l, data.r);
        }
        break;

      case 'track_ended':
        // Advance playlist on controller side
        if (window.playlist && window.playlist.onTrackEnded) {
          window.playlist.onTrackEnded();
        }
        break;

      case 'error':
        console.error('[StreamController] Error:', data.message);
        break;
    }
  }

  // ── Relay commands to Receiver(s) ─────────────────────
  // These are called by audio-engine.js when in remote mode

  function sendPlay(filename, loop) {
    wsSend({ type: 'play', filename: filename, loop: loop });
  }

  function sendPause() {
    wsSend({ type: 'pause' });
  }

  function sendStop() {
    wsSend({ type: 'stop' });
  }

  function sendVolume(level) {
    wsSend({ type: 'volume', level: Math.round(level) });
  }

  function sendSeek(ratio) {
    wsSend({ type: 'seek', ratio: ratio });
  }

  function sendDuck(active) {
    wsSend({ type: 'duck', active: active });
  }

  // ── Update Controller UI from Receiver state ──────────
  function updateReceiverState(state) {
    // Sync remote state with audio engine
    if (window.audioEngine && window.audioEngine.setRemoteState) {
      window.audioEngine.setRemoteState(state);
    }

    // Update progress bar
    if (state.duration > 0) {
      var seekBar = document.getElementById('seek-bar');
      if (seekBar) {
        seekBar.value = (state.currentTime / state.duration * 1000) | 0;
      }
      var timeCurrent = document.getElementById('time-current');
      if (timeCurrent) timeCurrent.textContent = formatTime(state.currentTime);
      var timeTotal = document.getElementById('time-total');
      if (timeTotal) timeTotal.textContent = formatTime(state.duration);
    }

    // Update play button
    var btnPlay = document.getElementById('btn-play');
    if (btnPlay) btnPlay.textContent = state.playing ? '⏸' : '▶';

    // Update volume display
    var volSlider = document.getElementById('vol-slider');
    var volLabel = document.getElementById('vol-label');
    if (volSlider && state.volume !== undefined) {
      volSlider.value = state.volume;
    }
    if (volLabel && state.volume !== undefined) {
      volLabel.textContent = state.volume + '%';
    }

    // Sync loop count to active playlist item if available
    if (window.playlist && state.loop !== undefined) {
      var currentItem = window.playlist.items[window.playlist.currentIndex];
      if (currentItem && currentItem.currentLoop !== state.loop) {
        currentItem.currentLoop = state.loop;
        window.playlist.render();
      }
    }
  }

  // ── Streaming UI ──────────────────────────────────────
  function updateStreamingUI() {
    var btn = document.getElementById('btn-streaming');
    var badge = document.getElementById('streaming-badge');
    var tr = window.appI18n ? window.appI18n.tr : function (k) { return k; };

    if (!btn) return;

    if (isStreaming) {
      btn.className = 'px-3 py-1.5 bg-accent border border-accent rounded-lg text-xs font-bold text-white hover:bg-accent-light transition';
      btn.innerHTML = '📡 ' + tr('streaming_disable');

      if (badge) {
        badge.classList.remove('hidden');
        if (receiverCount > 0) {
          badge.textContent = '🟢 ' + receiverCount + ' ' + tr('streaming_connected');
          badge.className = 'text-xs text-green-400 font-bold';
        } else {
          badge.textContent = '🟡 ' + tr('streaming_waiting');
          badge.className = 'text-xs text-yellow-400 font-bold pulse-waiting';
        }
      }
    } else {
      btn.className = 'px-3 py-1.5 bg-dark-600 border border-dark-500 rounded-lg text-xs hover:border-accent hover:text-accent transition';
      btn.innerHTML = '📡 ' + tr('streaming_enable');

      if (badge) {
        badge.classList.add('hidden');
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────
  function getSessionCookie() {
    var match = document.cookie.match(/(^|;\s*)session=([^;]+)/);
    return match ? decodeURIComponent(match[2]) : '';
  }

  function setStatus(text) {
    var el = document.getElementById('status-text');
    if (el) el.textContent = text;
  }

  function formatTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    var m = (sec / 60) | 0;
    var s = (sec % 60) | 0;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ── Public API ────────────────────────────────────────
  window.streamController = {
    toggle: toggleStreaming,
    enable: enableStreaming,
    disable: disableStreaming,
    sendPlay: sendPlay,
    sendPause: sendPause,
    sendStop: sendStop,
    sendVolume: sendVolume,
    sendSeek: sendSeek,
    sendDuck: sendDuck,
    get isStreaming() { return isStreaming; },
    get receiverCount() { return receiverCount; },
  };
})();
