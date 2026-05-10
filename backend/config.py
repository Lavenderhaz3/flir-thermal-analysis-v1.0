import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.environ.get(
    "DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'app.db')}"
)
UPLOAD_DIR = os.environ.get(
    "UPLOAD_DIR", os.path.join(BASE_DIR, "uploads")
)
os.makedirs(UPLOAD_DIR, exist_ok=True)
