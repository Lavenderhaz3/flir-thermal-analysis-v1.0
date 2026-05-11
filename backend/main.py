import os
import sys
import webbrowser
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text

from config import UPLOAD_DIR
from models.database import engine, Base

app = FastAPI(title="FLIR Thermal Analysis")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE images ADD COLUMN atmospheric_temp FLOAT"))
            conn.commit()
        except Exception:
            pass

    # Auto-open browser in desktop mode (PyInstaller .app)
    if getattr(sys, 'frozen', False):
        threading.Timer(1.5, lambda: webbrowser.open("http://localhost:8000")).start()


# ── API Routes ───────────────────────────────────────────────────
from routes.projects import router as projects_router
from routes.images import router as images_router
from routes.annotations import router as annotations_router
from routes.reports import router as reports_router
from routes.equipment import router as equipment_router

app.include_router(projects_router)
app.include_router(images_router)
app.include_router(annotations_router)
app.include_router(reports_router)
app.include_router(equipment_router)

# ── Static files ──────────────────────────────────────────────────
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ── Frontend SPA (served in desktop/production mode) ──────────────
if getattr(sys, 'frozen', False):
    # PyInstaller .app — frontend bundled via --add-data
    FRONTEND_DIR = os.path.join(sys._MEIPASS, "frontend", "dist")
else:
    # Dev mode
    FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.isdir(FRONTEND_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str = ""):
        """Serve React SPA — fall back to index.html for all non-API routes."""
        if full_path.startswith("api/") or full_path.startswith("uploads/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        index = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        from fastapi import HTTPException
        raise HTTPException(status_code=404)


# ── Entry point (for PyInstaller .app and direct execution) ────
if __name__ == "__main__" or getattr(sys, 'frozen', False):
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
