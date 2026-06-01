import os
import time
import logging
import yt_dlp
from PySide6.QtCore import QObject, Signal, QTimer, QThread

try:
    import sounddevice as sd
    import numpy as np
    SD_AVAILABLE = True
except ImportError:
    SD_AVAILABLE = False

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("AudioController")

# Try to import vlc
VLC_AVAILABLE = False
try:
    import vlc
    VLC_AVAILABLE = True
    logger.info("VLC successfully imported.")
except ImportError:
    logger.warning("VLC library not found. Running in SIMULATED playback mode.")
    vlc = None

class YoutubeResolverThread(QThread):
    """
    Background thread to resolve YouTube URLs to stream URLs using yt-dlp.
    """
    resolved = Signal(dict)  # Emits metadata dict on success
    failed = Signal(str, str)  # Emits (original_url, error_message) on failure

    def __init__(self, url):
        super().__init__()
        self.url = url

    def run(self):
        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extract_flat': False,
        }
        try:
            logger.info(f"Resolving YouTube URL: {self.url}")
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(self.url, download=False)
                # Check if it's a playlist or single video
                if 'entries' in info:
                    # If playlist, take the first entry
                    entries = list(info['entries'])
                    if not entries:
                        raise Exception("Empty YouTube playlist.")
                    entry = entries[0]
                    title = entry.get('title', 'Unknown YouTube Video')
                    stream_url = entry.get('url', None)
                    duration = entry.get('duration', 0)
                else:
                    title = info.get('title', 'Unknown YouTube Video')
                    # Find direct stream url
                    stream_url = info.get('url', None)
                    duration = info.get('duration', 0)

                if not stream_url:
                    raise Exception("Could not retrieve stream URL from yt-dlp info.")

                metadata = {
                    'original_url': self.url,
                    'stream_url': stream_url,
                    'title': title,
                    'duration': duration, # in seconds
                }
                logger.info(f"Resolved URL to stream: {title}")
                self.resolved.emit(metadata)
        except Exception as e:
            error_str = str(e)
            logger.error(f"Failed to resolve YouTube URL {self.url}: {error_str}")
            self.failed.emit(self.url, error_str)


class AudioController(QObject):
    """
    Controls VLC playback, manages the playlist queue, and handles
    audio dynamics (fade-out, mic ducking/unducking) and background YouTube resolution.
    """
    # Signals for GUI updates
    state_changed = Signal(str)            # Playing, Paused, Stopped, Buffering, Ended
    track_changed = Signal(dict)            # Current track metadata
    playlist_updated = Signal(list)         # Entire list of tracks
    volume_changed = Signal(int)            # Current absolute volume (0-100)
    duck_state_changed = Signal(bool)       # True if mic mode is active
    position_changed = Signal(float, int)   # (progress_ratio [0-1], time_ms)
    error_occurred = Signal(str)            # Error message for status bar

    def __init__(self):
        super().__init__()
        
        self.playlist = []  # List of dicts: {path, title, duration, loop_count, remaining_loops}
        self.current_index = -1
        
        # Audio Settings
        self.master_volume = 80             # User desired volume (0-100)
        self.current_volume = 80.0          # Actual physical volume (float for smooth transitions)
        self.duck_multiplier = 0.2          # Duck to 20% of master volume
        self.is_ducked = False              # Toggle for mic mode
        self.fade_out_active = False        # Track if currently fading out

        # VU Meter Config
        self.vu_mode = "simulated"          # 'simulated' or 'realtime'
        self.real_vu_l = 0.0
        self.real_vu_r = 0.0
        self.audio_stream = None
        
        if SD_AVAILABLE:
            self._init_audio_analyzer()

        # VLC Instance setup
        self.instance = None
        self.player = None
        
        if VLC_AVAILABLE:
            try:
                # Add command line args for VLC
                # --no-video if we only want audio, but we support video streaming too
                self.instance = vlc.Instance("--quiet", "--no-xlib")
                self.player = self.instance.media_player_new()
            except Exception as e:
                logger.error(f"Failed to initialize VLC instance: {e}. Falling back to simulation.")
                self.player = None

        # Simulation states (if VLC is not available)
        self.sim_playing = False
        self.sim_duration = 180.0
        self.sim_position = 0.0

        # High-resolution dynamic timer for volume fades and ducking (runs at 30ms interval)
        self.dynamics_timer = QTimer(self)
        self.dynamics_timer.setInterval(30)
        self.dynamics_timer.timeout.connect(self._process_volume_dynamics)
        self.dynamics_timer.start()

        # Regular status updates (runs at 250ms interval)
        self.status_timer = QTimer(self)
        self.status_timer.setInterval(250)
        self.status_timer.timeout.connect(self._update_playback_status)
        self.status_timer.start()

        # YouTube resolvers list to prevent garbage collection
        self.resolvers = []

    # --- Playlist management ---

    def add_track(self, path, title=None, duration=0, loop_count=1):
        """Adds a track to the playlist queue."""
        if not title:
            title = os.path.basename(path) if not path.startswith("http") else path
            
        track = {
            'path': path,
            'title': title,
            'duration': duration,
            'loop_count': loop_count,
            'remaining_loops': loop_count,
            'resolved_path': path if not path.startswith("http") else None
        }
        self.playlist.append(track)
        self.playlist_updated.emit(self.playlist)
        logger.info(f"Added track: {title} (Loops: {loop_count})")
        
        # If no track is currently playing and we just added the first track, highlight it
        if self.current_index == -1:
            self.current_index = 0
            self.track_changed.emit(self.playlist[self.current_index])

    def remove_track(self, index):
        """Removes a track from the playlist."""
        if 0 <= index < len(self.playlist):
            removed = self.playlist.pop(index)
            logger.info(f"Removed track: {removed['title']}")
            
            # Adjust current index
            if self.current_index == index:
                # If removing the playing track, stop first
                self.stop()
                if len(self.playlist) > 0:
                    self.current_index = min(index, len(self.playlist) - 1)
                    self.track_changed.emit(self.playlist[self.current_index])
                else:
                    self.current_index = -1
            elif self.current_index > index:
                self.current_index -= 1
                
            self.playlist_updated.emit(self.playlist)

    def reorder_playlist(self, from_idx, to_idx):
        """Reorders tracks within the playlist."""
        if 0 <= from_idx < len(self.playlist) and 0 <= to_idx < len(self.playlist):
            # Save the currently playing track path to re-align current_index after move
            playing_track = self.playlist[self.current_index] if self.current_index != -1 else None
            
            track = self.playlist.pop(from_idx)
            self.playlist.insert(to_idx, track)
            
            if playing_track:
                self.current_index = self.playlist.index(playing_track)
                
            self.playlist_updated.emit(self.playlist)

    def update_loop_count(self, index, loop_count):
        """Updates loop count for a specific track."""
        if 0 <= index < len(self.playlist):
            self.playlist[index]['loop_count'] = loop_count
            self.playlist[index]['remaining_loops'] = loop_count
            self.playlist_updated.emit(self.playlist)
            logger.info(f"Updated loop count for '{self.playlist[index]['title']}' to {loop_count}")

    # --- Media Playback controls ---

    def play_index(self, index, fade=True):
        """Plays a track at a specific index, optionally fading out the current one."""
        if fade and self.is_active() and self.current_index != index:
            self.fade_out_active = True
            self.fade_action = lambda: self._execute_play_index(index)
            return
        self._execute_play_index(index)

    def _execute_play_index(self, index):
        self.fade_out_active = False
        target = min(self.master_volume, self.duck_multiplier * 100.0) if self.is_ducked else self.master_volume
        self.current_volume = float(target)
        if self.player: self.player.audio_set_volume(int(self.current_volume))
        
        if 0 <= index < len(self.playlist):
            self.current_index = index
            track = self.playlist[self.current_index]
            track['remaining_loops'] = track['loop_count']
            
            if track['path'].startswith(("http://youtube.com", "https://youtube.com", "http://youtu.be", "https://youtu.be", "https://www.youtube.com")):
                if not track['resolved_path']:
                    self._resolve_youtube_and_play(track)
                    return
            
            self._play_track(track)
        else:
            self.stop()

    def _resolve_youtube_and_play(self, track):
        """Launches a thread to resolve YouTube URL and then plays it."""
        self.state_changed.emit("Buffering")
        resolver = YoutubeResolverThread(track['path'])
        
        def on_resolved(metadata):
            track['resolved_path'] = metadata['stream_url']
            track['title'] = metadata['title']
            track['duration'] = metadata['duration']
            self.playlist_updated.emit(self.playlist)
            
            # If the index hasn't changed while we were resolving, play it
            if self.playlist[self.current_index] == track:
                self._play_track(track)
            self.resolvers.remove(resolver)

        def on_failed(url, error):
            self.error_occurred.emit(f"YouTube resolve failed: {error}")
            self.state_changed.emit("Stopped")
            self.resolvers.remove(resolver)

        resolver.resolved.connect(on_resolved)
        resolver.failed.connect(on_failed)
        self.resolvers.append(resolver)
        resolver.start()

    def _play_track(self, track):
        """Directly starts playing a track after resolving path/URL."""
        self.track_changed.emit(track)
        path = track['resolved_path'] if track['resolved_path'] else track['path']
        
        # Reset visual state & start playback
        self.fade_out_active = False
        
        # Start volume at 0.0 so it smoothly fades up to the target volume.
        # This resolves the VLC asynchronous initialization issue where setting volume
        # immediately after play() is ignored because the audio channel is not yet open.
        self.current_volume = 0.0
        
        if self.player:
            try:
                # Load media
                if path.startswith(("http://", "https://", "file://")):
                    media = self.instance.media_new(path)
                else:
                    media = self.instance.media_new_path(path)
                self.player.set_media(media)
                self.player.play()
                self.player.audio_set_volume(int(self.current_volume))
                self.state_changed.emit("Playing")
                logger.info(f"VLC Playing: {track['title']}")
            except Exception as e:
                self.error_occurred.emit(f"VLC Play Error: {e}")
                self.state_changed.emit("Stopped")
        else:
            # Simulated player mode
            self.sim_playing = True
            self.sim_duration = track['duration'] if track['duration'] > 0 else 180.0
            self.sim_position = 0.0
            self.state_changed.emit("Playing")
            logger.info(f"Simulating Play: {track['title']}")

        self.volume_changed.emit(int(self.current_volume))

    def play(self):
        """Resumes current track or plays from the beginning of playlist."""
        if self.current_index == -1 and len(self.playlist) > 0:
            self.play_index(0)
            return

        if self.player:
            state = self.player.get_state()
            if state == vlc.State.Paused:
                target = min(self.master_volume, self.duck_multiplier * 100.0) if self.is_ducked else self.master_volume
                self.current_volume = float(target)
                self.player.audio_set_volume(int(self.current_volume))
                self.volume_changed.emit(int(self.current_volume))
                
                self.player.play()
                self.state_changed.emit("Playing")
            elif state in (vlc.State.Stopped, vlc.State.Ended, vlc.State.Error):
                self.play_index(self.current_index, fade=False)
        else:
            if len(self.playlist) > 0:
                self.sim_playing = True
                self.state_changed.emit("Playing")

    def pause(self):
        """Pauses current playback."""
        if self.player:
            self.player.pause()
            self.state_changed.emit("Paused")
        else:
            self.sim_playing = False
            self.state_changed.emit("Paused")

    def pause_with_fade(self):
        """Smoothly fades out and then pauses playback."""
        if not self.is_active():
            self.pause()
            return
        logger.info("Initiating smooth fade-out pause...")
        self.fade_out_active = True
        self.fade_action = self._execute_pause

    def _execute_pause(self):
        self.fade_out_active = False
        self.pause()

    def stop_with_fade(self):
        """Smoothly fades out and then stops playback."""
        if not self.is_active():
            return
            
        logger.info("Initiating smooth fade-out stop...")
        self.fade_out_active = True
        self.fade_action = self._execute_stop

    def skip_with_fade(self):
        """Smoothly fades out and then skips to the next track."""
        if not self.is_active():
            return
            
        logger.info("Initiating smooth fade-out skip...")
        self.fade_out_active = True
        self.fade_action = self._execute_next

    def _execute_stop(self):
        """Stops player and resets volume to normal levels."""
        if self.player:
            self.player.stop()
        else:
            self.sim_playing = False
            self.sim_position = 0.0
            
        self.state_changed.emit("Stopped")
        self.fade_out_active = False
        
        # Reset current volume back to user target so it's ready for next playback
        target = min(self.master_volume, self.duck_multiplier * 100.0) if self.is_ducked else self.master_volume
        self.current_volume = float(target)
        if self.player:
            self.player.audio_set_volume(int(self.current_volume))
        self.volume_changed.emit(int(self.current_volume))
        logger.info("Stop completed.")

    def _execute_next(self):
        """Advances to next track or wraps around."""
        self.fade_out_active = False
        if len(self.playlist) == 0:
            self.stop()
            return
            
        next_idx = (self.current_index + 1) % len(self.playlist)
        logger.info(f"Skipping to track index {next_idx}")
        self.play_index(next_idx, fade=False)

    def stop(self):
        """Instant stop without fade."""
        self._execute_stop()

    def prev_with_fade(self):
        """Smoothly fades out and goes to previous track."""
        if not self.is_active():
            self.prev()
            return
        logger.info("Initiating smooth fade-out prev...")
        self.fade_out_active = True
        self.fade_action = self._execute_prev

    def _execute_prev(self):
        self.fade_out_active = False
        if len(self.playlist) == 0: return
        prev_idx = (self.current_index - 1 + len(self.playlist)) % len(self.playlist)
        self.play_index(prev_idx, fade=False)

    def prev(self):
        """Goes to previous track instantly."""
        if len(self.playlist) == 0:
            return
            
        prev_idx = (self.current_index - 1 + len(self.playlist)) % len(self.playlist)
        self.play_index(prev_idx, fade=False)

    def next(self):
        """Goes to next track instantly."""
        self._execute_next()

    def seek(self, ratio):
        """Seeks to a percentage ratio (0.0 to 1.0) of track duration."""
        if not self.is_active():
            return
            
        if self.player:
            self.player.set_position(ratio)
        else:
            self.sim_position = ratio * self.sim_duration
            
        self._update_playback_status()

    # --- Audio Dynamics: Ducking and Volume Fades ---

    def set_master_volume(self, val):
        """Sets the master user volume level (0-100)."""
        self.master_volume = max(0, min(100, val))
        # If not ducking/fading, volume follows master instantly for responsiveness
        if not self.is_ducked and not self.fade_out_active:
            self.current_volume = float(self.master_volume)
            if self.player:
                self.player.audio_set_volume(int(self.current_volume))
            self.volume_changed.emit(int(self.current_volume))

    def set_duck_multiplier(self, value):
        """Sets how deep the ducking drops the volume (e.g. 0.15 = 15%)."""
        self.duck_multiplier = max(0.0, min(1.0, value))
        # Re-evaluate volume target if currently ducked
        if self.is_ducked and not self.fade_out_active:
            # Dynamically recalculate target
            pass

    def toggle_mic_duck(self, enabled):
        """Enables or disables Mic Ducking mode."""
        self.is_ducked = enabled
        self.duck_state_changed.emit(self.is_ducked)
        logger.info(f"Mic Ducking: {'ENABLED' if enabled else 'DISABLED'}")

    def _process_volume_dynamics(self):
        """
        Runs every 30ms. Interpolates current_volume to target volume.
        Ensures low CPU usage and zero blocking.
        """
        if not self.is_active() and not self.fade_out_active:
            return

        # Calculate target volume based on states
        if self.fade_out_active:
            target_volume = 0.0
        elif self.is_ducked:
            target_volume = min(float(self.master_volume), self.duck_multiplier * 100.0)
        else:
            target_volume = float(self.master_volume)

        # Skip adjustments if we've arrived
        arrived = abs(self.current_volume - target_volume) < 0.5
        
        if arrived:
            if self.current_volume != target_volume:
                self.current_volume = target_volume
                self.volume_changed.emit(int(self.current_volume))
                
            if self.fade_out_active and self.current_volume <= 0.5:
                # Finished fade-out, execute action
                if self.fade_action:
                    action = self.fade_action
                    self.fade_action = None
                    action()
        else:
            # Determine steps:
            diff = target_volume - self.current_volume
            if self.fade_out_active:
                # Linear/exponential step down
                step = max(3.0, (self.current_volume / 8.0))
                self.current_volume = max(0.0, self.current_volume - step)
            elif diff < 0:
                # Ducking: Rapid descent
                step = abs(diff) / 4.0
                self.current_volume = max(target_volume, self.current_volume - step)
            else:
                # Unducking: Smooth ascent
                step = diff / 15.0
                self.current_volume = min(target_volume, self.current_volume + step)
            
            self.volume_changed.emit(int(self.current_volume))

        # Always apply to player to fix VLC asynchronous startup issues
        # where volume changes are ignored while 'Opening'
        if self.player and self.is_active():
            self.player.audio_set_volume(int(self.current_volume))
            
    # --- Status and updates ---

    def is_active(self):
        """Checks if a track is actively playing or paused."""
        if self.player:
            state = self.player.get_state()
            return state in (vlc.State.Playing, vlc.State.Paused, vlc.State.Buffering)
        return self.sim_playing

    def get_vu_levels(self):
        """
        Returns estimated stereo VU levels (Left, Right) in range 0-100.
        Called by the visualizer.
        """
        if not self.is_active():
            return 0.0, 0.0
            
        vol_factor = self.current_volume / 100.0

        if self.vu_mode == "realtime" and self.audio_stream:
            # Scale raw system audio capture by internal app volume factor
            left = self.real_vu_l * vol_factor * 2.0
            right = self.real_vu_r * vol_factor * 2.0
            return max(0, min(100, int(left))), max(0, min(100, int(right)))
        
        # Simulation of stereo channels based on timestamp
        t = time.time()
        # Left channel base oscillator + fast variation
        left = 40 + 35 * (0.6 * os.sys.float_info.epsilon + 0.4 * (
            0.5 * time.time() % 1.0 + 
            0.3 * (t * 4.5 % 1) + 
            0.2 * (t * 9.2 % 1)
        ))
        # Right channel slightly offset
        right = 40 + 35 * (0.6 * os.sys.float_info.epsilon + 0.4 * (
            0.5 * (time.time() + 0.2) % 1.0 + 
            0.3 * ((t + 0.1) * 3.8 % 1) + 
            0.2 * ((t + 0.05) * 8.5 % 1)
        ))
        
        # Modulate VU level slightly by adding high frequencies to look like beat detection
        import math
        beat = abs(math.sin(t * 2.0 * math.pi * 1.8))  # 108 BPM approx
        left = (left * 0.7 + beat * 30) * vol_factor
        right = (right * 0.7 + beat * 30) * vol_factor
        
        # Clamp between 0 and 100
        return max(0, min(100, int(left))), max(0, min(100, int(right)))

    def _update_playback_status(self):
        """Queries VLC player state and emits update signals for GUI widgets."""
        if not self.is_active():
            # If not active, but VLC reached end of track
            if self.player and self.player.get_state() == vlc.State.Ended:
                self._handle_track_ended()
            return

        if self.player:
            pos = self.player.get_position()
            duration_ms = self.player.get_length()
            time_ms = self.player.get_time()
            
            # VLC may return -1 for length on streams
            if duration_ms <= 0 and self.current_index != -1:
                duration_ms = self.playlist[self.current_index]['duration'] * 1000
                
            self.position_changed.emit(pos, time_ms)
            
            state = self.player.get_state()
            state_str = "Playing"
            if state == vlc.State.Paused:
                state_str = "Paused"
            elif state == vlc.State.Buffering:
                state_str = "Buffering"
            self.state_changed.emit(state_str)
        else:
            # Simulated player progress update
            if self.sim_playing:
                self.sim_position += 0.25 # status_timer is 250ms
                if self.sim_position >= self.sim_duration:
                    self.sim_position = self.sim_duration
                    self.sim_playing = False
                    self._handle_track_ended()
                else:
                    ratio = self.sim_position / self.sim_duration
                    self.position_changed.emit(ratio, int(self.sim_position * 1000))
                    self.state_changed.emit("Playing")

    def _handle_track_ended(self):
        """Processes track end. Handles track repeating, loops, and playlist queue advance."""
        if self.current_index == -1:
            return

        track = self.playlist[self.current_index]
        
        # Handle track loop counts
        # loop_count of -1 indicates infinite looping
        if track['loop_count'] == -1:
            logger.info(f"Looping track '{track['title']}' (Infinite Loop)")
            self._play_track(track)
            return
            
        if track['remaining_loops'] > 1:
            track['remaining_loops'] -= 1
            logger.info(f"Looping track '{track['title']}' ({track['remaining_loops']} loops left)")
            self.playlist_updated.emit(self.playlist)
            self._play_track(track)
            return

        # If loops are exhausted or set to 1, advance to next track
        track['remaining_loops'] = track['loop_count'] # Reset for future plays
        self.playlist_updated.emit(self.playlist)
        
        next_idx = self.current_index + 1
        if next_idx < len(self.playlist):
            logger.info(f"Track finished. Advancing to next: index {next_idx}")
            self.play_index(next_idx)
        else:
            logger.info("Playlist queue completed.")
            self.stop()

    def _init_audio_analyzer(self):
        """Initializes a background thread to capture system audio for Real-Time VU Meter."""
        if not SD_AVAILABLE: return
        try:
            self.audio_stream = sd.InputStream(callback=self._audio_callback, blocksize=2048)
            self.audio_stream.start()
        except Exception as e:
            logger.warning(f"Could not start sounddevice for Real-Time VU: {e}")
            self.audio_stream = None

    def _audio_callback(self, indata, frames, time, status):
        if status: return
        try:
            if indata.shape[1] >= 2:
                self.real_vu_l = np.sqrt(np.mean(indata[:, 0]**2)) * 1000.0
                self.real_vu_r = np.sqrt(np.mean(indata[:, 1]**2)) * 1000.0
            else:
                m = np.sqrt(np.mean(indata[:, 0]**2)) * 1000.0
                self.real_vu_l = m
                self.real_vu_r = m
        except Exception:
            pass

    def set_vu_mode(self, mode):
        """Sets VU Meter Mode to 'simulated' or 'realtime'."""
        if mode == "realtime" and not self.audio_stream and SD_AVAILABLE:
            self._init_audio_analyzer()
        self.vu_mode = mode
