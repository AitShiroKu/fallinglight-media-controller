/**
 * Playlist Manager — Client-side playlist with loop control.
 * 
 * Manages track queue, loop counts, auto-advance, and renders
 * the playlist table in the UI. Tracks reference files from /uploads/.
 */
(function () {
  'use strict';

  let items = [];       // { filename, title, loop, currentLoop, pinned }
  let currentIndex = -1;
  let configAutoAdvance = true;
  let draggedIdx = -1;

  // ── Public API ────────────────────────────────────────

  function isVideoPath(name) {
    return /\.(mp4|webm|mkv|avi)$/i.test(name || '');
  }

  function addTrack(filename, loop, autoNext) {
    loop = loop !== undefined ? loop : 1;
    autoNext = autoNext !== undefined ? autoNext : true;
    var title = filename.replace(/\.[^/.]+$/, '');
    var isVideo = isVideoPath(filename);
    items.push({
      filename: filename,
      title: title,
      loop: loop,
      currentLoop: 0,
      pinned: false,
      autoNext: autoNext,
      isVideo: isVideo
    });
    if (currentIndex === -1) currentIndex = 0;
    render();
  }

  function toggleAutoNext(index) {
    if (index >= 0 && index < items.length) {
      items[index].autoNext = (items[index].autoNext === false) ? true : false;
      render();
    }
  }

  function removeTrack(index) {
    var wasPlayingThis = (index === currentIndex);
    items.splice(index, 1);
    if (items.length === 0) {
      currentIndex = -1;
      if (wasPlayingThis) {
        window.audioEngine.stop();
        updateTrackInfo(null);
      }
    } else if (index < currentIndex) {
      currentIndex--;
    } else if (index === currentIndex) {
      currentIndex = Math.min(currentIndex, items.length - 1);
      if (wasPlayingThis) {
        window.audioEngine.stop();
        updateTrackInfo(items[currentIndex] || null);
      }
    }
    render();
  }

  function clearAll() {
    items = [];
    currentIndex = -1;
    window.audioEngine.stop();
    updateTrackInfo(null);
    render();
  }

  function moveTrack(from, to) {
    if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
    var fromItem = items[from];
    var toItem = items[to];
    // Prevent dragging across pinned/unpinned boundaries
    if (fromItem.pinned !== toItem.pinned) return;

    var item = items.splice(from, 1)[0];
    items.splice(to, 0, item);
    if (currentIndex === from) currentIndex = to;
    else if (from < currentIndex && to >= currentIndex) currentIndex--;
    else if (from > currentIndex && to <= currentIndex) currentIndex++;
    render();
  }

  function togglePin(index) {
    if (index < 0 || index >= items.length) return;
    var track = items[index];
    track.pinned = !track.pinned;

    var targetIdx;
    if (track.pinned) {
      // Find the index right after the last pinned item
      var pinnedCountBefore = 0;
      for (var i = 0; i < items.length; i++) {
        if (items[i].pinned && i !== index) {
          pinnedCountBefore++;
        }
      }
      targetIdx = pinnedCountBefore;
    } else {
      // Find the index right after the remaining pinned items
      var pinnedCount = 0;
      for (var i = 0; i < items.length; i++) {
        if (items[i].pinned) {
          pinnedCount++;
        }
      }
      targetIdx = pinnedCount;
    }

    var item = items.splice(index, 1)[0];
    items.splice(targetIdx, 0, item);

    // Adjust currentIndex as well
    if (currentIndex === index) {
      currentIndex = targetIdx;
    } else if (index < currentIndex && targetIdx >= currentIndex) {
      currentIndex--;
    } else if (index > currentIndex && targetIdx <= currentIndex) {
      currentIndex++;
    }

    render();
  }

  function setLoop(index, count) {
    if (index >= 0 && index < items.length) {
      items[index].loop = Math.max(0, count);
      render();
    }
  }

  function playIndex(index, isLooping) {
    if (index < 0 || index >= items.length) return;
    currentIndex = index;
    if (!isLooping) {
      items[index].currentLoop = 0;
    }
    var track = items[index];

    // In remote mode, send play with loop info directly
    if (window.audioEngine.remoteMode && window.streamController) {
      window.streamController.sendPlay(track.filename, track.loop);
      updateTrackInfo(track);
      render();
      return;
    }

    var encodedPath = (track.filename || '').split('/').map(encodeURIComponent).join('/');
    window.audioEngine.play('/uploads/' + encodedPath);
    updateTrackInfo(track);
    render();
  }

  function togglePlay() {
    if (window.audioEngine.isPlaying) {
      window.audioEngine.pause();
    } else if (items.length > 0) {
      if (currentIndex === -1) currentIndex = 0;
      var track = items[currentIndex];
      var hasLoadedTrack = window.audioEngine.remoteMode
        ? !!window.audioEngine.remoteTrack
        : !!window.audioEngine.audioEl.src;

      if (hasLoadedTrack && window.audioEngine.isPaused) {
        window.audioEngine.pause(); // Resume
      } else {
        playIndex(currentIndex);
      }
    }
  }

  function next() {
    if (items.length === 0) return;
    window.audioEngine.stopWithFade(500);
    setTimeout(function () { advance(true); }, 550);
  }

  function previous() {
    if (items.length === 0) return;
    var prev = Math.max(0, currentIndex - 1);
    playIndex(prev);
  }

  function onTrackEnded() {
    // In remote mode, the receiver already played all loops and notified us on completion
    if (window.audioEngine && window.audioEngine.remoteMode) {
      advance(true);
    } else {
      advance(false);
    }
  }

  function advance(skip) {
    if (items.length === 0) return;
    var track = items[currentIndex];
    if (!track) return;

    if (!skip) {
      track.currentLoop++;
      // Check loop
      if (track.loop === 0) {
        // Infinite loop
        playIndex(currentIndex, true);
        return;
      } else if (track.currentLoop < track.loop) {
        playIndex(currentIndex, true);
        return;
      }

      // Check per-media autoNext setting! (เลือกว่าเมื่อจบสื่อนี้แล้วจะเล่นสื่ออื่นต่อไหม)
      if (track.autoNext === false) {
        track.currentLoop = 0;
        window.audioEngine.stop();
        setStatus(tr('status_track_ended_stopped') || 'เล่นสื่อจบแล้ว (หยุดตามที่ตั้งค่าไว้)');
        render();
        return;
      }
    }

    // Advance to next
    track.currentLoop = 0;

    if (!configAutoAdvance && !skip) {
      currentIndex = -1;
      updateTrackInfo(null);
      render();
      return;
    }

    var nextIdx = currentIndex + 1;
    if (nextIdx >= items.length) {
      // End of playlist
      currentIndex = -1;
      updateTrackInfo(null);
      setStatus(tr('status_playlist_ended'));
      render();
      return;
    }
    playIndex(nextIdx);
  }

  // ── Add from server files ─────────────────────────────
  function addFromFiles() {
    // Fetch file list and show a quick picker
    fetch('/api/files')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.files || data.files.length === 0) {
          alert(tr('no_files'));
          return;
        }
        showFilePicker(data.files);
      })
      .catch(function () { alert('Failed to load file list'); });
  }

  function showFilePicker(files) {
    var modal = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');

    var html = '<h3 class="text-lg font-bold text-accent mb-4">' + tr('dialog_add_files') + '</h3>';
    html += '<div class="space-y-1 max-h-60 overflow-y-auto mb-4">';
    files.forEach(function (f) {
      var filePath = f.path || f.name;
      var isVid = f.isVideo || /\.(mp4|webm|mkv|avi)$/i.test(filePath);
      var icon = window.Icons ? window.Icons.get(isVid ? 'video' : 'music', { size: 16, className: isVid ? 'text-indigo-400' : 'text-accent' }) : '';
      html += '<label class="flex items-center gap-3 p-2 hover:bg-dark-600 rounded-lg cursor-pointer">';
      html += '<input type="checkbox" value="' + escHtml(filePath) + '" class="file-pick-cb accent-accent">';
      html += '<span class="shrink-0 flex items-center">' + icon + '</span>';
      html += '<span class="flex-1 text-sm truncate">' + escHtml(filePath) + '</span>';
      html += '<span class="text-xs text-muted font-mono">' + f.sizeFormatted + '</span>';
      html += '</label>';
    });
    html += '</div>';
    html += '<div class="flex items-center justify-between gap-3 mb-4 flex-wrap">';
    html += '<div class="flex items-center gap-2">';
    html += '<label class="text-sm text-muted">' + tr('label_loop_count') + '</label>';
    html += '<input type="number" id="pick-loop" min="0" max="999" value="1" class="w-16 bg-dark-900 border border-dark-500 rounded px-2 py-1 text-sm text-center">';
    html += '<span class="text-xs text-muted">(0 = ∞)</span>';
    html += '</div>';
    html += '<label class="flex items-center gap-2 cursor-pointer text-sm text-gray-300">';
    html += '<input type="checkbox" id="pick-autonext" checked class="accent-accent">';
    html += '<span>' + tr('label_autonext_default') + '</span>';
    html += '</label>';
    html += '</div>';
    html += '<div class="flex justify-end gap-3">';
    html += '<button onclick="closeModal()" class="px-4 py-2 bg-dark-600 rounded-lg text-sm hover:bg-dark-500 transition">' + tr('btn_cancel') + '</button>';
    html += '<button onclick="window.playlist._addPicked()" class="px-4 py-2 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-light transition">' + tr('btn_add') + '</button>';
    html += '</div>';

    content.innerHTML = html;
    modal.classList.remove('hidden');
  }

  function _addPicked() {
    var cbs = document.querySelectorAll('.file-pick-cb:checked');
    var loopInput = document.getElementById('pick-loop');
    var autoNextInput = document.getElementById('pick-autonext');
    var loop = loopInput ? parseInt(loopInput.value, 10) || 1 : 1;
    var autoNext = autoNextInput ? autoNextInput.checked : true;
    if (loop < 0) loop = 0;

    cbs.forEach(function (cb) {
      addTrack(cb.value, loop, autoNext);
    });
    closeModal();
  }

  function addFolderTracks(folderPath) {
    fetch('/api/files?folder=' + encodeURIComponent(folderPath || ''))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.files && data.files.length > 0) {
          data.files.forEach(function (f) {
            addTrack(f.path || f.name, 1, true);
          });
          setStatus(tr('folder_added_to_playlist'));
        } else {
          alert(tr('no_files_in_folder'));
        }
      })
      .catch(function () {
        alert('Failed to load folder files');
      });
  }

  // ── Render ────────────────────────────────────────────
  function render() {
    var tbody = document.getElementById('playlist-body');
    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-8 text-center text-muted text-xs">' + tr('playlist_empty') + '</td></tr>';
      document.getElementById('playlist-info').textContent = '';
      return;
    }

    var html = '';
    var isPlaying = window.audioEngine && window.audioEngine.isPlaying;
    items.forEach(function (track, i) {
      var playing = i === currentIndex ? ' playlist-row playing' : '';
      var mediaIcon = window.Icons ? window.Icons.get(track.isVideo ? 'video' : 'music', { size: 16, className: track.isVideo ? 'text-indigo-400' : 'text-accent' }) : '';
      var playIcon = (i === currentIndex && isPlaying)
        ? (window.Icons ? window.Icons.get('play', { size: 13, className: 'text-accent inline mr-1 animate-pulse' }) : '')
        : '';
      
      html += '<tr class="playlist-row' + playing + ' cursor-pointer transition border-b border-dark-600/30" ondblclick="window.playlist.playIndex(' + i + ')" draggable="true" data-idx="' + i + '">';
      html += '<td class="px-3 py-2 text-muted text-xs text-center font-mono">' + (i + 1) + '</td>';
      html += '<td class="px-3 py-2 truncate max-w-[200px]">';
      html += '<div class="flex items-center gap-2">';
      html += '<span class="shrink-0 flex items-center justify-center">' + mediaIcon + '</span>';
      html += '<span class="truncate font-medium ' + (i === currentIndex && isPlaying ? 'text-accent font-bold' : 'text-gray-200') + '">' + playIcon + escHtml(track.title) + '</span>';
      html += '</div>';
      html += '</td>';
      html += '<td class="px-3 py-2 text-center">';
      html += '<input type="number" min="0" max="999" value="' + track.loop + '" class="w-12 bg-dark-900 border border-dark-500 rounded-lg px-1.5 py-1 text-xs text-center" onchange="window.playlist.setLoop(' + i + ',parseInt(this.value)||0)">';
      html += '</td>';
      
      var left = track.loop === 0 ? '∞' : Math.max(0, track.loop - track.currentLoop);
      html += '<td class="px-3 py-2 text-center text-xs text-accent font-mono">' + (i === currentIndex ? left : '-') + '</td>';

      // Auto-Next toggle column
      html += '<td class="px-2 py-2 text-center">';
      if (track.autoNext !== false) {
        var nextIcon = window.Icons ? window.Icons.get('skip-forward', { size: 12, className: 'inline mr-1' }) : '';
        html += '<button onclick="event.stopPropagation();window.playlist.toggleAutoNext(' + i + ')" class="touch-btn min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-semibold bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition shadow-sm inline-flex items-center" title="' + tr('tooltip_autonext_on') + '">' + nextIcon + tr('btn_autonext_on') + '</button>';
      } else {
        var stopIcon = window.Icons ? window.Icons.get('stop', { size: 12, className: 'inline mr-1' }) : '';
        html += '<button onclick="event.stopPropagation();window.playlist.toggleAutoNext(' + i + ')" class="touch-btn min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/25 transition shadow-sm inline-flex items-center" title="' + tr('tooltip_autonext_off') + '">' + stopIcon + tr('btn_autonext_off') + '</button>';
      }
      html += '</td>';

      html += '<td class="px-3 py-2 text-center">';
      html += '<div class="flex items-center justify-center gap-1.5">';
      var pinIcon = window.Icons ? window.Icons.get('pin', { size: 15, className: track.pinned ? 'text-yellow-400' : 'text-gray-400' }) : '';
      if (track.pinned) {
        html += '<button onclick="event.stopPropagation();window.playlist.togglePin(' + i + ')" class="touch-btn w-8 h-8 rounded-lg flex items-center justify-center text-yellow-400 bg-yellow-400/10 transition" title="Unpin track">' + pinIcon + '</button>';
      } else {
        html += '<button onclick="event.stopPropagation();window.playlist.togglePin(' + i + ')" class="touch-btn w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 opacity-40 hover:opacity-100 hover:bg-dark-600/50 transition" title="Pin track">' + pinIcon + '</button>';
      }
      var trashIcon = window.Icons ? window.Icons.get('trash', { size: 15, className: 'text-accent' }) : '';
      html += '<button onclick="event.stopPropagation();window.playlist.removeTrack(' + i + ')" class="touch-btn w-8 h-8 rounded-lg flex items-center justify-center text-accent hover:text-accent-light hover:bg-red-500/10 transition" title="Remove">' + trashIcon + '</button>';
      html += '</div>';
      html += '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;

    // Drag & drop
    var rows = tbody.querySelectorAll('tr[draggable]');
    rows.forEach(function (row, i) {
      row.addEventListener('dragstart', function (e) {
        draggedIdx = i;
        e.dataTransfer.setData('text/plain', i);
        row.style.opacity = '0.5';
      });
      row.addEventListener('dragend', function () { 
        draggedIdx = -1;
        row.style.opacity = '1'; 
      });
      row.addEventListener('dragover', function (e) { 
        if (draggedIdx !== -1 && draggedIdx < items.length) {
          var fromItem = items[draggedIdx];
          var toItem = items[i];
          if (fromItem.pinned === toItem.pinned) {
            e.preventDefault();
            row.classList.add('drag-over');
          }
        }
      });
      row.addEventListener('dragleave', function () { row.classList.remove('drag-over'); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drag-over');
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var to = parseInt(row.dataset.idx, 10);
        moveTrack(from, to);
      });
    });

    document.getElementById('playlist-info').textContent = items.length + ' ' + tr('tracks_in_playlist');
  }

  function updateTrackInfo(track) {
    var el = document.getElementById('track-title');
    var src = document.getElementById('track-source');
    if (track) {
      if (el) el.textContent = track.title;
      if (src) {
        var folderIcon = window.Icons ? window.Icons.get('folder', { size: 13, className: 'inline mr-1 text-muted' }) : '';
        src.innerHTML = folderIcon + '<span>' + escHtml(track.filename) + '</span>';
      }
      setStatus(track.title);
    } else {
      if (el) el.textContent = tr('no_track');
      if (src) src.innerHTML = '';
    }
  }

  // ── Helpers ───────────────────────────────────────────
  function tr(key) {
    return window.appI18n ? window.appI18n.tr(key) : key;
  }
  function setStatus(text) {
    var el = document.getElementById('status-text');
    if (el) el.textContent = text;
  }
  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Upload ────────────────────────────────────────────
  function uploadAndAdd(fileList) {
    if (!fileList || fileList.length === 0) return;
    setStatus('Uploading...');
    var formData = new FormData();
    for (var i = 0; i < fileList.length; i++) {
      formData.append('file', fileList[i]);
    }
    fetch('/api/files/upload', { method: 'POST', body: formData })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success && data.files) {
          data.files.forEach(function (filename) {
            addTrack(filename, 1);
          });
          setStatus('Uploaded and added!');
          if (window.fileManager) window.fileManager.load();
        } else {
          alert(data.error || 'Upload failed');
        }
      })
      .catch(function () { alert('Upload failed'); });
  }

  // ── Public API ────────────────────────────────────────
  window.playlist = {
    addTrack: addTrack,
    removeTrack: removeTrack,
    clearAll: clearAll,
    moveTrack: moveTrack,
    setLoop: setLoop,
    playIndex: playIndex,
    togglePlay: togglePlay,
    next: next,
    previous: previous,
    advance: advance,
    onTrackEnded: onTrackEnded,
    addFromFiles: addFromFiles,
    _addPicked: _addPicked,
    uploadAndAdd: uploadAndAdd,
    toggleAutoNext: toggleAutoNext,
    addFolderTracks: addFolderTracks,
    setAutoAdvance: function (val) { configAutoAdvance = val; },
    render: render,
    togglePin: togglePin,
    get items() { return items; },
    get currentIndex() { return currentIndex; },
  };
})();

/** Close modal helper (global) */
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
