import os
import sys

# ── Base paths — handles both dev and PyInstaller .app ──────────
if getattr(sys, 'frozen', False):
    # Running as PyInstaller .app bundle
    _BUNDLE_DIR = sys._MEIPASS  # temp dir with bundled data
    _WRITABLE_DIR = os.path.expanduser("~/Documents/FLIR分析数据")
else:
    _BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    _WRITABLE_DIR = _BUNDLE_DIR

BASE_DIR = _BUNDLE_DIR
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(_WRITABLE_DIR, 'app.db')}"
)
UPLOAD_DIR = os.environ.get(
    "UPLOAD_DIR",
    os.path.join(_WRITABLE_DIR, "uploads")
)
os.makedirs(UPLOAD_DIR, exist_ok=True)
