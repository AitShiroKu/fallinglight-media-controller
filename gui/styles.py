# Centralized QSS stylesheet for the School PR Media Controller application.
# Designed for a premium, dark-themed, crimson-accented workstation feel, matching FallingLight Media Controller reference project.

COLORS = {
    "bg_darkest": "#0d1117",
    "bg_dark": "#161b22",
    "bg_medium": "#1c2333",
    "bg_card": "#21283b",
    "bg_hover": "#2a3352",
    "bg_input": "#141a27",
    "border": "#2a3352",
    "border_focus": "#e94560",
    "text_primary": "#e6edf3",
    "text_secondary": "#8b949e",
    "text_muted": "#5a6270",
    "accent": "#e94560",
    "accent_hover": "#ff6b81",
    "accent_dark": "#b8354d",
    "accent_glow": "rgba(233, 69, 96, 0.3)",
    "success": "#3fb950",
    "warning": "#d29922",
    "info": "#58a6ff",
    "vu_green": "#3fb950",
    "vu_yellow": "#d29922",
    "vu_red": "#e94560",
    "scrollbar_bg": "#161b22",
    "scrollbar_handle": "#2a3352",
}

FONTS = {
    "family": "'Segoe UI', 'Noto Sans Thai', 'Tahoma', 'Outfit', 'Inter', -apple-system, sans-serif",
    "size_small": "11px",
    "size_normal": "13px",
    "size_large": "15px",
    "size_title": "20px",
    "size_hero": "28px",
}

DARK_STYLE_SHEET = f"""
/* Global Styles */
QMainWindow {{
    background-color: {COLORS['bg_darkest']};
    color: {COLORS['text_primary']};
    font-family: {FONTS['family']};
}}

QWidget {{
    color: {COLORS['text_primary']};
    font-family: {FONTS['family']};
    font-size: {FONTS['size_normal']};
}}

/* Dialogs */
QDialog {{
    background-color: {COLORS['bg_dark']};
    border: 1px solid {COLORS['border']};
    border-radius: 12px;
}}

/* Scroll Area & Sliders */
QScrollArea {{
    border: none;
    background-color: transparent;
}}

QScrollBar:vertical {{
    background-color: {COLORS['scrollbar_bg']};
    width: 8px;
    margin: 0px;
    border-radius: 4px;
}}

QScrollBar::handle:vertical {{
    background-color: {COLORS['scrollbar_handle']};
    min-height: 20px;
    border-radius: 4px;
}}

QScrollBar::handle:vertical:hover {{
    background-color: {COLORS['accent']};
}}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
}}

QScrollBar:horizontal {{
    background-color: {COLORS['scrollbar_bg']};
    height: 8px;
    margin: 0px;
    border-radius: 4px;
}}

QScrollBar::handle:horizontal {{
    background-color: {COLORS['scrollbar_handle']};
    min-width: 20px;
    border-radius: 4px;
}}

QScrollBar::handle:horizontal:hover {{
    background-color: {COLORS['accent']};
}}

QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
    width: 0px;
}}

/* Glassmorphic Cards / Frame Containers */
QFrame#card_panel, QGroupBox#card_panel {{
    background-color: {COLORS['bg_dark']};
    border: 1px solid {COLORS['border']};
    border-radius: 12px;
}}

QFrame#status_panel {{
    background-color: {COLORS['bg_medium']};
    border: 1px solid {COLORS['border']};
    border-radius: 10px;
}}

/* Group Box */
QGroupBox {{
    background-color: {COLORS['bg_dark']};
    border: 1px solid {COLORS['border']};
    border-radius: 8px;
    margin-top: 14px;
    padding-top: 14px;
    font-weight: bold;
    font-size: {FONTS['size_normal']};
}}

QGroupBox::title {{
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 2px 12px;
    color: {COLORS['text_secondary']};
}}

/* Splitter */
QSplitter::handle {{
    background-color: {COLORS['border']};
    width: 6px;
    height: 6px;
    border-radius: 3px;
    margin: 2px;
}}

QSplitter::handle:hover {{
    background-color: {COLORS['accent']};
}}
QSplitter::handle:pressed {{
    background-color: {COLORS['accent_dark']};
}}

/* Buttons */
QPushButton {{
    background-color: {COLORS['bg_card']};
    border: 1px solid {COLORS['border']};
    color: {COLORS['text_primary']};
    border-radius: 8px;
    padding: 8px 16px;
    font-weight: 600;
}}

QPushButton:hover {{
    background-color: {COLORS['bg_hover']};
    border-color: {COLORS['accent']};
}}

QPushButton:pressed {{
    background-color: {COLORS['accent_dark']};
    border-color: {COLORS['accent']};
}}

QPushButton:disabled {{
    background-color: {COLORS['bg_medium']};
    color: {COLORS['text_muted']};
    border-color: {COLORS['bg_medium']};
}}

/* Core Action Accent Buttons */
QPushButton#primary_action {{
    background-color: {COLORS['accent']};
    color: #ffffff;
    border: none;
    font-weight: bold;
}}

QPushButton#primary_action:hover {{
    background-color: {COLORS['accent_hover']};
}}

QPushButton#primary_action:pressed {{
    background-color: {COLORS['accent_dark']};
}}

QPushButton#accent_action {{
    background-color: {COLORS['info']};
    color: #ffffff;
    border: none;
    font-weight: bold;
}}

QPushButton#accent_action:hover {{
    background-color: #33C2FF;
}}

QPushButton#accent_action:pressed {{
    background-color: #0088CC;
}}

/* Alert/PR Mode Button toggled state */
QPushButton#mic_duck_button {{
    background-color: {COLORS['bg_card']};
    border: 2px solid {COLORS['warning']};
    color: {COLORS['warning']};
}}

QPushButton#mic_duck_button:hover {{
    background-color: rgba(210, 153, 34, 0.15);
}}

QPushButton#mic_duck_button:checked {{
    background-color: {COLORS['warning']};
    color: {COLORS['bg_darkest']};
    border: 2px solid {COLORS['warning']};
}}

/* Input Fields & Spin Boxes & ComboBoxes */
QLineEdit, QAbstractSpinBox, QComboBox, QTimeEdit, QDateEdit, QDateTimeEdit {{
    background-color: {COLORS['bg_input']};
    border: 1px solid {COLORS['border']};
    border-radius: 6px;
    padding: 6px 12px;
    color: {COLORS['text_primary']};
}}

QLineEdit:focus, QAbstractSpinBox:focus, QComboBox:focus, QTimeEdit:focus, QDateEdit:focus {{
    border: 1px solid {COLORS['accent']};
}}

/* Custom SpinBox buttons styling */
QAbstractSpinBox::up-button {{
    subcontrol-origin: border;
    subcontrol-position: top right;
    width: 18px;
    background-color: {COLORS['bg_card']};
    border-left: 1px solid {COLORS['border']};
    border-bottom: 1px solid {COLORS['border']};
    border-top-right-radius: 5px;
}}

QAbstractSpinBox::up-button:hover {{
    background-color: {COLORS['bg_hover']};
}}

QAbstractSpinBox::up-button:pressed {{
    background-color: {COLORS['bg_input']};
}}

QAbstractSpinBox::down-button {{
    subcontrol-origin: border;
    subcontrol-position: bottom right;
    width: 18px;
    background-color: {COLORS['bg_card']};
    border-left: 1px solid {COLORS['border']};
    border-bottom-right-radius: 5px;
}}

QAbstractSpinBox::down-button:hover {{
    background-color: {COLORS['bg_hover']};
}}

QAbstractSpinBox::down-button:pressed {{
    background-color: {COLORS['bg_input']};
}}

QAbstractSpinBox::up-arrow {{
    image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><path fill='%23E2E2E9' d='M4 0h2v4h4v2H6v4H4V6H0V4h4z'/></svg>");
    width: 10px;
    height: 10px;
}}

QAbstractSpinBox::down-arrow {{
    image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><path fill='%23E2E2E9' d='M0 4h10v2H0z'/></svg>");
    width: 10px;
    height: 10px;
}}

/* Table Widget specific SpinBox styling to fit row heights */
QTableWidget QAbstractSpinBox {{
    background-color: {COLORS['bg_input']};
    border: 1px solid {COLORS['border']};
    padding: 2px;
    padding-right: 20px;
    border-radius: 4px;
}}

/* Check Boxes */
QCheckBox {{
    background-color: transparent;
    spacing: 8px;
}}

QCheckBox::indicator {{
    width: 18px;
    height: 18px;
    border: 2px solid {COLORS['border']};
    border-radius: 4px;
    background-color: {COLORS['bg_input']};
}}

QCheckBox::indicator:checked {{
    background-color: {COLORS['accent']};
    border-color: {COLORS['accent']};
}}

QCheckBox::indicator:hover {{
    border-color: {COLORS['accent']};
}}

/* Generic Slider Controls (e.g., Volume) */
QSlider::groove:horizontal {{
    height: 4px;
    background: {COLORS['bg_medium']};
    border-radius: 2px;
}}

QSlider::sub-page:horizontal {{
    background: {COLORS['accent']};
    border-radius: 2px;
}}

QSlider::handle:horizontal {{
    background: #FFFFFF;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    margin-bottom: -4px;
    border-radius: 6px;
}}

QSlider::handle:horizontal:hover {{
    background: {COLORS['accent_hover']};
    border: 2px solid #FFFFFF;
}}

/* Specific styling for the Main Progress Bar */
QSlider#progress_bar::groove:horizontal {{
    height: 6px;
    background: {COLORS['bg_medium']};
    border-radius: 3px;
}}

QSlider#progress_bar::sub-page:horizontal {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                                stop:0 {COLORS['accent']}, 
                                stop:1 {COLORS['accent_hover']});
    border-radius: 3px;
}}

QSlider#progress_bar::handle:horizontal {{
    background: #FFFFFF;
    border: 2px solid {COLORS['accent']};
    width: 16px;
    height: 16px;
    margin-top: -5px;
    margin-bottom: -5px;
    border-radius: 8px;
}}

QSlider#progress_bar::handle:horizontal:hover {{
    background: {COLORS['accent']};
    border: 2px solid #FFFFFF;
}}

/* Tabs Styling */
QTabWidget::pane {{
    border: 1px solid {COLORS['border']};
    background-color: {COLORS['bg_dark']};
    border-radius: 12px;
    top: -1px;
}}

QTabBar::tab {{
    background-color: {COLORS['bg_medium']};
    border: 1px solid {COLORS['border']};
    border-bottom-color: transparent;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    padding: 8px 16px;
    margin-right: 4px;
    color: {COLORS['text_secondary']};
    font-weight: 600;
}}

QTabBar::tab:hover {{
    background-color: {COLORS['bg_hover']};
    color: {COLORS['text_primary']};
}}

QTabBar::tab:selected {{
    background-color: {COLORS['bg_dark']};
    color: {COLORS['accent']};
    border-bottom: 2px solid {COLORS['accent']};
}}

/* Playlist & List widgets */
QListWidget {{
    background-color: {COLORS['bg_dark']};
    border: 1px solid {COLORS['border']};
    border-radius: 8px;
    padding: 5px;
}}

QListWidget::item {{
    border-bottom: 1px solid {COLORS['border']};
    padding: 8px;
    border-radius: 6px;
}}

QListWidget::item:selected {{
    background-color: {COLORS['bg_hover']};
    color: {COLORS['accent']};
    border-left: 3px solid {COLORS['accent']};
}}

QListWidget::item:hover {{
    background-color: {COLORS['bg_hover']};
}}

/* Table Widget styling */
QTableWidget {{
    background-color: {COLORS['bg_dark']};
    alternate-background-color: {COLORS['bg_medium']};
    border: 1px solid {COLORS['border']};
    gridline-color: {COLORS['border']};
    border-radius: 8px;
}}

QTableWidget::item {{
    padding: 6px;
    border-bottom: 1px solid {COLORS['border']};
}}

QTableWidget::item:selected {{
    background-color: {COLORS['accent_glow']};
    color: {COLORS['text_primary']};
}}

QHeaderView::section {{
    background-color: {COLORS['bg_medium']};
    color: {COLORS['text_secondary']};
    padding: 6px;
    border: none;
    border-bottom: 2px solid {COLORS['accent']};
    font-weight: bold;
}}

/* Headers / Labels */
QLabel#header_label {{
    font-size: 18px;
    font-weight: bold;
    color: #FFFFFF;
}}

QLabel#subheader_label {{
    font-size: 12px;
    color: {COLORS['text_secondary']};
}}

QLabel#timer_display {{
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 16px;
    font-weight: bold;
    color: {COLORS['success']};
}}

/* VU Meter Progress Bars */
QProgressBar#vu_bar {{
    background-color: {COLORS['bg_input']};
    border: 1px solid {COLORS['border']};
    border-radius: 3px;
    text-align: center;
}}

QProgressBar#vu_bar::chunk {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                                stop:0 {COLORS['vu_green']},
                                stop:0.7 {COLORS['vu_yellow']},
                                stop:1.0 {COLORS['vu_red']});
    border-radius: 2px;
}}

/* Menu */
QMenu {{
    background-color: {COLORS['bg_card']};
    color: {COLORS['text_primary']};
    border: 1px solid {COLORS['border']};
    border-radius: 8px;
    padding: 4px 0;
}}

QMenu::item {{
    padding: 8px 24px;
}}

QMenu::item:selected {{
    background-color: {COLORS['accent']};
    color: #ffffff;
}}

QMenu::separator {{
    height: 1px;
    background-color: {COLORS['border']};
    margin: 4px 8px;
}}

/* Status Bar */
QStatusBar {{
    background-color: {COLORS['bg_medium']};
    color: {COLORS['text_secondary']};
    border-top: 1px solid {COLORS['border']};
    padding: 4px 8px;
}}
"""
