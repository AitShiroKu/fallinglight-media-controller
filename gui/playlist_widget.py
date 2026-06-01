from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
                             QTableWidget, QTableWidgetItem, QHeaderView, QFileDialog,
                             QInputDialog, QSpinBox, QMessageBox, QAbstractItemView,
                             QMenu)
from PySide6.QtCore import Qt, Slot
from PySide6.QtGui import QColor

class DragDropTableWidget(QTableWidget):
    """A TableWidget that supports drag and drop row reordering and communicates with controller."""
    def __init__(self, rows, cols, parent=None):
        super().__init__(rows, cols, parent)
        self.setDragEnabled(True)
        self.setAcceptDrops(True)
        self.viewport().setAcceptDrops(True)
        self.setDragDropOverwriteMode(False)
        self.setDropIndicatorShown(True)
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setSelectionMode(QAbstractItemView.SingleSelection)
        self.setDragDropMode(QAbstractItemView.InternalMove)
        self.playlist_widget = None

    def dropEvent(self, event):
        if event.source() == self:
            source_row = self.currentRow()
            # Compatible with both PySide6 versions (event.position() or event.pos())
            pos = event.position().toPoint() if hasattr(event, 'position') else event.pos()
            drop_index = self.indexAt(pos)
            target_row = drop_index.row()
            
            if target_row == -1:
                target_row = self.rowCount()
            
            if source_row != target_row and source_row >= 0:
                if target_row > source_row:
                    target_row -= 1
                if self.playlist_widget:
                    self.playlist_widget.controller.reorder_playlist(source_row, target_row)
                    self.setCurrentCell(target_row, 0)
            event.ignore()
        else:
            super().dropEvent(event)

class PlaylistWidget(QWidget):
    """
    Manages the playlist queue UI. Allows adding files, URL streams, deleting,
    reordering, and setting individual loop counts on the fly.
    """
    def __init__(self, audio_controller, parent=None):
        super().__init__(parent)
        self.controller = audio_controller
        self.i18n = None
        self.init_ui()
        
        # Connect to controller signals
        self.controller.playlist_updated.connect(self.update_playlist_display)
        self.controller.track_changed.connect(self.highlight_current_track)

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # Action Button Row
        button_row = QHBoxLayout()
        button_row.setSpacing(8)
        
        self.btn_add_files = QPushButton("Add Audio/Video Files")
        self.btn_add_files.setObjectName("primary_action")
        self.btn_add_files.clicked.connect(self.add_files_dialog)
        
        self.btn_add_url = QPushButton("Add YouTube / URL")
        self.btn_add_url.setObjectName("accent_action")
        self.btn_add_url.clicked.connect(self.add_url_dialog)
        
        self.btn_move_up = QPushButton("▲ Up")
        self.btn_move_up.clicked.connect(self.move_item_up)
        
        self.btn_move_down = QPushButton("▼ Down")
        self.btn_move_down.clicked.connect(self.move_item_down)
        
        self.btn_clear = QPushButton("Clear All")
        self.btn_clear.clicked.connect(self.clear_playlist)
        
        button_row.addWidget(self.btn_add_files)
        button_row.addWidget(self.btn_add_url)
        button_row.addStretch()
        button_row.addWidget(self.btn_move_up)
        button_row.addWidget(self.btn_move_down)
        button_row.addWidget(self.btn_clear)
        
        layout.addLayout(button_row)

        # Table Display for Playlist
        self.table = DragDropTableWidget(0, 4)
        self.table.playlist_widget = self
        self.table.setHorizontalHeaderLabels(["Title / Source", "Loops", "Loops Left", "Action"])
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.doubleClicked.connect(self.on_row_double_clicked)
        
        # Table Context Menu
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self.show_context_menu)
        
        # Table sizing
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        header.setSectionResizeMode(1, QHeaderView.Fixed)
        header.setSectionResizeMode(2, QHeaderView.Fixed)
        header.setSectionResizeMode(3, QHeaderView.Fixed)
        self.table.setColumnWidth(1, 80)
        self.table.setColumnWidth(2, 90)
        self.table.setColumnWidth(3, 100)
        self.table.verticalHeader().setDefaultSectionSize(36)
        
        layout.addWidget(self.table)

    def retranslate_ui(self, i18n):
        self.i18n = i18n
        self.btn_add_files.setText(i18n.tr("btn_add_files"))
        self.btn_add_url.setText(i18n.tr("btn_add_url"))
        self.btn_move_up.setText(i18n.tr("btn_up"))
        self.btn_move_down.setText(i18n.tr("btn_down"))
        self.btn_clear.setText(i18n.tr("btn_clear"))
        self.table.setHorizontalHeaderLabels([
            i18n.tr("col_title"),
            i18n.tr("col_loops"),
            i18n.tr("col_loops_left"),
            i18n.tr("col_action")
        ])
        
        for r in range(self.table.rowCount()):
            btn = self.table.cellWidget(r, 3)
            if btn:
                btn.setText(i18n.tr("action_delete"))

    @Slot(list)
    def update_playlist_display(self, playlist):
        """Rebuilds the table rows based on the current playlist data model."""
        # Block signals temporarily to prevent infinite update loops during render
        self.table.blockSignals(True)
        self.table.setRowCount(0)
        
        for i, track in enumerate(playlist):
            self.table.insertRow(i)
            
            # Title cell
            title = track['title']
            title_item = QTableWidgetItem(title)
            title_item.setFlags(title_item.flags() & ~Qt.ItemIsEditable)
            if i == self.controller.current_index:
                title_item.setForeground(Qt.green)
            self.table.setItem(i, 0, title_item)
            
            # Loops configuration (QSpinBox)
            spin_box = QSpinBox()
            spin_box.setRange(-1, 99) # -1 representing infinite loop
            spin_box.setSpecialValueText("∞")
            spin_box.setValue(track['loop_count'])
            # Create a closure to capture the correct row index
            spin_box.valueChanged.connect(self._create_loop_changed_callback(i))
            self.table.setCellWidget(i, 1, spin_box)
            
            # Loops remaining
            rem_loops = track['remaining_loops']
            rem_str = "∞" if track['loop_count'] == -1 else str(rem_loops)
            rem_item = QTableWidgetItem(rem_str)
            rem_item.setTextAlignment(Qt.AlignCenter)
            rem_item.setFlags(rem_item.flags() & ~Qt.ItemIsEditable)
            self.table.setItem(i, 2, rem_item)
            
            # Delete Action Button
            btn_del_text = self.i18n.tr("action_delete") if self.i18n else "Delete"
            btn_del = QPushButton(btn_del_text)
            btn_del.setStyleSheet("QPushButton { color: #FF5252; border-color: #FF5252; padding: 2px 8px; } QPushButton:hover { background-color: #FF5252; color: #FFFFFF; }")
            btn_del.clicked.connect(self._create_delete_callback(i))
            self.table.setCellWidget(i, 3, btn_del)
            
        self.table.blockSignals(False)
        self.highlight_current_track()

    def _create_loop_changed_callback(self, index):
        return lambda val: self.controller.update_loop_count(index, val)

    def _create_delete_callback(self, index):
        return lambda: self.controller.remove_track(index)

    @Slot(dict)
    def highlight_current_track(self, current_track=None):
        """Highlights the active playing track in the table."""
        current_idx = self.controller.current_index
        for r in range(self.table.rowCount()):
            item = self.table.item(r, 0)
            if item:
                if r == current_idx:
                    item.setForeground(QColor("#00E676"))
                    font = item.font()
                    font.setBold(True)
                    item.setFont(font)
                else:
                    item.setForeground(QColor("#E2E2E9"))
                    font = item.font()
                    font.setBold(False)
                    item.setFont(font)

    def show_context_menu(self, pos):
        item = self.table.itemAt(pos)
        if item is None:
            return
            
        row = item.row()
        menu = QMenu(self)
        menu.setStyleSheet("QMenu { background-color: #1A1A20; color: #FFFFFF; border: 1px solid #2D2D37; } QMenu::item:selected { background-color: #00B0FF; }")
        
        play_txt = self.i18n.tr("menu_play") if self.i18n else "▶ Play"
        loop_txt = self.i18n.tr("menu_loop") if self.i18n else "🔁 Set Loop Count"
        remove_txt = self.i18n.tr("menu_remove") if self.i18n else "🗑 Remove"
        
        action_play = menu.addAction(play_txt)
        action_loop = menu.addAction(loop_txt)
        menu.addSeparator()
        action_remove = menu.addAction(remove_txt)
        
        action = menu.exec(self.table.viewport().mapToGlobal(pos))
        
        if action == action_play:
            self.controller.play_index(row)
        elif action == action_remove:
            self.controller.remove_track(row)
        elif action == action_loop:
            current_loops = self.controller.playlist[row]['loop_count']
            title_txt = self.i18n.tr("dialog_set_loop_title") if self.i18n else "Set Loop Count"
            label_txt = self.i18n.tr("dialog_set_loop_label") if self.i18n else "Enter loop count (-1 for infinite):"
            loops, ok = QInputDialog.getInt(self, title_txt, label_txt, current_loops, -1, 999)
            if ok:
                self.controller.update_loop_count(row, loops)

    def on_row_double_clicked(self, index):
        """Double clicking a row initiates playback of that track index."""
        row = index.row()
        self.controller.play_index(row)

    def add_files_dialog(self):
        """Opens standard Qt file dialog to add local media files."""
        title_txt = self.i18n.tr("dialog_add_files_title") if self.i18n else "Select Audio/Video files to Add"
        files, _ = QFileDialog.getOpenFileNames(
            self,
            title_txt,
            "",
            "Audio/Video Files (*.mp3 *.mp4 *.wav *.m4a *.ogg *.avi *.mkv);;All Files (*)"
        )
        for f in files:
            self.controller.add_track(f)

    def add_url_dialog(self):
        """Prompts for YouTube URL or generic stream URL."""
        title_txt = self.i18n.tr("dialog_add_url_title") if self.i18n else "Add Stream URL"
        label_txt = self.i18n.tr("dialog_add_url_label") if self.i18n else "Enter YouTube URL or Audio Stream Address:"
        url, ok = QInputDialog.getText(
            self,
            title_txt,
            label_txt
        )
        if ok and url.strip():
            url = url.strip()
            self.controller.add_track(url)

    def move_item_up(self):
        """Moves selected track up in playlist sequence."""
        row = self.table.currentRow()
        if row > 0:
            self.controller.reorder_playlist(row, row - 1)
            self.table.setCurrentCell(row - 1, 0)

    def move_item_down(self):
        """Moves selected track down in playlist sequence."""
        row = self.table.currentRow()
        if 0 <= row < self.table.rowCount() - 1:
            self.controller.reorder_playlist(row, row + 1)
            self.table.setCurrentCell(row + 1, 0)

    def clear_playlist(self):
        """Clears entire playlist queue after confirmation."""
        if self.table.rowCount() == 0:
            return
            
        title_txt = self.i18n.tr("dialog_confirm_clear_title") if self.i18n else "Confirm Clear"
        label_txt = self.i18n.tr("dialog_confirm_clear_label") if self.i18n else "Are you sure you want to clear the entire playlist queue?"
        reply = QMessageBox.question(
            self, title_txt,
            label_txt,
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        if reply == QMessageBox.Yes:
            self.controller.stop()
            # Loop backwards to prevent index shifts during deletions
            for r in range(len(self.controller.playlist) - 1, -1, -1):
                self.controller.remove_track(r)
from PySide6.QtGui import QColor
