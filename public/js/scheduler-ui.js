/**
 * Scheduler UI — Schedule management, import/export, and client-side timer.
 * 
 * Fetches schedules from the server API, renders a table, provides
 * add/edit modals, and runs a 30-second timer to trigger playback
 * when a scheduled time matches the current time.
 */
(function () {
  'use strict';

  let schedules = [];
  let firedToday = new Set(); // Track which jobs fired today to avoid duplicates

  // ── Fetch & Render ────────────────────────────────────
  function load() {
    fetch('/api/scheduler')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        schedules = data.schedules || [];
        render();
      })
      .catch(function () { console.error('Failed to load schedules'); });
  }

  function render() {
    var tbody = document.getElementById('schedule-body');
    if (!tbody) return;

    if (schedules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-muted text-xs">' + tr('no_schedules') + '</td></tr>';
      return;
    }

    var html = '';
    schedules.forEach(function (job) {
      var schedDesc = getScheduleDisplay(job);
      html += '<tr class="hover:bg-dark-600/30">';
      // Enabled toggle
      html += '<td class="px-3 py-2 text-center">';
      html += '<input type="checkbox" ' + (job.enabled ? 'checked' : '') + ' onchange="window.schedulerUI.toggle(\'' + job.id + '\')" class="accent-accent cursor-pointer">';
      html += '</td>';
      // Name
      html += '<td class="px-3 py-2">' + escHtml(job.name) + '</td>';
      // Schedule
      html += '<td class="px-3 py-2 text-center text-xs text-muted">' + schedDesc + '</td>';
      // Media
      html += '<td class="px-3 py-2 text-xs truncate max-w-[150px]">' + escHtml(job.filename) + '</td>';
      // Volume
      html += '<td class="px-3 py-2 text-center text-xs">' + job.volume + '%</td>';
      // Loop
      html += '<td class="px-3 py-2 text-center text-xs">' + (job.loop === 0 ? '∞' : (job.loop !== undefined ? job.loop : 1)) + '</td>';
      // Actions
      html += '<td class="px-3 py-2 text-center">';
      html += '<button onclick="window.schedulerUI.openEdit(\'' + job.id + '\')" class="px-1 hover:text-accent" title="Edit">✏️</button>';
      html += '<button onclick="window.schedulerUI.remove(\'' + job.id + '\')" class="px-1 hover:text-accent" title="Delete">🗑</button>';
      html += '<button onclick="window.schedulerUI.testPlay(\'' + job.id + '\')" class="px-1 hover:text-accent" title="Test">▶</button>';
      html += '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;
  }

  function getScheduleDisplay(job) {
    if (job.type === 'once') return (job.date || '') + ' ' + job.time;
    if (job.type === 'daily') return tr('schedule_daily') + ' @ ' + job.time;
    if (job.type === 'weekly') {
      var days = (job.days || []).map(function (d) { return tr('day_' + d); }).join(', ');
      return days + ' @ ' + job.time;
    }
    return job.time;
  }

  function getDayCheckboxState(job) {
    if (!job) return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    if (job.type === 'daily') return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    if (job.type === 'weekly' && job.days) return job.days;
    return ['mon', 'tue', 'wed', 'thu', 'fri'];
  }

  function getScheduleType(job) {
    if (!job) return 'recurring';
    if (job.type === 'once') return 'once';
    return 'recurring';
  }

  // ── CRUD ──────────────────────────────────────────────
  function openAdd() {
    showEditModal(null);
  }

  function openEdit(id) {
    var job = schedules.find(function (j) { return j.id === id; });
    if (job) showEditModal(job);
  }

  function showEditModal(job) {
    var isEdit = !!job;
    var modal = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');

    // Fetch file list for dropdown
    fetch('/api/files')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var files = data.files || [];
        var html = '<h3 class="text-lg font-bold text-accent mb-4">' + tr(isEdit ? 'dialog_edit_schedule' : 'dialog_add_schedule') + '</h3>';
        html += '<div class="space-y-4">';

        // Name
        html += '<div><label class="text-sm text-muted block mb-1">' + tr('label_schedule_name') + '</label>';
        html += '<input id="sched-name" type="text" value="' + (job ? escAttr(job.name) : '') + '" placeholder="' + tr('placeholder_schedule_name') + '" class="w-full bg-dark-900 border border-dark-500 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"></div>';

        // Type
        html += '<div><label class="text-sm text-muted block mb-1">' + tr('label_schedule_type') + '</label>';
        html += '<select id="sched-type" onchange="window.schedulerUI._onTypeChange()" class="bg-dark-900 border border-dark-500 rounded-lg px-3 py-2 text-sm w-full focus:border-accent focus:outline-none">';
        html += '<option value="recurring"' + (getScheduleType(job) === 'recurring' ? ' selected' : '') + '>' + tr('schedule_recurring') + '</option>';
        html += '<option value="once"' + (getScheduleType(job) === 'once' ? ' selected' : '') + '>' + tr('schedule_once') + '</option>';
        html += '</select></div>';

        // Time
        html += '<div><label class="text-sm text-muted block mb-1">' + tr('label_time') + '</label>';
        html += '<input id="sched-time" type="time" value="' + (job ? job.time : '07:50') + '" class="bg-dark-900 border border-dark-500 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"></div>';

        // Date (once)
        html += '<div id="sched-date-row"' + (getScheduleType(job) === 'once' ? '' : ' class="hidden"') + '>';
        html += '<label class="text-sm text-muted block mb-1">' + tr('label_date') + '</label>';
        html += '<input id="sched-date" type="date" value="' + (job && job.date ? job.date : new Date().toISOString().slice(0, 10)) + '" class="bg-dark-900 border border-dark-500 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"></div>';

        // Days (recurring)
        var allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        var checkedDays = getDayCheckboxState(job);
        html += '<div id="sched-days-row"' + (getScheduleType(job) === 'once' ? ' class="hidden"' : '') + '>';
        html += '<label class="text-sm text-muted block mb-1">' + tr('label_days_of_week') + '</label>';
        html += '<div class="flex gap-2 flex-wrap">';
        allDays.forEach(function (d) {
          html += '<label class="flex items-center gap-1 text-xs"><input type="checkbox" value="' + d + '" class="sched-day-cb accent-accent"' + (checkedDays.indexOf(d) >= 0 ? ' checked' : '') + '>' + tr('day_' + d) + '</label>';
        });
        html += '</div></div>';

        // File
        html += '<div><label class="text-sm text-muted block mb-1">' + tr('label_media_source') + '</label>';
        html += '<div class="flex gap-2">';
        html += '<select id="sched-file" class="flex-1 bg-dark-900 border border-dark-500 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none">';
        html += '<option value="">-- ' + tr('dialog_select_media') + ' --</option>';
        files.forEach(function (f) {
          html += '<option value="' + escAttr(f.name) + '"' + (job && job.filename === f.name ? ' selected' : '') + '>' + escHtml(f.name) + ' (' + f.sizeFormatted + ')</option>';
        });
        html += '</select>';
        html += '<label class="px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg text-xs hover:border-accent transition cursor-pointer flex items-center justify-center whitespace-nowrap">';
        html += '⬆️ ' + tr('btn_upload');
        html += '<input type="file" accept=".mp3,.mp4,.wav,.flac,.ogg,.m4a,.aac,.wma,.avi,.mkv,.webm" class="hidden" onchange="window.schedulerUI.uploadAndSelect(this.files, this.parentElement)">';
        html += '</label>';
        html += '</div></div>';

        // Volume
        html += '<div><label class="text-sm text-muted block mb-1">' + tr('label_volume') + '</label>';
        html += '<input id="sched-vol" type="number" min="0" max="100" value="' + (job ? job.volume : 80) + '" class="w-20 bg-dark-900 border border-dark-500 rounded-lg px-3 py-2 text-sm text-center focus:border-accent focus:outline-none"> %</div>';

        // Loop Count
        html += '<div><label class="text-sm text-muted block mb-1">' + tr('label_loop_count') + '</label>';
        html += '<input id="sched-loop" type="number" min="0" max="999" value="' + (job ? (job.loop !== undefined ? job.loop : 1) : 1) + '" class="w-20 bg-dark-900 border border-dark-500 rounded-lg px-3 py-2 text-sm text-center focus:border-accent focus:outline-none"> <span class="text-xs text-muted">(0 = ∞)</span></div>';

        html += '</div>';

        // Buttons
        html += '<div class="flex justify-end gap-3 mt-6">';
        html += '<button onclick="closeModal()" class="px-4 py-2 bg-dark-600 rounded-lg text-sm hover:bg-dark-500 transition">' + tr('btn_cancel') + '</button>';
        html += '<button onclick="window.schedulerUI._saveModal(\'' + (job ? job.id : '') + '\')" class="px-4 py-2 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-light transition">' + tr('btn_save') + '</button>';
        html += '</div>';

        content.innerHTML = html;
        modal.classList.remove('hidden');
      });
  }

  function _onTypeChange() {
    var type = document.getElementById('sched-type').value;
    var dateRow = document.getElementById('sched-date-row');
    var daysRow = document.getElementById('sched-days-row');
    if (dateRow) dateRow.className = type === 'once' ? '' : 'hidden';
    if (daysRow) daysRow.className = type === 'once' ? 'hidden' : '';
  }

  function _saveModal(existingId) {
    var name = document.getElementById('sched-name').value.trim() || 'Unnamed';
    var type = document.getElementById('sched-type').value;
    var time = document.getElementById('sched-time').value;
    var date = document.getElementById('sched-date').value;
    var filename = document.getElementById('sched-file').value;
    var volume = parseInt(document.getElementById('sched-vol').value, 10) || 80;
    var loop = parseInt(document.getElementById('sched-loop').value, 10);
    if (isNaN(loop) || loop < 0) loop = 1;

    var days = [];
    document.querySelectorAll('.sched-day-cb:checked').forEach(function (cb) {
      days.push(cb.value);
    });

    if (!filename) { alert(tr('dialog_select_media')); return; }

    // Map frontend type to backend type
    var backendType = type;
    if (type === 'recurring') {
      backendType = days.length === 7 ? 'daily' : 'weekly';
    }

    var body = { name: name, type: backendType, time: time, filename: filename, volume: volume, loop: loop };
    if (type === 'once') body.date = date;
    if (type === 'recurring' && backendType === 'weekly') body.days = days;

    var url = existingId ? '/api/scheduler/' + existingId : '/api/scheduler';
    var method = existingId ? 'PUT' : 'POST';

    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function () { closeModal(); load(); })
      .catch(function () { alert('Failed to save schedule'); });
  }

  function toggle(id) {
    fetch('/api/scheduler/' + id + '/toggle', { method: 'PATCH' })
      .then(function () { load(); })
      .catch(function () { alert('Failed to toggle'); });
  }

  function remove(id) {
    if (!confirm(tr('confirm_delete'))) return;
    fetch('/api/scheduler/' + id, { method: 'DELETE' })
      .then(function () { load(); })
      .catch(function () { alert('Failed to delete'); });
  }

  function testPlay(id) {
    var job = schedules.find(function (j) { return j.id === id; });
    if (job && job.filename) {
      window.audioEngine.setVolume(job.volume / 100);
      window.playlist.addTrack(job.filename, job.loop !== undefined ? job.loop : 1);
      window.playlist.playIndex(window.playlist.items.length - 1);
    }
  }

  // ── Import / Export ───────────────────────────────────
  function exportJSON() {
    window.location.href = '/api/scheduler/export';
  }

  function importJSON(file) {
    if (!file) return;
    var formData = new FormData();
    formData.append('file', file);

    fetch('/api/scheduler/import', { method: 'POST', body: formData })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          load();
          setStatus(tr('status_imported') + ': ' + data.imported + ' schedule(s)');
        } else {
          alert(data.error || 'Import failed');
        }
      })
      .catch(function () { alert('Import failed'); });
  }

  function uploadAndSelect(files, labelEl) {
    if (!files || files.length === 0) return;
    var file = files[0];
    
    var formData = new FormData();
    formData.append('file', file);
    
    var oldHTML = labelEl.innerHTML;
    labelEl.innerHTML = '⏳...';
    
    fetch('/api/files/upload', { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        labelEl.innerHTML = oldHTML;
        if (data.success) {
          // Re-fetch files to update dropdown
          fetch('/api/files')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              var select = document.getElementById('sched-file');
              select.innerHTML = '<option value="">-- ' + tr('dialog_select_media') + ' --</option>';
              (res.files || []).forEach(function(f) {
                var isSelected = f.name === file.name ? ' selected' : '';
                select.innerHTML += '<option value="' + escAttr(f.name) + '"' + isSelected + '>' + escHtml(f.name) + ' (' + f.sizeFormatted + ')</option>';
              });
              if(window.fileManager) window.fileManager.load();
            });
        } else {
          alert('Upload failed: ' + data.error);
        }
      })
      .catch(function() {
        labelEl.innerHTML = oldHTML;
        alert('Upload failed');
      });
  }

  var lastDate = '';

  // ── Client-side scheduler timer ───────────────────────
  function checkSchedules() {
    var now = new Date();
    var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var todayDay = dayMap[now.getDay()];
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var todayDate = year + '-' + month + '-' + day;

    // Reset fired set once per day when date transitions
    if (lastDate && lastDate !== todayDate) {
      firedToday.clear();
    }
    lastDate = todayDate;

    schedules.forEach(function (job) {
      if (!job.enabled) return;
      if (job.time !== timeStr) return;

      var firedKey = job.id + '_' + todayDate;
      if (firedToday.has(firedKey)) return;

      var shouldFire = false;
      if (job.type === 'daily') shouldFire = true;
      else if (job.type === 'weekly' && job.days && job.days.indexOf(todayDay) >= 0) shouldFire = true;
      else if (job.type === 'once' && job.date === todayDate) shouldFire = true;

      if (shouldFire) {
        firedToday.add(firedKey);
        console.log('[Scheduler] Firing job:', job.name);
        window.audioEngine.setVolume(job.volume / 100);
        window.playlist.addTrack(job.filename, job.loop !== undefined ? job.loop : 1);
        window.playlist.playIndex(window.playlist.items.length - 1);
        setStatus('📅 ' + tr('status_scheduled') + ': ' + job.name);
      }
    });
  }

  // Check every 10 seconds
  setInterval(checkSchedules, 10000);

  // ── Helpers ───────────────────────────────────────────
  function tr(key) { return window.appI18n ? window.appI18n.tr(key) : key; }
  function setStatus(text) { var el = document.getElementById('status-text'); if (el) el.textContent = text; }
  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function escAttr(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // ── Public API ────────────────────────────────────────
  window.schedulerUI = {
    load: load,
    render: render,
    openAdd: openAdd,
    openEdit: openEdit,
    toggle: toggle,
    remove: remove,
    testPlay: testPlay,
    exportJSON: exportJSON,
    importJSON: importJSON,
    uploadAndSelect: uploadAndSelect,
    _onTypeChange: _onTypeChange,
    _saveModal: _saveModal,
  };
})();
