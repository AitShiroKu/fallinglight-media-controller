from PySide6.QtWidgets import QWidget, QHBoxLayout, QVBoxLayout, QLabel
from PySide6.QtCore import Qt, QTimer, Slot
from PySide6.QtGui import QPainter, QColor, QPen
import math

class LEDVUBar(QWidget):
    """
    Custom widget that draws a premium, hardware-style LED segment volume meter.
    Includes peak-hold indicator and organic decay physics.
    """
    def __init__(self, orientation=Qt.Horizontal, parent=None):
        super().__init__(parent)
        self.orientation = orientation
        self.value = 0.0          # Current level (0 to 100)
        self.peak = 0.0           # Peak level (0 to 100)
        self.peak_hold_ticks = 0  # Cycles before peak begins to fall
        
        # Physics constants
        self.decay_rate = 3.0     # Value decay speed
        self.peak_decay = 1.0     # Peak decay speed
        self.num_leds = 18        # Number of segments
        
        # Timer to run physics decay at 30 FPS
        self.physics_timer = QTimer(self)
        self.physics_timer.setInterval(33)
        self.physics_timer.timeout.connect(self._process_decay)
        self.physics_timer.start()

    def set_value(self, val):
        """Sets the new target volume level, updating peaks."""
        val = float(max(0.0, min(100.0, val)))
        
        # If new value is higher than current, jump instantly to make it punchy
        if val > self.value:
            self.value = val
        else:
            # Let the physics timer decay it smoothly
            pass

        # Update peak holds
        if val > self.peak:
            self.peak = val
            self.peak_hold_ticks = 15 # hold peak for ~500ms
        
        self.update()

    def _process_decay(self):
        """Ticks down values and peaks based on spring decay physics."""
        # Smoothly decay the current level
        if self.value > 0:
            self.value = max(0.0, self.value - self.decay_rate)
            
        # Handle peak hold duration and decay
        if self.peak_hold_ticks > 0:
            self.peak_hold_ticks -= 1
        elif self.peak > 0:
            self.peak = max(0.0, self.peak - self.peak_decay)
            
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        width = self.width()
        height = self.height()
        
        # Color mapping for LED segments:
        # Green: 0% - 60%
        # Yellow/Orange: 60% - 85%
        # Red: 85% - 100%
        green_zone = int(self.num_leds * 0.6)
        yellow_zone = int(self.num_leds * 0.85)

        # Draw LED segments
        if self.orientation == Qt.Horizontal:
            led_width = (width - (self.num_leds - 1) * 2) / self.num_leds
            for i in range(self.num_leds):
                # Calculate color for this segment
                color = self._get_led_color(i, green_zone, yellow_zone, active=True)
                dim_color = self._get_led_color(i, green_zone, yellow_zone, active=False)
                
                # Check if active
                segment_threshold = (i / self.num_leds) * 100.0
                is_active = self.value >= segment_threshold
                
                # Draw LED rectangle
                x = i * (led_width + 2)
                painter.fillRect(int(x), 0, int(led_width), height, color if is_active else dim_color)
                
                # Draw Peak line
                is_peak = abs(self.peak - segment_threshold) < (100.0 / self.num_leds)
                if is_peak and self.peak > 0:
                    painter.fillRect(int(x), 0, int(led_width), height, QColor("#FFD600"))
        else:
            # Vertical orientation
            led_height = (height - (self.num_leds - 1) * 2) / self.num_leds
            for i in range(self.num_leds):
                # In vertical meters, index 0 is at the bottom, so invert rendering loop
                inverted_idx = self.num_leds - 1 - i
                color = self._get_led_color(inverted_idx, green_zone, yellow_zone, active=True)
                dim_color = self._get_led_color(inverted_idx, green_zone, yellow_zone, active=False)
                
                segment_threshold = (inverted_idx / self.num_leds) * 100.0
                is_active = self.value >= segment_threshold
                
                y = i * (led_height + 2)
                painter.fillRect(0, int(y), width, int(led_height), color if is_active else dim_color)
                
                is_peak = abs(self.peak - segment_threshold) < (100.0 / self.num_leds)
                if is_peak and self.peak > 0:
                    painter.fillRect(0, int(y), width, int(led_height), QColor("#FFD600"))

    def _get_led_color(self, index, green, yellow, active=True):
        """Returns active (bright) or inactive (dim) color for a segment index."""
        if index < green:
            return QColor("#00E676") if active else QColor("#053E24")  # Green
        elif index < yellow:
            return QColor("#FFD600") if active else QColor("#3E3500")  # Yellow/Orange
        else:
            return QColor("#FF1744") if active else QColor("#430612")  # Red


class StereoVUMeter(QWidget):
    """
    Main stereo VU meter widget displaying separate Left and Right channels.
    Includes a label prefix and channel indicators.
    """
    def __init__(self, orientation=Qt.Horizontal, parent=None):
        super().__init__(parent)
        self.orientation = orientation
        self.init_ui()

    def init_ui(self):
        # Select layout based on orientation
        if self.orientation == Qt.Horizontal:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(6)
            
            # Left channel Row
            left_row = QHBoxLayout()
            left_row.setSpacing(6)
            self.lbl_l = QLabel("L")
            self.lbl_l.setFixedWidth(12)
            self.lbl_l.setStyleSheet("color: #8E8E9F; font-weight: bold;")
            self.bar_l = LEDVUBar(Qt.Horizontal)
            self.bar_l.setFixedHeight(12)
            
            left_row.addWidget(self.lbl_l)
            left_row.addWidget(self.bar_l)
            
            # Right channel Row
            right_row = QHBoxLayout()
            right_row.setSpacing(6)
            self.lbl_r = QLabel("R")
            self.lbl_r.setFixedWidth(12)
            self.lbl_r.setStyleSheet("color: #8E8E9F; font-weight: bold;")
            self.bar_r = LEDVUBar(Qt.Horizontal)
            self.bar_r.setFixedHeight(12)
            
            right_row.addWidget(self.lbl_r)
            right_row.addWidget(self.bar_r)
            
            layout.addLayout(left_row)
            layout.addLayout(right_row)
        else:
            layout = QHBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(12)
            
            # Left channel Column
            left_col = QVBoxLayout()
            left_col.setSpacing(4)
            self.bar_l = LEDVUBar(Qt.Vertical)
            self.lbl_l = QLabel("L")
            self.lbl_l.setAlignment(Qt.AlignCenter)
            self.lbl_l.setStyleSheet("color: #8E8E9F; font-weight: bold;")
            left_col.addWidget(self.bar_l)
            left_col.addWidget(self.lbl_l)
            
            # Right channel Column
            right_col = QVBoxLayout()
            right_col.setSpacing(4)
            self.bar_r = LEDVUBar(Qt.Vertical)
            self.lbl_r = QLabel("R")
            self.lbl_r.setAlignment(Qt.AlignCenter)
            self.lbl_r.setStyleSheet("color: #8E8E9F; font-weight: bold;")
            right_col.addWidget(self.bar_r)
            right_col.addWidget(self.lbl_r)
            
            layout.addLayout(left_col)
            layout.addLayout(right_col)

    @Slot(int, int)
    def update_levels(self, left, right):
        """Slot to receive direct Left/Right values (0-100) and update meters."""
        self.bar_l.set_value(left)
        self.bar_r.set_value(right)
