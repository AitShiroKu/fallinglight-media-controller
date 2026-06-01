import sys
import logging
from PySide6.QtWidgets import QApplication
from audio_controller import AudioController
from scheduler import ProgramScheduler
from gui import MainWindow

# Configure global logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("Main")

def main():
    logger.info("Initializing FallingLight Media Controller...")
    
    # Initialize the Qt application
    app = QApplication(sys.argv)
    app.setApplicationName("FallingLight Media controller")
    app.setOrganizationName("FallingLight School PR")
    
    # Instantiate Audio Control Engine
    audio_controller = AudioController()
    
    # Instantiate Automation Scheduler Engine
    scheduler = ProgramScheduler()
    
    # Create and display the main window interface
    window = MainWindow(audio_controller, scheduler)
    window.show()
    
    logger.info("Application successfully launched.")
    
    # Execute event loop
    sys_exit_code = app.exec()
    
    logger.info("Shutting down Application...")
    sys.exit(sys_exit_code)

if __name__ == "__main__":
    main()
