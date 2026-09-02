/**
 * App Controller — Main application initialization, auth, tabs, file manager.
 */
(function () {
  'use strict';

  // ── Auth ──────────────────────────────────────────────
  var appAuth = {
    login: function () {
      var user = document.getElementById('login-user').value;
      var pass = document.getElementById('login-pass').value;
      var errEl = document.getElementById('login-error');

      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (res.ok && res.data.success) {
            showApp();
          } else {
            errEl.textContent = res.data.message || 'Login failed';
            errEl.classList.remove('hidden');
          }
        })
        .catch(function () {
          errEl.textContent = 'Connection error';
          errEl.classList.remove('hidden');
        });
    },

    logout: function () {
      showExitWarningModal(function () {
        fetch('/api/auth/logout', { method: 'POST' })
          .then(function () { showLogin(); })
          .catch(function () { showLogin(); });
      });
    },

    check: function () {
      return fetch('/api/auth/check')
        .then(function (r) { return r.json(); })
        .then(function (d) { return d.authenticated; })
        .catch(function () { return false; });
    },
  };

  function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    // Load data
    if (window.schedulerUI) window.schedulerUI.load();
    fileManager.load();
    loadSettings();
    startClock();
  }

  // ── Login Form ────────────────────────────────────────
  document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    appAuth.login();
  });

  // ── Tabs ──────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var tab = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.add('hidden'); });
      document.getElementById('tab-' + tab).classList.remove('hidden');
    });
  });

  // ── File Manager ──────────────────────────────────────
  var fileManager = {
    _allFiles: [],
    _searchQuery: '',

    load: function () {
      fetch('/api/files')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          fileManager._allFiles = data.files || [];
          fileManager.render();
        })
        .catch(function () { });
    },

    search: function (query) {
      fileManager._searchQuery = (query || '').toLowerCase();
      fileManager.render();
    },

    render: function () {
      var tbody = document.getElementById('files-body');
      if (!tbody) return;

      var files = fileManager._allFiles;
      var q = fileManager._searchQuery;

      if (q) {
        files = files.filter(function (f) {
          return f.name.toLowerCase().indexOf(q) !== -1;
        });
      }

      if (files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-8 text-center text-muted text-xs">' + (q ? tr('no_search_results') : tr('no_files')) + '</td></tr>';
        return;
      }

      var html = '';
      files.forEach(function (f) {
        html += '<tr class="hover:bg-dark-600/30">';
        html += '<td class="px-3 py-2"><span class="text-sm">' + escHtml(f.name) + '</span></td>';
        html += '<td class="px-3 py-2 text-center text-xs text-muted">' + f.sizeFormatted + '</td>';
        html += '<td class="px-3 py-2 text-center text-xs text-muted">' + new Date(f.modifiedAt).toLocaleDateString() + '</td>';
        html += '<td class="px-3 py-2 text-center space-x-1">';
        html += '<button onclick="window.playlist.addTrack(\'' + escAttr(f.name) + '\')" class="px-2 py-1 bg-dark-600 rounded text-xs hover:bg-dark-500 transition" title="Add to playlist">🎵</button>';
        html += '<a href="/uploads/' + encodeURIComponent(f.name) + '" download class="px-2 py-1 bg-dark-600 rounded text-xs hover:bg-dark-500 transition inline-block" title="Download">⬇</a>';
        html += '<button onclick="window.fileManager.remove(\'' + escAttr(f.name) + '\')" class="px-2 py-1 bg-dark-600 rounded text-xs hover:text-accent transition" title="Delete">🗑</button>';
        html += '</td>';
        html += '</tr>';
      });
      tbody.innerHTML = html;
    },

    upload: function (fileList) {
      if (!fileList || fileList.length === 0) return;
      var containerEl = document.getElementById('upload-progress-container');
      var textEl = document.getElementById('upload-status-text');
      var percentEl = document.getElementById('upload-percent');
      var barEl = document.getElementById('upload-progress-bar');
      
      if(containerEl) containerEl.classList.remove('hidden');
      if(textEl) textEl.textContent = 'Uploading ' + fileList.length + ' file(s)...';
      if(percentEl) percentEl.textContent = '0%';
      if(barEl) {
        barEl.style.width = '0%';
        barEl.style.backgroundColor = '';
      }

      var formData = new FormData();
      for (var i = 0; i < fileList.length; i++) {
        formData.append('file', fileList[i]);
      }

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload', true);
      
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          var percentComplete = Math.round((e.loaded / e.total) * 100);
          if(percentEl) percentEl.textContent = percentComplete + '%';
          if(barEl) barEl.style.width = percentComplete + '%';
        }
      };

      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            if(textEl) textEl.textContent = data.success ? '✅ Upload complete!' : '❌ ' + (data.error || 'Upload failed');
            if(percentEl) percentEl.textContent = data.success ? '100%' : '';
          } catch(e) {
            if(textEl) textEl.textContent = '✅ Upload complete!';
          }
          fileManager.load();
        } else {
          if(textEl) textEl.textContent = '❌ Upload failed';
          if(barEl) barEl.style.backgroundColor = '#ef4444'; // red
        }
        setTimeout(function () { 
          if(containerEl) containerEl.classList.add('hidden'); 
        }, 3000);
      };

      xhr.onerror = function() {
        if(textEl) textEl.textContent = '❌ Connection error';
        if(barEl) barEl.style.backgroundColor = '#ef4444';
        setTimeout(function () { 
          if(containerEl) containerEl.classList.add('hidden'); 
        }, 3000);
      };

      xhr.send(formData);
    },

    remove: function (filename) {
      if (!confirm(tr('confirm_delete') + '\n' + filename)) return;
      fetch('/api/files/' + encodeURIComponent(filename), { method: 'DELETE' })
        .then(function () { fileManager.load(); })
        .catch(function () { alert('Failed to delete'); });
    },
  };

  // ── Drag & Drop Upload ────────────────────────────────
  var dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      fileManager.upload(e.dataTransfer.files);
    });
  }

  // ── Clock ─────────────────────────────────────────────
  function startClock() {
    function tick() {
      var el = document.getElementById('clock');
      if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── Helpers ───────────────────────────────────────────
  function tr(key) { return window.appI18n ? window.appI18n.tr(key) : key; }
  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function escAttr(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

  // ── Settings Manager ──────────────────────────────────
  function loadSettings() {
    fetch('/api/settings')
      .then(function (r) { return r.json(); })
      .then(function (settings) {
        window.appSettings = settings;
        document.getElementById('set-vol').value = Math.round(settings.defaultVolume * 100);
        document.getElementById('set-vol-label').textContent = Math.round(settings.defaultVolume * 100) + '%';
        document.getElementById('set-fade').value = settings.fadeDuration;
        document.getElementById('set-duck-vol').value = Math.round(settings.duckVolume * 100);
        document.getElementById('set-duck-dur').value = settings.duckDuration;
        document.getElementById('set-yt-quality').value = settings.ytQuality;
        document.getElementById('set-auto').checked = settings.autoAdvance;
        var warnCloseEl = document.getElementById('set-warn-close');
        if (warnCloseEl) warnCloseEl.checked = settings.warnOnClose !== false;

        if (window.audioEngine) {
          window.audioEngine.setVolume(settings.defaultVolume);
          window.audioEngine.setFadeDuration(settings.fadeDuration);
          window.audioEngine.setDuckVolume(settings.duckVolume);
          window.audioEngine.setDuckDuration(settings.duckDuration);
        }
        if (window.playlist) {
          window.playlist.setAutoAdvance(settings.autoAdvance);
        }
      })
      .catch(function () { console.error('Failed to load settings'); });
  }

  var settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var defaultVolume = parseFloat(document.getElementById('set-vol').value) / 100;
      var fadeDuration = parseFloat(document.getElementById('set-fade').value) || 1.5;
      var duckVolume = parseFloat(document.getElementById('set-duck-vol').value) / 100;
      var duckDuration = parseInt(document.getElementById('set-duck-dur').value, 10) || 300;
      var ytQuality = document.getElementById('set-yt-quality').value;
      var autoAdvance = document.getElementById('set-auto').checked;
      var warnOnClose = document.getElementById('set-warn-close') ? document.getElementById('set-warn-close').checked : true;

      var body = {
        defaultVolume: defaultVolume,
        fadeDuration: fadeDuration,
        duckVolume: duckVolume,
        duckDuration: duckDuration,
        autoAdvance: autoAdvance,
        ytQuality: ytQuality,
        warnOnClose: warnOnClose
      };

      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            alert(tr('settings_saved'));
            loadSettings();
          } else {
            alert('Failed to save settings');
          }
        })
        .catch(function () { alert('Failed to save settings'); });
    });
  }

  // ── Browser Close / Unload Warning Detection ──────────
  window.addEventListener('beforeunload', function (e) {
    if (window.appSettings && window.appSettings.warnOnClose === false) return;
    var msg = tr('confirm_close_page');
    e.preventDefault();
    e.returnValue = msg;
    return msg;
  });

  // ── Custom Exit Warning Modal Helper ──────────────────
  var exitModalCallback = null;

  function showExitWarningModal(onConfirm) {
    exitModalCallback = onConfirm || null;
    var modal = document.getElementById('exit-warning-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function hideExitWarningModal() {
    exitModalCallback = null;
    var modal = document.getElementById('exit-warning-modal');
    if (modal) modal.classList.add('hidden');
  }

  var btnCancelExit = document.getElementById('btn-cancel-exit');
  if (btnCancelExit) {
    btnCancelExit.addEventListener('click', hideExitWarningModal);
  }

  var btnConfirmExit = document.getElementById('btn-confirm-exit');
  if (btnConfirmExit) {
    btnConfirmExit.addEventListener('click', function () {
      var cb = exitModalCallback;
      hideExitWarningModal();
      if (cb) cb();
    });
  }

  // ── Exit-Intent Detection (Cursor moving towards browser tab/close) ──────────
  var exitIntentTriggered = false;
  document.addEventListener('mouseleave', function (e) {
    if (e.clientY <= 10 && !exitIntentTriggered) {
      if (window.appSettings && window.appSettings.warnOnClose === false) return;
      var appScreen = document.getElementById('app-screen');
      if (appScreen && !appScreen.classList.contains('hidden')) {
        exitIntentTriggered = true;
        showExitWarningModal(null);
        setTimeout(function () { exitIntentTriggered = false; }, 15000);
      }
    }
  });

  // ── YouTube Downloader ────────────────────────────────
  var youtubeDownloader = {
    fetch: function () {
      var urlInput = document.getElementById('yt-url');
      var containerEl = document.getElementById('yt-progress-container');
      var textEl = document.getElementById('yt-status-text');
      var percentEl = document.getElementById('yt-percent');
      var barEl = document.getElementById('yt-progress-bar');
      var statusEl = document.getElementById('yt-status');
      var url = urlInput.value.trim();
      if (!url) return;

      statusEl.classList.add('hidden');
      containerEl.classList.remove('hidden');
      textEl.className = 'text-xs text-accent';
      textEl.textContent = tr('youtube_loading');
      percentEl.textContent = '0%';
      barEl.style.width = '0%';
      barEl.style.backgroundColor = '';

      fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (res.ok && res.data.jobId) {
            youtubeDownloader.poll(res.data.jobId, urlInput);
          } else {
            textEl.textContent = res.data.error || tr('youtube_error');
            barEl.style.backgroundColor = '#ef4444';
          }
        })
        .catch(function () {
          textEl.textContent = tr('youtube_error');
          barEl.style.backgroundColor = '#ef4444';
        });
    },

    poll: function (jobId, urlInput) {
      var containerEl = document.getElementById('yt-progress-container');
      var textEl = document.getElementById('yt-status-text');
      var percentEl = document.getElementById('yt-percent');
      var barEl = document.getElementById('yt-progress-bar');

      fetch('/api/youtube/progress/' + jobId)
        .then(function(r) { return r.json(); })
        .then(function(job) {
          if (job.status === 'downloading') {
            percentEl.textContent = job.progress.toFixed(1) + '%';
            barEl.style.width = job.progress + '%';
            setTimeout(function() { youtubeDownloader.poll(jobId, urlInput); }, 1000);
          } else if (job.status === 'success') {
            percentEl.textContent = '100%';
            barEl.style.width = '100%';
            textEl.className = 'text-xs text-green-400';
            textEl.textContent = tr('youtube_success') + ' (' + job.filename + ')';
            urlInput.value = '';
            if (window.fileManager) window.fileManager.load();
            setTimeout(function () { containerEl.classList.add('hidden'); }, 5000);
          } else if (job.status === 'error') {
            textEl.textContent = job.error || tr('youtube_error');
            barEl.style.backgroundColor = '#ef4444';
          }
        })
        .catch(function() {
          textEl.textContent = 'Lost connection to download status';
          barEl.style.backgroundColor = '#ef4444';
        });
    }
  };

  // ── Init ──────────────────────────────────────────────
  window.appAuth = appAuth;
  window.fileManager = fileManager;
  window.youtubeDownloader = youtubeDownloader;

  // On page load — check session and init i18n
  window.appI18n.init().then(function () {
    appAuth.check().then(function (authenticated) {
      if (authenticated) {
        showApp();
      } else {
        showLogin();
      }
    });
  });
})();
