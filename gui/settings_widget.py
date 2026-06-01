import os
import json
import logging
from PySide6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QPushButton,
                             QLabel, QLineEdit, QFileDialog, QSlider, QSpinBox,
                             QFormLayout, QMessageBox, QGroupBox, QWidget, QComboBox)
from PySide6.QtCore import Qt

logger = logging.getLogger("Settings")

class SettingsDialog(QDialog):
    """
    Handles global configuration of application defaults, including Ducking levels,
    fade-out parameters, default folder paths, and scheduler timezone.
    Persists in 'settings.json'.
    """
    def __init__(self, audio_controller, i18n_manager, parent=None, config_path="settings.json"):
        super().__init__(parent)
        self.controller = audio_controller
        self.i18n = i18n_manager
        self.config_path = config_path
        
        # Default settings configurations
        self.settings_data = {
            "default_path": "",
            "duck_level": 20,          # Ducking volume as percentage (0-100)
            "fade_out_duration": 2.0,  # Fade duration in seconds
            "vu_mode": "simulated",     # VU Meter calculation mode
            "scheduler_timezone": "Asia/Bangkok" # Timezone setting
        }
        
        self.init_ui()
        self.load_settings()
        
        self.i18n.language_changed.connect(self.retranslate_ui)
        self.retranslate_ui()

    def init_ui(self):
        self.resize(500, 480)
        self.setMinimumWidth(450)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

        # 1. GENERAL SETTINGS GROUP
        self.group_general = QGroupBox()
        self.group_general.setObjectName("card_panel")
        layout_general = QFormLayout(self.group_general)
        layout_general.setContentsMargins(16, 16, 16, 16)
        layout_general.setSpacing(10)

        folder_widget = QWidget()
        folder_layout = QHBoxLayout(folder_widget)
        folder_layout.setContentsMargins(0, 0, 0, 0)
        folder_layout.setSpacing(6)
        self.input_folder = QLineEdit()
        self.btn_browse = QPushButton("📁 Browse")
        self.btn_browse.clicked.connect(self.browse_folder)
        folder_layout.addWidget(self.input_folder)
        folder_layout.addWidget(self.btn_browse)
        self.lbl_folder = QLabel()
        layout_general.addRow(self.lbl_folder, folder_widget)
        layout.addWidget(self.group_general)

        # 2. AUDIO DYNAMICS GROUP
        self.group_audio = QGroupBox()
        self.group_audio.setObjectName("card_panel")
        layout_audio = QFormLayout(self.group_audio)
        layout_audio.setContentsMargins(16, 16, 16, 16)
        layout_audio.setSpacing(12)

        duck_widget = QWidget()
        duck_layout = QHBoxLayout(duck_widget)
        duck_layout.setContentsMargins(0, 0, 0, 0)
        duck_layout.setSpacing(8)
        self.slider_duck = QSlider(Qt.Horizontal)
        self.slider_duck.setRange(0, 80)
        self.slider_duck.setValue(20)
        self.slider_duck.valueChanged.connect(self.on_duck_slider_changed)
        self.spin_duck = QSpinBox()
        self.spin_duck.setRange(0, 80)
        self.spin_duck.setValue(20)
        self.spin_duck.setSuffix("%")
        self.spin_duck.valueChanged.connect(self.slider_duck.setValue)
        self.slider_duck.valueChanged.connect(self.spin_duck.setValue)
        duck_layout.addWidget(self.slider_duck)
        duck_layout.addWidget(self.spin_duck)
        self.lbl_duck = QLabel()
        layout_audio.addRow(self.lbl_duck, duck_widget)

        fade_widget = QWidget()
        fade_layout = QHBoxLayout(fade_widget)
        fade_layout.setContentsMargins(0, 0, 0, 0)
        self.spin_fade = QSpinBox()
        self.spin_fade.setRange(1, 10)
        self.spin_fade.setValue(2)
        self.spin_fade.setSuffix(" sec")
        fade_layout.addWidget(self.spin_fade)
        fade_layout.addStretch()
        self.lbl_fade = QLabel()
        layout_audio.addRow(self.lbl_fade, fade_widget)
        layout.addWidget(self.group_audio)

        # 3. DISPLAY SETTINGS GROUP
        self.group_display = QGroupBox()
        self.group_display.setObjectName("card_panel")
        layout_display = QFormLayout(self.group_display)
        layout_display.setContentsMargins(16, 16, 16, 16)
        layout_display.setSpacing(10)

        vu_widget = QWidget()
        vu_layout = QHBoxLayout(vu_widget)
        vu_layout.setContentsMargins(0, 0, 0, 0)
        self.combo_vu_mode = QComboBox()
        self.combo_vu_mode.currentIndexChanged.connect(self.on_vu_mode_changed)
        vu_layout.addWidget(self.combo_vu_mode)
        vu_layout.addStretch()
        self.lbl_vu = QLabel()
        layout_display.addRow(self.lbl_vu, vu_widget)
        layout.addWidget(self.group_display)

        # 4. SCHEDULER SETTINGS GROUP
        self.group_scheduler = QGroupBox()
        self.group_scheduler.setObjectName("card_panel")
        layout_scheduler = QFormLayout(self.group_scheduler)
        layout_scheduler.setContentsMargins(16, 16, 16, 16)
        layout_scheduler.setSpacing(10)

        tz_widget = QWidget()
        tz_layout = QHBoxLayout(tz_widget)
        tz_layout.setContentsMargins(0, 0, 0, 0)
        self.combo_timezone = QComboBox()
        self.combo_timezone.addItems([
            "Asia/Bangkok",
            "Asia/Tokyo",
            "Asia/Shanghai",
            "UTC",
            "US/Eastern",
            "US/Pacific",
            "Europe/London"
        ])
        tz_layout.addWidget(self.combo_timezone)
        tz_layout.addStretch()
        self.lbl_timezone = QLabel()
        layout_scheduler.addRow(self.lbl_timezone, tz_widget)
        layout.addWidget(self.group_scheduler)

        # Save Button at the bottom
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        self.btn_save = QPushButton()
        self.btn_save.setObjectName("primary_action")
        self.btn_save.setFixedWidth(180)
        self.btn_save.clicked.connect(self.save_settings)
        btn_layout.addWidget(self.btn_save)
        layout.addLayout(btn_layout)

    def retranslate_ui(self):
        self.setWindowTitle(self.i18n.tr("settings_title"))
        self.group_general.setTitle(self.i18n.tr("settings_general"))
        self.group_audio.setTitle(self.i18n.tr("settings_audio"))
        self.group_display.setTitle(self.i18n.tr("settings_display"))
        self.group_scheduler.setTitle(self.i18n.tr("settings_scheduler"))
        
        self.lbl_folder.setText(self.i18n.tr("settings_folder"))
        self.btn_browse.setText("📁 Browse" if self.i18n.lang == "en" else "📁 เลือกโฟลเดอร์")
        
        self.lbl_duck.setText(self.i18n.tr("settings_duck"))
        self.lbl_fade.setText(self.i18n.tr("settings_fade"))
        self.lbl_vu.setText(self.i18n.tr("settings_vu_mode"))
        self.lbl_timezone.setText(self.i18n.tr("settings_timezone"))
        
        if hasattr(self, 'combo_vu_mode'):
            self.combo_vu_mode.blockSignals(True)
            current_mode = self.combo_vu_mode.currentData()
            self.combo_vu_mode.clear()
            self.combo_vu_mode.addItem(self.i18n.tr("vu_mode_simulated"), "simulated")
            self.combo_vu_mode.addItem(self.i18n.tr("vu_mode_realtime"), "realtime")
            idx = self.combo_vu_mode.findData(current_mode)
            if idx >= 0:
                self.combo_vu_mode.setCurrentIndex(idx)
            self.combo_vu_mode.blockSignals(False)
            
        self.btn_save.setText(self.i18n.tr("settings_save"))

    def browse_folder(self):
        """Opens folder dialog to choose default path."""
        title = self.i18n.tr("dialog_select_dir") if self.i18n else "Select Default Directory"
        folder = QFileDialog.getExistingDirectory(self, title, self.input_folder.text())
        if folder:
            self.input_folder.setText(folder)

    def load_settings(self):
        """Loads configuration from JSON file and applies to widgets and AudioController."""
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.settings_data.update(data)
                logger.info(f"Loaded config settings from {self.config_path}.")
            except Exception as e:
                logger.error(f"Error loading settings file: {e}")
                
        # Update widgets
        self.input_folder.setText(self.settings_data.get("default_path", ""))
        duck = self.settings_data.get("duck_level", 20)
        self.slider_duck.setValue(duck)
        self.spin_duck.setValue(duck)
        self.spin_fade.setValue(int(self.settings_data.get("fade_out_duration", 2.0)))
        
        vu_mode = self.settings_data.get("vu_mode", "simulated")
        idx = self.combo_vu_mode.findData(vu_mode)
        if idx >= 0:
            self.combo_vu_mode.setCurrentIndex(idx)
            
        # Update timezone combo
        tz = self.settings_data.get("scheduler_timezone", "Asia/Bangkok")
        tz_idx = self.combo_timezone.findText(tz)
        if tz_idx >= 0:
            self.combo_timezone.setCurrentIndex(tz_idx)
        
        # Apply to AudioController
        self.controller.set_duck_multiplier(duck / 100.0)
        self.controller.set_vu_mode(vu_mode)

    def save_settings(self):
        """Writes current form settings to JSON file and applies to components."""
        self.settings_data["default_path"] = self.input_folder.text().strip()
        self.settings_data["duck_level"] = self.slider_duck.value()
        self.settings_data["fade_out_duration"] = float(self.spin_fade.value())
        self.settings_data["vu_mode"] = self.combo_vu_mode.currentData()
        self.settings_data["scheduler_timezone"] = self.combo_timezone.currentText()

        # Update actual controller
        self.controller.set_duck_multiplier(self.settings_data["duck_level"] / 100.0)
        self.controller.set_vu_mode(self.settings_data["vu_mode"])
        
        # Update actual scheduler timezone dynamically
        if self.parent() and hasattr(self.parent(), 'scheduler') and self.parent().scheduler:
            self.parent().scheduler.update_timezone(self.settings_data["scheduler_timezone"])

        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(self.settings_data, f, indent=4)
            title = self.i18n.tr("settings_saved_title") if self.i18n else "Settings Saved"
            msg = self.i18n.tr("settings_saved_msg") if self.i18n else "Global settings stored successfully."
            QMessageBox.information(self, title, msg)
            logger.info("Saved settings to disk.")
            self.accept()
        except Exception as e:
            title = self.i18n.tr("settings_save_err_title") if self.i18n else "Error Saving"
            QMessageBox.critical(self, title, f"{title}: {e}")
            logger.error(f"Failed to write configuration: {e}")

    def on_duck_slider_changed(self, val):
        """Updates controller duck multiplier in real-time when adjusting slider."""
        self.controller.set_duck_multiplier(val / 100.0)

    def on_vu_mode_changed(self, idx):
        mode = self.combo_vu_mode.itemData(idx)
        self.controller.set_vu_mode(mode)
