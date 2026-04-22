import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Use a tmp DB so tests don't touch the dev data dir.
os.environ.setdefault("STEALTH_SCRAPER_DB_OVERRIDE", "1")
