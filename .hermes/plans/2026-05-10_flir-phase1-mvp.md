# FLIR Thermal Analysis — Phase 1 MVP Plan

> **For Hermes:** Implement task-by-task. Commit after each task.

**Goal:** Web app for uploading FLIR radiometric JPEGs, drawing temperature measurement boxes, manual review, and Word report generation.

**Architecture:** FastAPI backend (port 8000) + React/Vite frontend (port 5173) + SQLite for MVP (swap to PostgreSQL later). Frontend talks to backend via REST API. FLIR processing reuses `flir_verify_poc.py` logic.

**Tech Stack:** FastAPI, SQLAlchemy, SQLite, React, Vite, Konva.js, docxtpl, Docker

---

## Task 1: Backend scaffold

**Files:** `backend/requirements.txt`, `backend/main.py`, `backend/config.py`

**Step 1:** Create `backend/requirements.txt`:
```
fastapi==0.115.0
uvicorn==0.30.0
sqlalchemy==2.0.35
python-multipart==0.0.12
Pillow==10.4.0
numpy==2.1.0
python-docx==1.1.2
docxtpl==0.19.0
```

**Step 2:** Create `backend/config.py`:
```python
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'app.db')}")
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)
```

**Step 3:** Create `backend/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="FLIR Thermal Analysis")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

**Step 4:** Install deps and test:
```bash
cd backend && pip install -r requirements.txt
uvicorn main:app --port 8000 &
sleep 2 && curl http://localhost:8000/api/health && kill %1
```
Expected: `{"status":"ok"}`

---

## Task 2: Database models

**Files:** `backend/models/__init__.py`, `backend/models/database.py`, `backend/models/schema.py`

**Step 1:** `backend/models/database.py`:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

**Step 2:** `backend/models/schema.py`:
```python
import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from .database import Base

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    images = relationship("Image", back_populates="project", cascade="all, delete-orphan")

class Image(Base):
    __tablename__ = "images"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    filename = Column(String, nullable=False)
    original_path = Column(String, nullable=False)
    thermal_npy_path = Column(String, nullable=True)
    preview_path = Column(String, nullable=True)
    date = Column(String, nullable=True)
    area = Column(String, nullable=True)
    equipment = Column(String, nullable=True)
    t_min = Column(Float, nullable=True)
    t_max = Column(Float, nullable=True)
    t_mean = Column(Float, nullable=True)
    thermal_width = Column(Integer, nullable=True)
    thermal_height = Column(Integer, nullable=True)
    display_width = Column(Integer, nullable=True)
    display_height = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    project = relationship("Project", back_populates="images")
    annotations = relationship("Annotation", back_populates="image", cascade="all, delete-orphan")

class Annotation(Base):
    __tablename__ = "annotations"
    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False)
    box_coords = Column(JSON, nullable=False)
    version = Column(Integer, default=1)
    t_max = Column(Float, nullable=True)
    t_min = Column(Float, nullable=True)
    t_mean = Column(Float, nullable=True)
    status = Column(String, default="draft")
    reviewed_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    image = relationship("Image", back_populates="annotations")
```

**Step 3:** Update `backend/main.py` to create tables on startup:
```python
from models.database import engine, Base

# After app = FastAPI(...)
@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
```

**Step 4:** Test:
```bash
cd backend && python -c "from models.database import engine, Base; Base.metadata.create_all(bind=engine); print('OK')"
```
Expected: OK, `backend/app.db` file created.

---

## Task 3: FLIR extractor service

**Files:** `backend/services/__init__.py`, `backend/services/flir_extractor.py`

Reuse the PoC logic from `flir_verify_poc.py`. Adapt the `compute_temperatures()` function into a service that takes an image path and returns the temperature matrix + metadata.

**Step 1:** Create `backend/services/flir_extractor.py` — port `extract_metadata`, `extract_raw_thermal`, `raw_to_temperature`, `compute_temperatures` from flir_verify_poc.py. Add a `process_image(image_path, output_dir)` function that saves `.npy` + generates a preview and returns a result dict.

Key output dict:
```python
{
    "thermal_npy_path": str,
    "preview_path": str,
    "t_min": float, "t_max": float, "t_mean": float,
    "thermal_width": int, "thermal_height": int,
    "display_width": int, "display_height": int,
    "camera_make": str, "camera_model": str,
}
```

**Step 2:** Test with the known test image:
```bash
cd backend && python -c "
from services.flir_extractor import process_image
import json
r = process_image('/Users/mba/0502/IR_53167.jpg', '/tmp/flir_test')
print(json.dumps({k: v for k, v in r.items() if k != 'thermal_npy_path'}, indent=2, default=str))
"
```
Expected: t_min, t_max temperature values in reasonable range (20-40°C).

---

## Task 4: Filename parser service

**Files:** `backend/services/filename_parser.py`

```python
import re

PATTERN = re.compile(
    r'^(?P<date>\d{4}-\d{2}-\d{2})'
    r'(?P<area>[A-Za-z\u4e00-\u9fff]+)'
    r'-(?P<equip_id>[A-Za-z0-9]+)'
    r'(?P<type>[A-Za-z\u4e00-\u9fff]+)'
    r'\.(jpg|jpeg)$',
    re.IGNORECASE
)

def parse_filename(filename: str) -> dict | None:
    m = PATTERN.match(filename)
    if not m:
        return None
    return m.groupdict()
```

Test:
```bash
cd backend && python -c "
from services.filename_parser import parse_filename
print(parse_filename('2025-05-02主变区-T01变压器.jpg'))
print(parse_filename('not-matching.jpg'))
"
```
Expected: dict with date/area/equip_id/type; None for non-matching.

---

## Task 5: Project routes

**Files:** `backend/routes/__init__.py`, `backend/routes/projects.py`

CRUD for projects. Include the router in main.py.

```python
# routes/projects.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from models.database import get_db
from models.schema import Project

router = APIRouter(prefix="/api/projects", tags=["projects"])

@router.post("/")
def create_project(name: str, db: Session = Depends(get_db)):
    proj = Project(name=name)
    db.add(proj); db.commit(); db.refresh(proj)
    return {"id": proj.id, "name": proj.name}

@router.get("/")
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()

@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        return {"error": "not found"}, 404
    return {
        "id": proj.id, "name": proj.name,
        "images": [{"id": i.id, "filename": i.filename, "t_max": i.t_max} for i in proj.images]
    }
```

Register in main.py:
```python
from routes.projects import router as projects_router
app.include_router(projects_router)
```

Test:
```bash
curl -X POST "http://localhost:8000/api/projects/?name=TestProject"
curl http://localhost:8000/api/projects/
```

---

## Task 6: Image upload route (with temp extraction)

**Files:** `backend/routes/images.py`

POST `/api/projects/{id}/images/` — accepts `file` (jpg or zip). For jpg: extract FLIR data, save to uploads dir, create DB record. For zip: unzip, process each jpg.

GET `/api/images/{id}/` — image detail + temp stats.
GET `/api/images/{id}/thermal` — return temperature matrix as JSON array.

Key logic:
- Save uploaded file to `UPLOAD_DIR/{project_id}/{filename}`
- Call `process_image()` from flir_extractor
- Call `parse_filename()` 
- Create Image record

---

## Task 7: Annotation routes

**Files:** `backend/routes/annotations.py`

POST `/api/images/{id}/annotations/` — create annotation with box coords. Calculate t_max/t_min/t_mean by cropping the temperature matrix.

PUT `/api/annotations/{id}/` — update box, recalculate temps.
DELETE `/api/annotations/{id}/` — delete.
GET `/api/images/{id}/annotations/` — list annotations for image.

Key logic for temp calculation from box coords:
```python
def calc_box_temps(temp_matrix, box_coords):
    x1, y1, x2, y2 = box_coords["x1"], box_coords["y1"], box_coords["x2"], box_coords["y2"]
    roi = temp_matrix[y1:y2, x1:x2]
    return float(np.nanmax(roi)), float(np.nanmin(roi)), float(np.nanmean(roi))
```

The box_coords here are already in thermal matrix coordinates (mapping from display coords is frontend's responsibility or a separate endpoint).

---

## Task 8: Report generation

**Files:** `backend/services/report_generator.py`, `backend/routes/reports.py`

POST `/api/projects/{id}/report/` — generate Word report with docxtpl.

Template approach:
1. Create `backend/templates/report.docx` — a Word file with Jinja2 placeholders
2. Fill template with project data (images, annotations, temp stats)
3. Return the generated .docx file

Minimal template content: project name, date, image table with filename, area, equipment, t_max, t_min, box annotation temps.

```python
from docxtpl import DocxTemplate
import io

def generate_report(project, images_with_annotations, template_path):
    doc = DocxTemplate(template_path)
    context = {
        "project_name": project.name,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "images": [
            {
                "filename": img.filename,
                "area": img.area,
                "equipment": img.equipment,
                "t_max": img.t_max,
                "t_min": img.t_min,
                "t_mean": img.t_mean,
                "annotations": [
                    {"box": a.box_coords, "t_max": a.t_max, "t_mean": a.t_mean}
                    for a in img.annotations
                ]
            }
            for img in images_with_annotations
        ]
    }
    doc.render(context)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
```

---

## Task 9: Backend static file serving

**Files:** update `backend/main.py`

Add static file mount for preview images:
```python
from fastapi.staticfiles import StaticFiles
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
```

Now the frontend can load images via `http://localhost:8000/uploads/{project_id}/{filename}`.

---

## Task 10: Frontend scaffold

**Files:** `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`

Create Vite + React + TypeScript project with Konva.js.

```bash
cd frontend && npm create vite@latest . -- --template react-ts
npm install konva react-konva axios
```

Vite config with proxy to backend:
```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8000', '/uploads': 'http://localhost:8000' }
  }
})
```

---

## Task 11: API client + types

**Files:** `frontend/src/api/client.ts`, `frontend/src/types.ts`

Axios instance pointing to `/api`. TypeScript types for Project, Image, Annotation.

---

## Task 12: Project list page

**Files:** `frontend/src/pages/ProjectList.tsx`

Simple page: list projects, create new project form. Links to project detail.

---

## Task 13: Project detail page

**Files:** `frontend/src/pages/ProjectDetail.tsx`

Show project name, image list (thumbnails with temp stats), upload form (drag-and-drop or file input). Click image to enter annotation editor.

---

## Task 14: Annotation editor (core)

**Files:** `frontend/src/pages/AnnotationEditor.tsx`, `frontend/src/components/ImageCanvas.tsx`

This is the core feature:
1. Load FLIR JPEG as canvas background
2. User draws rectangle (Konva Rect with Transformer)
3. Rectangle is draggable + resizable (bottom-right corner)
4. Send box coords to backend → receive calculated temps
5. Display t_max label inside/above the box
6. Save annotation to backend

Konva setup:
```tsx
<Stage width={displayW} height={displayH}>
  <Layer>
    <KonvaImage image={flirJpeg} />
    <Rect x={x} y={y} width={w} height={h} draggable />
    <Transformer />
    <Text text={`${t_max}°C`} x={x} y={y-20} />
  </Layer>
</Stage>
```

Box coords must be sent to backend in thermal-matrix coordinates. Use the scale mapping:
```ts
const scaleX = displayW / thermalW;
const scaleY = displayH / thermalH;
// Frontend display coords → backend thermal coords
const thermalX = displayX / scaleX;
```

---

## Task 15: Report download button

**Files:** update `frontend/src/pages/ProjectDetail.tsx`

Add "Generate Report" button that calls POST `/api/projects/{id}/report/`, downloads the .docx file.

---

## Task 16: Docker Compose

**Files:** `docker-compose.yml`

```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    volumes: ["./data:/app/uploads"]
  frontend:
    build: ./frontend
    ports: ["5173:80"]
```

---

## Execution Order

1. Task 1-2: Backend scaffold + DB models
2. Task 3: FLIR extractor (critical — test with real images)
3. Task 4: Filename parser
4. Task 5: Project routes
5. Task 6: Image routes
6. Task 7: Annotation routes
7. Task 8: Report generation
8. Task 9: Static file serving
9. Task 10-11: Frontend scaffold + API client
10. Task 12: Project list
11. Task 13: Project detail
12. Task 14: Annotation editor
13. Task 15: Report download
14. Task 16: Docker Compose
