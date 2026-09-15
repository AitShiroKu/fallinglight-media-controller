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
    _allFolders: [],
    _currentFolder: '',
    _searchQuery: '',
    _movingFilePath: null,

    load: function (folder) {
      if (folder !== undefined) fileManager._currentFolder = folder || '';
      var url = '/api/files?folder=' + encodeURIComponent(fileManager._currentFolder);
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          fileManager._allFiles = data.files || [];
          fileManager._allFolders = data.folders || [];
          fileManager.renderBreadcrumbs();
          fileManager.renderFolders();
          fileManager.render();
        })
        .catch(function () { });
    },

    navigateTo: function (folder) {
      fileManager._currentFolder = folder || '';
      fileManager.load(fileManager._currentFolder);
    },

    search: function (query) {
      fileManager._searchQuery = (query || '').toLowerCase();
      fileManager.render();
      fileManager.renderFolders();
    },

    renderBreadcrumbs: function () {
      var container = document.getElementById('folder-breadcrumb');
      if (!container) return;
      var cur = fileManager._currentFolder;
      var html = '<span class="cursor-pointer hover:text-white ' + (!cur ? 'text-accent font-bold' : 'text-gray-300') + '" onclick="window.fileManager.navigateTo(\'\')">' + tr('folder_root') + '</span>';
      
      if (cur) {
        var parts = cur.split('/');
        var accumulated = '';
        for (var i = 0; i < parts.length; i++) {
          accumulated += (i > 0 ? '/' : '') + parts[i];
          var isLast = (i === parts.length - 1);
          html += '<span class="text-dark-500 mx-1">/</span>';
          if (isLast) {
            html += '<span class="text-accent font-bold">' + escHtml(parts[i]) + '</span>';
          } else {
            html += '<span class="cursor-pointer hover:text-white text-gray-300" onclick="window.fileManager.navigateTo(\'' + escAttr(accumulated) + '\')">' + escHtml(parts[i]) + '</span>';
          }
        }
      }
      container.innerHTML = html;
    },

    renderFolders: function () {
      var container = document.getElementById('folders-container');
      var countEl = document.getElementById('folders-count');
      if (!container) return;

      var cur = fileManager._currentFolder;
      var q = fileManager._searchQuery;

      var folders = fileManager._allFolders;
      if (q) {
        folders = folders.filter(function (f) {
          return f.name.toLowerCase().indexOf(q) !== -1 || f.path.toLowerCase().indexOf(q) !== -1;
        });
      } else {
        // Only show direct children of the current folder
        folders = folders.filter(function (f) {
          if (!cur) {
            return f.path.indexOf('/') === -1;
          } else {
            var prefix = cur + '/';
            return f.path.startsWith(prefix) && f.path.slice(prefix.length).indexOf('/') === -1;
          }
        });
      }

      if (countEl) countEl.textContent = folders.length + ' ' + (folders.length === 1 ? 'folder' : 'folders');

      if (folders.length === 0) {
        container.innerHTML = '<div class="text-xs text-muted py-1">' + tr('folder_empty') + '</div>';
        return;
      }

      var html = '';
      folders.forEach(function (f) {
        var folderIcon = window.Icons ? window.Icons.get('folder', { size: 16, className: 'text-yellow-400' }) : '';
        var playIcon = window.Icons ? window.Icons.get('play', { size: 12, className: 'text-green-400' }) : '';
        var trashIcon = window.Icons ? window.Icons.get('trash', { size: 12, className: 'text-accent' }) : '';
        html += '<div class="flex items-center gap-2 bg-dark-900/80 hover:bg-dark-700/80 border border-dark-500 rounded-xl px-3 py-2 transition text-xs group cursor-pointer" onclick="window.fileManager.navigateTo(\'' + escAttr(f.path) + '\')">';
        html += '<span class="shrink-0 flex items-center">' + folderIcon + '</span>';
        html += '<span class="font-medium text-gray-200 group-hover:text-accent transition">' + escHtml(f.name) + '</span>';
        html += '<span class="text-[10px] bg-dark-700 text-muted px-2 py-0.5 rounded-full font-mono">' + f.fileCount + '</span>';
        html += '<div class="flex items-center gap-1 ml-1 opacity-75 group-hover:opacity-100 transition">';
        html += '<button onclick="event.stopPropagation();window.playlist.addFolderTracks(\'' + escAttr(f.path) + '\')" class="touch-btn w-7 h-7 rounded-lg flex items-center justify-center hover:bg-green-500/20 transition" title="' + tr('btn_play_folder') + '">' + playIcon + '</button>';
        html += '<button onclick="event.stopPropagation();window.fileManager.deleteFolder(\'' + escAttr(f.path) + '\')" class="touch-btn w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/20 transition" title="Delete folder">' + trashIcon + '</button>';
        html += '</div>';
        html += '</div>';
      });
      container.innerHTML = html;
    },

    render: function () {
      var tbody = document.getElementById('files-body');
      if (!tbody) return;

      var files = fileManager._allFiles;
      var q = fileManager._searchQuery;

      if (q) {
        files = files.filter(function (f) {
          return f.name.toLowerCase().indexOf(q) !== -1 || (f.folder && f.folder.toLowerCase().indexOf(q) !== -1);
        });
      }

      if (files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-3 py-8 text-center text-muted text-xs">' + (q ? tr('no_search_results') : tr('no_files')) + '</td></tr>';
        return;
      }

      var html = '';
      files.forEach(function (f) {
        var filePath = f.path || f.name;
        var encodedUrl = '/uploads/' + (filePath.split('/').map(encodeURIComponent).join('/'));
        var isVideo = f.isVideo;
        var typeIcon = window.Icons ? window.Icons.get(isVideo ? 'video' : 'music', { size: 16, className: isVideo ? 'text-indigo-400' : 'text-accent' }) : '';
        var addIcon = window.Icons ? window.Icons.get('plus', { size: 14, className: 'text-green-400' }) : '+';
        var moveIcon = window.Icons ? window.Icons.get('move', { size: 14, className: 'text-cyan-400' }) : '';
        var downloadIcon = window.Icons ? window.Icons.get('download', { size: 14 }) : '';
        var trashIcon = window.Icons ? window.Icons.get('trash', { size: 14, className: 'text-accent' }) : '';

        html += '<tr class="hover:bg-dark-600/30 transition border-b border-dark-600/20">';
        html += '<td class="px-3 py-2.5"><div class="flex items-center gap-2">';
        html += '<span class="shrink-0 flex items-center">' + typeIcon + '</span>';
        html += '<span class="text-sm font-medium text-gray-200">' + escHtml(f.name) + '</span>';
        html += '</div></td>';
        html += '<td class="px-3 py-2.5 text-center text-xs text-muted font-mono">' + (f.folder ? escHtml(f.folder) : '-') + '</td>';
        html += '<td class="px-3 py-2.5 text-center text-xs text-muted">' + (f.sizeFormatted || '-') + '</td>';
        html += '<td class="px-3 py-2.5 text-center text-xs text-muted">' + (f.modifiedAt ? new Date(f.modifiedAt).toLocaleDateString() : '-') + '</td>';
        html += '<td class="px-3 py-2.5 text-center">';
        html += '<div class="flex items-center justify-center gap-1">';
        html += '<button onclick="window.playlist.addTrack(\'' + escAttr(filePath) + '\')" class="touch-btn w-8 h-8 rounded-lg bg-dark-600/70 hover:bg-dark-500 flex items-center justify-center transition" title="Add to playlist">' + addIcon + '</button>';
        html += '<button onclick="window.fileManager.openMoveModal(\'' + escAttr(filePath) + '\')" class="touch-btn w-8 h-8 rounded-lg bg-dark-600/70 hover:bg-dark-500 flex items-center justify-center transition" title="' + tr('btn_move_file') + '">' + moveIcon + '</button>';
        html += '<a href="' + encodedUrl + '" download class="touch-btn w-8 h-8 rounded-lg bg-dark-600/70 hover:bg-dark-500 text-gray-300 hover:text-white flex items-center justify-center transition" title="Download">' + downloadIcon + '</a>';
        html += '<button onclick="window.fileManager.remove(\'' + escAttr(filePath) + '\')" class="touch-btn w-8 h-8 rounded-lg bg-dark-600/70 hover:bg-red-500/20 flex items-center justify-center transition" title="Delete">' + trashIcon + '</button>';
        html += '</div>';
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
      formData.append('folder', fileManager._currentFolder || '');
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
            if (data.success) {
              if (textEl) {
                var checkSvg = window.Icons ? window.Icons.get('check', { size: 14, className: 'text-green-400 inline mr-1' }) : '';
                textEl.innerHTML = checkSvg + '<span>Upload complete!</span>';
              }
              if (percentEl) percentEl.textContent = '100%';
            } else {
              if (textEl) {
                var warnSvg = window.Icons ? window.Icons.get('warning', { size: 14, className: 'text-red-400 inline mr-1' }) : '';
                textEl.innerHTML = warnSvg + '<span>' + (data.error || 'Upload failed') + '</span>';
              }
              if (percentEl) percentEl.textContent = '';
            }
          } catch(e) {
            if (textEl) {
              var checkSvg = window.Icons ? window.Icons.get('check', { size: 14, className: 'text-green-400 inline mr-1' }) : '';
              textEl.innerHTML = checkSvg + '<span>Upload complete!</span>';
            }
          }
          fileManager.load();
        } else {
          if (textEl) {
            var warnSvg = window.Icons ? window.Icons.get('warning', { size: 14, className: 'text-red-400 inline mr-1' }) : '';
            textEl.innerHTML = warnSvg + '<span>Upload failed</span>';
          }
          if (barEl) barEl.style.backgroundColor = '#ef4444';
        }
        setTimeout(function () { 
          if(containerEl) containerEl.classList.add('hidden'); 
        }, 3000);
      };

      xhr.onerror = function() {
        if (textEl) {
          var warnSvg = window.Icons ? window.Icons.get('warning', { size: 14, className: 'text-red-400 inline mr-1' }) : '';
          textEl.innerHTML = warnSvg + '<span>Connection error</span>';
        }
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

    playCurrentFolder: function () {
      if (window.playlist && window.playlist.addFolderTracks) {
        window.playlist.addFolderTracks(fileManager._currentFolder);
      }
    },

    openCreateFolderModal: function () {
      var modal = document.getElementById('create-folder-modal');
      var input = document.getElementById('new-folder-name');
      if (input) input.value = '';
      if (modal) modal.classList.remove('hidden');
      if (input) setTimeout(function () { input.focus(); }, 100);
    },

    closeCreateFolderModal: function () {
      var modal = document.getElementById('create-folder-modal');
      if (modal) modal.classList.add('hidden');
    },

    submitCreateFolder: function () {
      var input = document.getElementById('new-folder-name');
      var name = (input ? input.value : '').trim();
      if (!name) return;

      fetch('/api/files/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, parent: fileManager._currentFolder || '' }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            fileManager.closeCreateFolderModal();
            fileManager.load();
          } else {
            alert(data.error || 'Failed to create folder');
          }
        })
        .catch(function () { alert('Error creating folder'); });
    },

    deleteFolder: function (folderPath) {
      if (!confirm(tr('confirm_delete_folder') + '\n' + folderPath)) return;
      fetch('/api/files/folder/' + encodeURIComponent(folderPath), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            if (fileManager._currentFolder === folderPath || fileManager._currentFolder.startsWith(folderPath + '/')) {
              fileManager._currentFolder = '';
            }
            fileManager.load();
          } else {
            alert(data.error || 'Failed to delete folder');
          }
        })
        .catch(function () { alert('Error deleting folder'); });
    },

    openMoveModal: function (filePath) {
      fileManager._movingFilePath = filePath;
      var modal = document.getElementById('move-file-modal');
      var label = document.getElementById('move-file-name-label');
      var select = document.getElementById('move-target-folder-select');

      if (label) label.textContent = 'File: ' + filePath;
      if (select) {
        var options = '<option value="">(Root) ' + tr('folder_root') + '</option>';
        (fileManager._allFolders || []).forEach(function (f) {
          options += '<option value="' + escAttr(f.path) + '">' + escHtml(f.path) + '</option>';
        });
        select.innerHTML = options;
      }

      if (modal) modal.classList.remove('hidden');
    },

    closeMoveModal: function () {
      fileManager._movingFilePath = null;
      var modal = document.getElementById('move-file-modal');
      if (modal) modal.classList.add('hidden');
    },

    submitMoveFile: function () {
      if (!fileManager._movingFilePath) return;
      var select = document.getElementById('move-target-folder-select');
      var target = select ? select.value : '';

      fetch('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fileManager._movingFilePath, targetFolder: target }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            fileManager.closeMoveModal();
            fileManager.load();
          } else {
            alert(data.error || 'Failed to move file');
          }
        })
        .catch(function () { alert('Error moving file'); });
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
    currentFormat: 'mp3',

    setFormat: function (fmt) {
      this.currentFormat = fmt === 'mp4' ? 'mp4' : 'mp3';
      var mp3Radio = document.getElementById('yt-format-mp3');
      var mp4Radio = document.getElementById('yt-format-mp4');
      var mp3Label = document.getElementById('yt-format-mp3-label');
      var mp4Label = document.getElementById('yt-format-mp4-label');

      if (mp3Radio) mp3Radio.checked = (this.currentFormat === 'mp3');
      if (mp4Radio) mp4Radio.checked = (this.currentFormat === 'mp4');

      if (mp3Label && mp4Label) {
        if (this.currentFormat === 'mp4') {
          mp3Label.classList.remove('bg-accent', 'text-white');
          mp3Label.classList.add('text-muted');
          mp4Label.classList.remove('text-muted');
          mp4Label.classList.add('bg-accent', 'text-white');
        } else {
          mp4Label.classList.remove('bg-accent', 'text-white');
          mp4Label.classList.add('text-muted');
          mp3Label.classList.remove('text-muted');
          mp3Label.classList.add('bg-accent', 'text-white');
        }
      }

      this.updateButtonText();
    },

    updateButtonText: function () {
      var format = this.currentFormat;
      var formatEl = document.querySelector('input[name="yt-format"]:checked');
      if (formatEl && formatEl.value) {
        format = formatEl.value;
        this.currentFormat = format;
      }
      var textEl = document.getElementById('btn-fetch-yt-text');
      if (textEl) {
        var btnKey = format === 'mp4' ? 'btn_fetch_youtube_mp4' : 'btn_fetch_youtube_mp3';
        textEl.setAttribute('data-i18n', btnKey);
        textEl.textContent = tr(btnKey);
      }
      var statusTextEl = document.getElementById('yt-status-text');
      var containerEl = document.getElementById('yt-progress-container');
      if (statusTextEl && containerEl && !containerEl.classList.contains('hidden')) {
        var loadingKey = format === 'mp4' ? 'youtube_loading_mp4' : 'youtube_loading';
        if (statusTextEl.classList.contains('text-accent')) {
          statusTextEl.textContent = tr(loadingKey);
        }
      }
    },

    fetch: function () {
      var urlInput = document.getElementById('yt-url');
      var containerEl = document.getElementById('yt-progress-container');
      var textEl = document.getElementById('yt-status-text');
      var percentEl = document.getElementById('yt-percent');
      var barEl = document.getElementById('yt-progress-bar');
      var statusEl = document.getElementById('yt-status');
      var url = urlInput.value.trim();
      if (!url) return;

      var formatEl = document.querySelector('input[name="yt-format"]:checked');
      var format = (formatEl && formatEl.value) ? formatEl.value : this.currentFormat;
      this.currentFormat = format;

      statusEl.classList.add('hidden');
      containerEl.classList.remove('hidden');
      textEl.className = 'text-xs text-accent';
      var loadingMsg = format === 'mp4' ? tr('youtube_loading_mp4') : tr('youtube_loading');
      textEl.textContent = loadingMsg;
      percentEl.textContent = '0%';
      barEl.style.width = '0%';
      barEl.style.backgroundColor = '';

      fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, format: format }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (res.ok && res.data.jobId) {
            youtubeDownloader.poll(res.data.jobId, urlInput, format);
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

    poll: function (jobId, urlInput, requestedFormat) {
      var containerEl = document.getElementById('yt-progress-container');
      var textEl = document.getElementById('yt-status-text');
      var percentEl = document.getElementById('yt-percent');
      var barEl = document.getElementById('yt-progress-bar');

      fetch('/api/youtube/progress/' + jobId)
        .then(function(r) { return r.json(); })
        .then(function(job) {
          if (job.status === 'downloading') {
            var activeFormat = job.format || requestedFormat || youtubeDownloader.currentFormat;
            var loadingMsg = activeFormat === 'mp4' ? tr('youtube_loading_mp4') : tr('youtube_loading');
            textEl.textContent = loadingMsg;
            percentEl.textContent = job.progress.toFixed(1) + '%';
            barEl.style.width = job.progress + '%';
            setTimeout(function() { youtubeDownloader.poll(jobId, urlInput, activeFormat); }, 1000);
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
    youtubeDownloader.updateButtonText();
    appAuth.check().then(function (authenticated) {
      if (authenticated) {
        showApp();
      } else {
        showLogin();
      }
    });
  });
})();
