from PySide6.QtWidgets import (QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QPushButton, QLabel, QSlider, QTabWidget, QStatusBar,
                             QFrame, QMessageBox, QSplitter)
from PySide6.QtCore import Qt, Slot, QTimer
from PySide6.QtGui import QIcon

from .styles import DARK_STYLE_SHEET
from .vu_meter import StereoVUMeter
from .playlist_widget import PlaylistWidget
from .scheduler_widget import SchedulerWidget
from .settings_widget import SettingsDialog
from .i18n import I18nManager

class MainWindow(QMainWindow):
    """
    Main PySide6 GUI window for the School PR Media Controller application.
    Glues all components together.
    """
    def __init__(self, audio_controller, scheduler):
        super().__init__()
        self.controller = audio_controller
        self.scheduler = scheduler
        self.i18n = I18nManager("en")
        self.i18n.language_changed.connect(self.retranslate_ui)
        
        self.setWindowTitle(self.i18n.tr("app_title"))
        self.resize(960, 680)
        self.setMinimumSize(850, 600)
        
        # Apply premium QSS styles
        self.setStyleSheet(DARK_STYLE_SHEET)
        
        self.init_ui()
        self.load_settings_on_startup()
        
        # Connect audio controller signals
        self.controller.state_changed.connect(self.on_state_changed)
        self.controller.track_changed.connect(self.on_track_changed)
        self.controller.position_changed.connect(self.on_position_changed)
        self.controller.volume_changed.connect(self.on_volume_changed)
        self.controller.duck_state_changed.connect(self.on_duck_state_changed)
        self.controller.error_occurred.connect(self.on_error_occurred)
        
        # Connect scheduler trigger signal
        self.scheduler.trigger_playback.connect(self.handle_scheduled_trigger)

        # High-performance timer for Stereo VU Level polling (runs at 40ms / 25 FPS)
        self.vu_timer = QTimer(self)
        self.vu_timer.setInterval(40)
        self.vu_timer.timeout.connect(self.poll_vu_levels)
        self.vu_timer.start()

    def init_ui(self):
        # Central Main Widget
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(12, 12, 12, 12)
        main_layout.setSpacing(10)

        # HEADER BAR: Title, Lang Toggle, Settings
        header_frame = QFrame()
        header_frame.setObjectName("status_panel")
        header_layout = QHBoxLayout(header_frame)
        header_layout.setContentsMargins(16, 4, 16, 4)
        
        self.lbl_app_title = QLabel(self.i18n.tr("app_title"))
        self.lbl_app_title.setStyleSheet("font-size: 18px; font-weight: bold; color: #E94560;")
        header_layout.addWidget(self.lbl_app_title)
        header_layout.addStretch()
        
        self.btn_lang = QPushButton("TH" if self.i18n.lang == "en" else "EN")
        self.btn_lang.setFixedSize(50, 32)
        self.btn_lang.clicked.connect(self.toggle_lang)
        header_layout.addWidget(self.btn_lang)
        
        self.btn_settings = QPushButton("⚙")
        self.btn_settings.setFixedSize(36, 32)
        self.btn_settings.clicked.connect(self.show_settings)
        header_layout.addWidget(self.btn_settings)
        
        main_layout.addWidget(header_frame)

        # MAIN TABS WIDGET
        self.tabs = QTabWidget()
        
        # TAB 1: PLAYER (Splitter with Controls on Left, Playlist on Right)
        player_tab = QWidget()
        player_layout = QHBoxLayout(player_tab)
        player_layout.setContentsMargins(0, 8, 0, 0)
        
        self.splitter = QSplitter(Qt.Horizontal)
        
        # LEFT WIDGET (Player Info, Controls, VU)
        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        left_layout.setContentsMargins(0, 0, 12, 0)
        left_layout.setSpacing(12)

        # TOP PANEL: Metadata, Progress Bar, Status display
        top_panel = QFrame()
        top_panel.setObjectName("status_panel")
        top_layout = QVBoxLayout(top_panel)
        top_layout.setContentsMargins(16, 12, 16, 12)
        top_layout.setSpacing(6)
        
        # Metadata labels
        lbl_layout = QHBoxLayout()
        self.lbl_title = QLabel(self.i18n.tr("lbl_no_track"))
        self.lbl_title.setStyleSheet("font-size: 16px; font-weight: bold; color: #FFFFFF;")
        self.lbl_title.setWordWrap(True)
        
        self.lbl_status = QLabel("STOPPED")
        self.lbl_status.setStyleSheet("font-weight: bold; color: #8E8E9F; background-color: #24242C; padding: 2px 8px; border-radius: 4px;")
        
        lbl_layout.addWidget(self.lbl_title)
        lbl_layout.addStretch()
        lbl_layout.addWidget(self.lbl_status)
        top_layout.addLayout(lbl_layout)

        # Progress bar slider & Time Label
        progress_layout = QHBoxLayout()
        progress_layout.setSpacing(10)
        
        self.lbl_time_cur = QLabel("00:00")
        self.lbl_time_cur.setStyleSheet("font-family: monospace; color: #8E8E9F;")
        
        self.slider_progress = QSlider(Qt.Horizontal)
        self.slider_progress.setObjectName("progress_bar")
        self.slider_progress.setRange(0, 1000)
        self.slider_progress.setValue(0)
        self.slider_progress.sliderReleased.connect(self.on_progress_slider_released)
        
        self.lbl_time_tot = QLabel("00:00")
        self.lbl_time_tot.setStyleSheet("font-family: monospace; color: #8E8E9F;")
        
        progress_layout.addWidget(self.lbl_time_cur)
        progress_layout.addWidget(self.slider_progress)
        progress_layout.addWidget(self.lbl_time_tot)
        top_layout.addLayout(progress_layout)
        
        left_layout.addWidget(top_panel)

        # MIDDLE SECTION: Controls, Volume, VU Meters
        middle_layout = QVBoxLayout()
        middle_layout.setSpacing(12)

        # Controls panel
        ctrl_panel = QFrame()
        ctrl_panel.setObjectName("card_panel")
        ctrl_layout = QHBoxLayout(ctrl_panel)
        ctrl_layout.setContentsMargins(20, 20, 20, 20)
        ctrl_layout.setSpacing(16)

        self.btn_prev = QPushButton("◀◀")
        self.btn_prev.setToolTip("Previous Track")
        self.btn_prev.clicked.connect(self.controller.prev_with_fade)
        
        self.btn_play = QPushButton(self.i18n.tr("btn_play"))
        self.btn_play.setObjectName("primary_action")
        self.btn_play.clicked.connect(self.toggle_play_stop)
        
        self.btn_pause = QPushButton(self.i18n.tr("btn_pause"))
        self.btn_pause.clicked.connect(self.controller.pause_with_fade)
        
        self.btn_next = QPushButton("▶▶")
        self.btn_next.setToolTip("Fade out and Skip Track")
        self.btn_next.clicked.connect(self.controller.skip_with_fade)

        ctrl_layout.addStretch()
        ctrl_layout.addWidget(self.btn_prev)
        ctrl_layout.addWidget(self.btn_play)
        ctrl_layout.addWidget(self.btn_pause)
        ctrl_layout.addWidget(self.btn_next)
        ctrl_layout.addStretch()
        
        middle_layout.addWidget(ctrl_panel)

        # PR Mode & Volume sliders
        vol_panel = QFrame()
        vol_panel.setObjectName("card_panel")
        vol_layout = QHBoxLayout(vol_panel)
        vol_layout.setContentsMargins(12, 8, 12, 8)
        vol_layout.setSpacing(12)

        # Ducking Mode
        self.btn_mic = QPushButton(self.i18n.tr("btn_mic"))
        self.btn_mic.setObjectName("mic_duck_button")
        self.btn_mic.setCheckable(True)
        self.btn_mic.setFixedHeight(36)
        self.btn_mic.toggled.connect(self.controller.toggle_mic_duck)
        self.btn_mic.setToolTip("Ducks audio levels rapidly for live mic announcements")
        vol_layout.addWidget(self.btn_mic)

        # Volume sliders
        vol_layout.addWidget(QLabel("Vol:"))
        self.slider_volume = QSlider(Qt.Horizontal)
        self.slider_volume.setRange(0, 100)
        self.slider_volume.setValue(self.controller.master_volume)
        self.slider_volume.setFixedWidth(100)
        self.slider_volume.valueChanged.connect(self.controller.set_master_volume)
        vol_layout.addWidget(self.slider_volume)
        
        self.lbl_volume = QLabel(f"{self.controller.master_volume}%")
        self.lbl_volume.setFixedWidth(32)
        vol_layout.addWidget(self.lbl_volume)

        middle_layout.addWidget(vol_panel)

        # VU Meter Display panel
        vu_panel = QFrame()
        vu_panel.setObjectName("card_panel")
        vu_layout = QVBoxLayout(vu_panel)
        vu_layout.setContentsMargins(12, 8, 12, 8)
        self.vu_meter = StereoVUMeter(Qt.Horizontal)
        vu_layout.addWidget(self.vu_meter)
        middle_layout.addWidget(vu_panel)

        left_layout.addLayout(middle_layout)
        left_layout.addStretch()
        
        # Assemble Player Tab Splitter
        self.playlist_widget = PlaylistWidget(self.controller)
        
        self.splitter.addWidget(left_widget)
        self.splitter.addWidget(self.playlist_widget)
        self.splitter.setStretchFactor(0, 1)
        self.splitter.setStretchFactor(1, 2)
        
        player_layout.addWidget(self.splitter)
        self.tabs.addTab(player_tab, "🎵 " + self.i18n.tr("tab_playlist"))
        
        # TAB 2: SCHEDULE
        self.scheduler_widget = SchedulerWidget(self.scheduler)
        self.scheduler_widget.test_play_requested.connect(self.handle_scheduled_trigger)
        self.tabs.addTab(self.scheduler_widget, "📅 " + self.i18n.tr("tab_schedule"))
        
        main_layout.addWidget(self.tabs, 1)
        self.splitter.setCollapsible(1, False)

        # Status Bar
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.status_bar.showMessage(self.i18n.tr("status_ready"))
        
        self.retranslate_ui()

    def toggle_lang(self):
        self.i18n.toggle()
        self.btn_lang.setText("TH" if self.i18n.lang == "en" else "EN")

    def show_settings(self):
        dialog = SettingsDialog(self.controller, self.i18n, self)
        dialog.exec()

    def retranslate_ui(self):
        self.setWindowTitle(self.i18n.tr("app_title"))
        self.lbl_app_title.setText(self.i18n.tr("app_title"))
        
        # Determine current text for play/stop button based on state
        if self.lbl_status.text() == "PLAYING":
            self.btn_play.setText(self.i18n.tr("btn_stop"))
        else:
            self.btn_play.setText(self.i18n.tr("btn_play"))
            
        self.btn_pause.setText(self.i18n.tr("btn_pause"))
        self.btn_mic.setText(self.i18n.tr("btn_mic"))
        self.tabs.setTabText(0, self.i18n.tr("tab_playlist"))
        self.tabs.setTabText(1, self.i18n.tr("tab_schedule"))
        if self.lbl_title.text() == "No Track Loaded" or self.lbl_title.text() == "ไม่มีเพลง":
            self.lbl_title.setText(self.i18n.tr("lbl_no_track"))
        self.status_bar.showMessage(self.i18n.tr("status_ready"))
        
        if hasattr(self.playlist_widget, 'retranslate_ui'):
            self.playlist_widget.retranslate_ui(self.i18n)
        if hasattr(self.scheduler_widget, 'retranslate_ui'):
            self.scheduler_widget.retranslate_ui(self.i18n)

    def toggle_play_stop(self):
        """Toggles between Play and Stop (with fade)."""
        if self.lbl_status.text() == "PLAYING":
            self.controller.stop_with_fade()
        else:
            self.controller.play()

    @Slot(str)
    def on_state_changed(self, state):
        """Reacts to engine playback state changes."""
        self.lbl_status.setText(state.upper())
        if state == "Playing":
            self.lbl_status.setStyleSheet("font-weight: bold; color: #121214; background-color: #00E676; padding: 2px 8px; border-radius: 4px;")
            self.btn_play.setText(self.i18n.tr("btn_stop"))
            self.btn_play.setToolTip("Fade out and Stop")
            self.btn_pause.setEnabled(True)
        elif state == "Paused":
            self.lbl_status.setStyleSheet("font-weight: bold; color: #FFFFFF; background-color: #00B0FF; padding: 2px 8px; border-radius: 4px;")
            self.btn_play.setText(self.i18n.tr("btn_play"))
            self.btn_play.setToolTip("Play")
            self.btn_pause.setEnabled(False)
        elif state == "Buffering":
            self.lbl_status.setStyleSheet("font-weight: bold; color: #121214; background-color: #FFD600; padding: 2px 8px; border-radius: 4px;")
        else: # Stopped / Ended
            self.lbl_status.setStyleSheet("font-weight: bold; color: #8E8E9F; background-color: #24242C; padding: 2px 8px; border-radius: 4px;")
            self.btn_play.setText(self.i18n.tr("btn_play"))
            self.btn_play.setToolTip("Play")
            self.btn_pause.setEnabled(False)
            self.lbl_time_cur.setText("00:00")
            self.slider_progress.setValue(0)

    @Slot(dict)
    def on_track_changed(self, track):
        """Updates UI display with new track metadata."""
        self.lbl_title.setText(track['title'])
        duration = track['duration']
        self.lbl_time_tot.setText(self.format_time(duration * 1000))

    @Slot(float, int)
    def on_position_changed(self, ratio, time_ms):
        """Fires when playback position updates. Refreshes time labels."""
        # Only update if the user isn't actively seeking / dragging
        if not self.slider_progress.isSliderDown():
            slider_val = int(ratio * self.slider_progress.maximum())
            self.slider_progress.setValue(slider_val)
            self.lbl_time_cur.setText(self.format_time(time_ms))

    @Slot(int)
    def on_volume_changed(self, actual_volume):
        """Volume updates when changes occur (including during fades/ducks)."""
        self.lbl_volume.setText(f"{actual_volume}%")
        # Do not adjust master slider here as slider sets controller's base level.

    @Slot(bool)
    def on_duck_state_changed(self, is_ducked):
        """Stylizes PR button when it changes states."""
        self.btn_mic.setChecked(is_ducked)
        if is_ducked:
            self.status_bar.showMessage("PR Live Announcement Mode: Ducking Active.")
        else:
            self.status_bar.showMessage("Ducking deactivated. Audio levels restored.")

    @Slot(str)
    def on_error_occurred(self, error_msg):
        """Sends errors to the status bar and warning popups."""
        self.status_bar.showMessage(f"ALERT: {error_msg}")
        title = self.i18n.tr("playback_warning") if self.i18n else "Playback Warning"
        QMessageBox.warning(self, title, error_msg)

    # --- Interaction Handlers ---

    def on_progress_slider_released(self):
        """Triggered when progress slider is released. Performs search seek."""
        val = self.slider_progress.value()
        max_val = self.slider_progress.maximum()
        ratio = val / max_val
        self.controller.seek(ratio)

    def poll_vu_levels(self):
        """Regularly pulls simulated VU peaks from controller and feeds the widget."""
        l, r = self.controller.get_vu_levels()
        self.vu_meter.update_levels(l, r)

    @Slot(dict)
    def handle_scheduled_trigger(self, track_info):
        """Triggers playback for time schedules immediately."""
        self.status_bar.showMessage(f"Scheduler Triggered: Playing '{track_info['title']}'...")
        # Add to playlist
        self.controller.add_track(
            path=track_info['path'],
            title=track_info['title'],
            loop_count=track_info['loop_count']
        )
        # Advance index to play it
        last_idx = len(self.controller.playlist) - 1
        self.controller.play_index(last_idx)

    def format_time(self, ms):
        """Formats time in ms to MM:SS or HH:MM:SS."""
        s = ms // 1000
        m, s = divmod(s, 60)
        h, m = divmod(m, 60)
        if h > 0:
            return f"{h:02d}:{m:02d}:{s:02d}"
        return f"{m:02d}:{s:02d}"

    def load_settings_on_startup(self):
        """Loads persistent configurations on application startup and applies to engines."""
        import os
        import json
        settings_path = "settings.json"
        if os.path.exists(settings_path):
            try:
                with open(settings_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Apply duck level
                duck = data.get("duck_level", 20)
                self.controller.set_duck_multiplier(duck / 100.0)
                
                # Apply VU mode
                vu_mode = data.get("vu_mode", "simulated")
                self.controller.set_vu_mode(vu_mode)
                
                # Set default volume if saved, otherwise keep master_volume (80)
                vol = data.get("default_volume", 80)
                self.controller.master_volume = vol
                self.slider_volume.setValue(vol)
                self.lbl_volume.setText(f"{vol}%")
                
                # Check for dynamic startup configurations
                # Load default media path if it's set
                default_media = data.get("default_path", "")
                if default_media and os.path.exists(default_media):
                    logger.info(f"Default media folder detected: {default_media}")
            except Exception as e:
                logger.error(f"Error loading settings on startup: {e}")

    def closeEvent(self, event):
        """Performs cleanup of scheduler jobs on window close."""
        self.scheduler.shutdown()
        self.controller.stop()
        event.accept()
