import os
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
                             QLabel, QTableWidget, QTableWidgetItem, QHeaderView,
                             QLineEdit, QTimeEdit, QDateEdit, QCheckBox, QSpinBox,
                             QFormLayout, QMessageBox, QFileDialog, QDialog, QMenu)
from PySide6.QtCore import Qt, QTime, QDate, Slot, Signal

class SchedulerDialog(QDialog):
    """Popup Dialog to create or edit a Scheduled Task."""
    def __init__(self, scheduler, i18n, parent=None, schedule_item=None):
        super().__init__(parent)
        self.scheduler = scheduler
        self.i18n = i18n
        self.schedule_item = schedule_item
        self.init_ui()
        self.retranslate_ui()
        if self.schedule_item:
            self.populate_fields()

    def init_ui(self):
        self.setMinimumWidth(400)
        if self.parent():
            self.setStyleSheet(self.parent().styleSheet())
        
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(16, 16, 16, 16)
        main_layout.setSpacing(12)
        
        form_layout = QFormLayout()
        form_layout.setSpacing(12)

        # Name
        self.lbl_name = QLabel()
        self.input_name = QLineEdit()
        self.input_name.setPlaceholderText("Morning Routine Anthem")
        form_layout.addRow(self.lbl_name, self.input_name)

        # Media Source
        source_widget = QWidget()
        source_layout = QHBoxLayout(source_widget)
        source_layout.setContentsMargins(0, 0, 0, 0)
        source_layout.setSpacing(4)
        
        self.input_path = QLineEdit()
        self.input_path.setPlaceholderText("File Path or YouTube URL")
        self.btn_browse = QPushButton("📁 ...")
        self.btn_browse.setFixedWidth(36)
        self.btn_browse.clicked.connect(self.browse_media)
        
        source_layout.addWidget(self.input_path)
        source_layout.addWidget(self.btn_browse)
        self.lbl_source = QLabel()
        form_layout.addRow(self.lbl_source, source_widget)

        # Loop count
        self.lbl_loops = QLabel()
        self.input_loops = QSpinBox()
        self.input_loops.setRange(-1, 99)
        self.input_loops.setSpecialValueText("∞")
        self.input_loops.setValue(1)
        form_layout.addRow(self.lbl_loops, self.input_loops)

        # Trigger Time
        self.lbl_time = QLabel()
        self.input_time = QTimeEdit()
        self.input_time.setTime(QTime.currentTime())
        self.input_time.setDisplayFormat("HH:mm:ss")
        form_layout.addRow(self.lbl_time, self.input_time)

        # Recurring Schedule Rules
        days_widget = QWidget()
        days_layout = QVBoxLayout(days_widget)
        days_layout.setContentsMargins(0, 0, 0, 0)
        days_layout.setSpacing(4)
        
        # Checkbox to toggle weekly recurrence
        self.cb_weekly = QCheckBox()
        self.cb_weekly.setChecked(True)
        self.cb_weekly.toggled.connect(self.toggle_recurring_mode)
        days_layout.addWidget(self.cb_weekly)

        # Weekdays layout
        self.weekdays_widget = QWidget()
        weekdays_layout = QHBoxLayout(self.weekdays_widget)
        weekdays_layout.setContentsMargins(12, 0, 0, 0)
        weekdays_layout.setSpacing(6)
        
        self.days_checkboxes = {}
        for day in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']:
            cb = QCheckBox(day)
            weekdays_layout.addWidget(cb)
            self.days_checkboxes[day.lower()] = cb
            
        days_layout.addWidget(self.weekdays_widget)

        # One time Date trigger
        self.date_widget = QWidget()
        date_layout = QHBoxLayout(self.date_widget)
        date_layout.setContentsMargins(12, 0, 0, 0)
        self.input_date = QDateEdit()
        self.input_date.setDate(QDate.currentDate())
        self.input_date.setCalendarPopup(True)
        self.lbl_date = QLabel()
        date_layout.addWidget(self.lbl_date)
        date_layout.addWidget(self.input_date)
        
        days_layout.addWidget(self.date_widget)
        self.date_widget.setVisible(False) # Invisible by default since weekly is checked

        self.lbl_rule = QLabel()
        form_layout.addRow(self.lbl_rule, days_widget)

        main_layout.addLayout(form_layout)
        
        # Save / Add Button
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        self.btn_add_sched = QPushButton()
        self.btn_add_sched.setObjectName("primary_action")
        self.btn_add_sched.clicked.connect(self.add_schedule_task)
        btn_layout.addWidget(self.btn_add_sched)
        main_layout.addLayout(btn_layout)

    def retranslate_ui(self):
        if not self.i18n: return
        self.setWindowTitle(
            self.i18n.tr("dialog_edit_schedule")
            if self.schedule_item
            else self.i18n.tr("dialog_add_schedule")
        )
        self.lbl_name.setText(self.i18n.tr("sched_name"))
        self.lbl_source.setText(self.i18n.tr("sched_source"))
        self.lbl_loops.setText(self.i18n.tr("sched_loops"))
        self.lbl_time.setText(self.i18n.tr("sched_time"))
        self.lbl_rule.setText(self.i18n.tr("sched_rule"))
        self.cb_weekly.setText(self.i18n.tr("sched_weekly"))
        self.lbl_date.setText(self.i18n.tr("sched_date"))
        
        btn_txt = self.i18n.tr("settings_save") if self.schedule_item else self.i18n.tr("sched_add")
        self.btn_add_sched.setText(btn_txt)

    def toggle_recurring_mode(self, enabled):
        self.weekdays_widget.setVisible(enabled)
        self.date_widget.setVisible(not enabled)

    def browse_media(self):
        title = self.i18n.tr("dialog_sched_media_title") if self.i18n else "Select Scheduled Media File"
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            title,
            "",
            "Audio/Video Files (*.mp3 *.mp4 *.wav *.m4a *.ogg *.avi *.mkv);;All Files (*)"
        )
        if file_path:
            self.input_path.setText(file_path)

    def populate_fields(self):
        s = self.schedule_item
        self.input_name.setText(s['name'])
        self.input_path.setText(s['target_path'])
        self.input_loops.setValue(s['loop_count'])
        
        time_obj = QTime.fromString(s['time'], "HH:mm:ss")
        if time_obj.isValid():
            self.input_time.setTime(time_obj)
            
        if s['date']:
            self.cb_weekly.setChecked(False)
            date_obj = QDate.fromString(s['date'], "yyyy-MM-dd")
            if date_obj.isValid():
                self.input_date.setDate(date_obj)
        else:
            self.cb_weekly.setChecked(True)
            for d in s['days']:
                d_key = d.lower()
                if d_key in self.days_checkboxes:
                    self.days_checkboxes[d_key].setChecked(True)

    def add_schedule_task(self):
        name = self.input_name.text().strip()
        path = self.input_path.text().strip()
        loops = self.input_loops.value()
        time_str = self.input_time.time().toString("HH:mm:ss")
        
        if not name:
            title = self.i18n.tr("dialog_validation_error") if self.i18n else "Validation Error"
            msg = self.i18n.tr("msg_err_task_name") if self.i18n else "Please provide a Task Name."
            QMessageBox.warning(self, title, msg)
            return
        if not path:
            title = self.i18n.tr("dialog_validation_error") if self.i18n else "Validation Error"
            msg = self.i18n.tr("msg_err_media_path") if self.i18n else "Please select a media File Path or stream URL."
            QMessageBox.warning(self, title, msg)
            return

        days = []
        date_str = ""
        if self.cb_weekly.isChecked():
            for d_name, cb in self.days_checkboxes.items():
                if cb.isChecked():
                    days.append(d_name)
        else:
            date_str = self.input_date.date().toString("yyyy-MM-dd")

        if self.schedule_item:
            self.scheduler.update_schedule(
                sched_id=self.schedule_item['id'],
                name=name,
                time_str=time_str,
                days=days,
                date_str=date_str,
                target_path=path,
                loop_count=loops,
                enabled=self.schedule_item.get('enabled', True)
            )
        else:
            self.scheduler.add_schedule(
                name=name,
                time_str=time_str,
                days=days,
                date_str=date_str,
                target_path=path,
                loop_count=loops
            )
        self.accept()

class SchedulerWidget(QWidget):
    """
    Dedicated layout for automation configurations. Features schedules display table.
    """
    test_play_requested = Signal(dict)

    def __init__(self, scheduler, parent=None):
        super().__init__(parent)
        self.scheduler = scheduler
        self.i18n = None
        self.init_ui()
        
        self.scheduler.schedules_changed.connect(self.update_schedules_table)
        self.update_schedules_table(self.scheduler.schedules)

    def init_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(8, 8, 8, 8)
        main_layout.setSpacing(12)

        # Header Row
        header_layout = QHBoxLayout()
        self.lbl_table_header = QLabel("Active Automation Schedules")
        self.lbl_table_header.setStyleSheet("font-size: 16px; font-weight: bold; color: #FFFFFF;")
        header_layout.addWidget(self.lbl_table_header)
        header_layout.addStretch()
        
        self.btn_open_dialog = QPushButton("➕ Add Schedule")
        self.btn_open_dialog.setObjectName("primary_action")
        self.btn_open_dialog.clicked.connect(self.show_add_dialog)
        header_layout.addWidget(self.btn_open_dialog)
        
        main_layout.addWidget(self.btn_open_dialog)
        main_layout.addLayout(header_layout)

        # Build table with 6 columns to match reference layout
        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["Enabled", "Name", "Schedule", "Media", "Next Run", "Actions"])
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionMode(QTableWidget.NoSelection)
        
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Fixed) # Enabled
        header.setSectionResizeMode(1, QHeaderView.Stretch) # Name
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents) # Schedule details
        header.setSectionResizeMode(3, QHeaderView.Stretch) # Media file source
        header.setSectionResizeMode(4, QHeaderView.Fixed) # Next Run
        header.setSectionResizeMode(5, QHeaderView.Fixed) # Actions
        self.table.setColumnWidth(0, 70)
        self.table.setColumnWidth(4, 140)
        self.table.setColumnWidth(5, 120)
        self.table.verticalHeader().setDefaultSectionSize(38)
        
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self.show_context_menu)

        main_layout.addWidget(self.table)

    def show_add_dialog(self):
        dialog = SchedulerDialog(self.scheduler, self.i18n, self)
        dialog.exec()

    def show_edit_dialog(self, row):
        s = self.scheduler.schedules[row]
        dialog = SchedulerDialog(self.scheduler, self.i18n, self, schedule_item=s)
        dialog.exec()

    def retranslate_ui(self, i18n):
        self.i18n = i18n
        self.lbl_table_header.setText(i18n.tr("sched_table_header"))
        self.btn_open_dialog.setText("➕ " + i18n.tr("sched_add"))
        self.table.setHorizontalHeaderLabels([
            i18n.tr("col_enabled"),
            i18n.tr("col_name"),
            i18n.tr("col_schedule"),
            i18n.tr("col_media"),
            i18n.tr("col_next_run"),
            i18n.tr("col_actions")
        ])
        self.update_schedules_table(self.scheduler.schedules)

    @Slot(list)
    def update_schedules_table(self, schedules):
        self.table.blockSignals(True)
        self.table.setRowCount(0)

        for i, s in enumerate(schedules):
            self.table.insertRow(i)
            
            # 1. Enabled checkbox
            cb_enabled = QCheckBox()
            cb_enabled.setChecked(s['enabled'])
            cell_widget = QWidget()
            layout = QHBoxLayout(cell_widget)
            layout.addWidget(cb_enabled)
            layout.setAlignment(Qt.AlignCenter)
            layout.setContentsMargins(0, 0, 0, 0)
            self.table.setCellWidget(i, 0, cell_widget)
            cb_enabled.toggled.connect(self._create_toggle_callback(s['id']))
            
            # 2. Name
            name_item = QTableWidgetItem(s['name'])
            name_item.setFlags(name_item.flags() & ~Qt.ItemIsEditable)
            self.table.setItem(i, 1, name_item)
            
            # 3. Schedule formatting (description)
            lang = self.i18n.lang if self.i18n else "en"
            time_short = s['time'][:5]
            if s['date']:
                date_lbl = self.i18n.tr("rule_date") if self.i18n else "Date: "
                rule_str = f"{date_lbl}{s['date']} @ {time_short}"
            elif s['days']:
                if lang == "th":
                    day_map = {
                        "mon": "จ.", "tue": "อ.", "wed": "พ.", "thu": "พฤ.",
                        "fri": "ศ.", "sat": "ส.", "sun": "อา."
                    }
                    days_translated = [day_map.get(d, d) for d in s['days']]
                    rule_str = f"{', '.join(days_translated)} @ {time_short}"
                else:
                    day_names = [d.capitalize() for d in s['days']]
                    rule_str = f"{', '.join(day_names)} @ {time_short}"
            else:
                daily_lbl = self.i18n.tr("rule_daily") if self.i18n else "Daily"
                rule_str = f"{daily_lbl} @ {time_short}"
                
            rule_item = QTableWidgetItem(rule_str)
            rule_item.setFlags(rule_item.flags() & ~Qt.ItemIsEditable)
            rule_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(i, 2, rule_item)
            
            # 4. Media
            media_name = os.path.basename(s['target_path']) if s['target_path'] else "—"
            media_item = QTableWidgetItem(media_name)
            media_item.setFlags(media_item.flags() & ~Qt.ItemIsEditable)
            self.table.setItem(i, 3, media_item)
            
            # 5. Next Run
            next_run = self.scheduler.get_next_run(s['id'])
            next_text = next_run.strftime("%Y-%m-%d %H:%M") if next_run else "—"
            next_item = QTableWidgetItem(next_text)
            next_item.setFlags(next_item.flags() & ~Qt.ItemIsEditable)
            next_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(i, 4, next_item)
            
            # 6. Action buttons (Edit, Delete, Test Play)
            action_widget = QWidget()
            action_layout = QHBoxLayout(action_widget)
            action_layout.setContentsMargins(4, 2, 4, 2)
            action_layout.setSpacing(4)
            
            # Edit Button (✏️)
            btn_edit = QPushButton("✏️")
            btn_edit.setFixedSize(30, 26)
            btn_edit.setToolTip("Edit task" if lang == "en" else "แก้ไขงาน")
            btn_edit.clicked.connect(self._create_edit_callback(i))
            action_layout.addWidget(btn_edit)
            
            # Delete Button (🗑)
            btn_del = QPushButton("🗑")
            btn_del.setFixedSize(30, 26)
            btn_del.setProperty("class", "danger")
            btn_del.setToolTip("Delete task" if lang == "en" else "ลบงาน")
            btn_del.clicked.connect(self._create_delete_callback(s['id']))
            action_layout.addWidget(btn_del)
            
            # Test Play Button (▶)
            btn_test = QPushButton("▶")
            btn_test.setFixedSize(30, 26)
            btn_test.setToolTip("Test Play" if lang == "en" else "ทดสอบเล่น")
            btn_test.clicked.connect(self._create_test_callback(i))
            action_layout.addWidget(btn_test)
            
            self.table.setCellWidget(i, 5, action_widget)
            
        self.table.blockSignals(False)

    def show_context_menu(self, pos):
        item = self.table.itemAt(pos)
        if item is None:
            return
            
        row = item.row()
        menu = QMenu(self)
        menu.setStyleSheet("QMenu { background-color: #1A1A20; color: #FFFFFF; border: 1px solid #2D2D37; } QMenu::item:selected { background-color: #00B0FF; }")
        
        del_txt = self.i18n.tr("menu_delete") if self.i18n else "🗑 Delete Schedule Task"
        action_delete = menu.addAction(del_txt)
        
        action = menu.exec(self.table.viewport().mapToGlobal(pos))
        
        if action == action_delete:
            sched_id = self.scheduler.schedules[row]['id']
            self.scheduler.delete_schedule(sched_id)

    def _create_toggle_callback(self, sched_id):
        return lambda checked: self.scheduler.toggle_schedule(sched_id, checked)

    def _create_delete_callback(self, sched_id):
        return lambda: self.scheduler.delete_schedule(sched_id)

    def _create_edit_callback(self, row):
        return lambda: self.show_edit_dialog(row)

    def _create_test_callback(self, row):
        return lambda: self.test_playback(row)

    def test_playback(self, row):
        s = self.scheduler.schedules[row]
        track_info = {
            'path': s['target_path'],
            'title': s['target_title'] or os.path.basename(s['target_path']),
            'loop_count': s['loop_count']
        }
        self.test_play_requested.emit(track_info)
