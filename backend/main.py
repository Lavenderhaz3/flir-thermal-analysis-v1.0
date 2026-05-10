from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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


# ── Routes ────────────────────────────────────────────────────────────
from routes.projects import router as projects_router
from routes.images import router as images_router
from routes.annotations import router as annotations_router
from routes.reports import router as reports_router

app.include_router(projects_router)
app.include_router(images_router)
app.include_router(annotations_router)
app.include_router(reports_router)

# ── Static files ──────────────────────────────────────────────────────
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
