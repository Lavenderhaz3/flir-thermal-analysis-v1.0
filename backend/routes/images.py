import os
import shutil
import zipfile
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from config import UPLOAD_DIR
from models.database import get_db
from models.schema import Project, Image, Annotation, Equipment
from services.flir_extractor import process_image
from services.filename_parser import parse_filename
from services.auto_detect import run_detection
import numpy as np

router = APIRouter(prefix="/api", tags=["images"])


def process_single_image(file_path: str, filename: str, project_id: int, db: Session) -> Image:
    """Process a single FLIR JPEG: extract temps, save artifacts, create DB record.

    Files are organized as: uploads/{project_id}/{date}/{equipment}/{filename}
    """
    # Parse filename for date/equipment
    parsed = parse_filename(filename)
    date_str = parsed["date"] if parsed else "unknown"
    equip_str = parsed["equip_id"] if parsed else "unknown"

    # Organized directory: uploads/{project_id}/{date}/{equipment}/
    proj_dir = os.path.join(UPLOAD_DIR, str(project_id))
    org_dir = os.path.join(proj_dir, date_str, equip_str)
    os.makedirs(org_dir, exist_ok=True)

    # Save original file
    dest_path = os.path.join(org_dir, filename)
    shutil.copy(file_path, dest_path)

    # FLIR extraction → same organized directory
    try:
        result = process_image(dest_path, org_dir)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=f"FLIR processing failed: {e}")

    # ── Per-equipment cap: keep at most 20 images ─────────────────
    if parsed and parsed.get("equip_id"):
        existing = (
            db.query(Image)
            .filter(Image.equipment == parsed["equip_id"])
            .order_by(Image.created_at.asc())
            .all()
        )
        while len(existing) >= 20:
            oldest = existing.pop(0)
            # Delete files
            if oldest.original_path and os.path.exists(oldest.original_path):
                os.remove(oldest.original_path)
            if oldest.thermal_npy_path and os.path.exists(oldest.thermal_npy_path):
                os.remove(oldest.thermal_npy_path)
            if oldest.preview_path and os.path.exists(oldest.preview_path):
                os.remove(oldest.preview_path)
            db.delete(oldest)
        db.commit()

    # ── Auto-create / link Equipment ──────────────────────────
    equip_id = None
    proj = db.query(Project).filter(Project.id == project_id).first()
    if parsed and parsed.get("equip_id"):
        equip_name = parsed["equip_id"]
        equip_area = parsed.get("area")
        equip = (
            db.query(Equipment)
            .filter(Equipment.name == equip_name, Equipment.area == equip_area)
            .first()
        )
        if not equip:
            equip = Equipment(
                project_id=project_id,
                name=equip_name,
                area=equip_area,
                device_type=proj.model_type if proj and proj.model_type != "none" else None,
            )
            db.add(equip)
            db.flush()
        equip_id = equip.id

    img = Image(
        project_id=project_id,
        equipment_id=equip_id,
        filename=filename,
        original_path=dest_path,
        thermal_npy_path=result["thermal_npy_path"],
        preview_path=result["preview_path"],
        date=parsed["date"] if parsed else None,
        area=parsed["area"] if parsed else None,
        equipment=parsed["equip_id"] if parsed else None,
        t_min=result["t_min"],
        t_max=result["t_max"],
        t_mean=result["t_mean"],
        thermal_width=result["thermal_width"],
        thermal_height=result["thermal_height"],
        display_width=result["display_width"],
        display_height=result["display_height"],
        atmospheric_temp=result.get("atmospheric_temp"),
    )
    db.add(img)
    db.commit()
    db.refresh(img)

    # ── Auto-detection ──────────────────────────────────────────────
    proj = db.query(Project).filter(Project.id == project_id).first()
    if proj and proj.model_type and proj.model_type != "none":
        temp_matrix = np.load(img.thermal_npy_path)
        tW = img.thermal_width or temp_matrix.shape[1]
        tH = img.thermal_height or temp_matrix.shape[0]
        detections = run_detection(dest_path, proj.model_type, temp_matrix, tW, tH)
        for det in detections:
            ann = Annotation(
                image_id=img.id,
                box_coords=det["box_coords"] if "box_coords" in det else {
                    "x1": det["x1"], "y1": det["y1"],
                    "x2": det["x2"], "y2": det["y2"],
                },
                source=det.get("source", "auto"),
                version=1,
                status="draft",
            )
            # Calculate temps for auto-detected box
            x1, y1 = min(ann.box_coords["x1"], ann.box_coords["x2"]), min(ann.box_coords["y1"], ann.box_coords["y2"])
            x2, y2 = max(ann.box_coords["x1"], ann.box_coords["x2"]), max(ann.box_coords["y1"], ann.box_coords["y2"])
            roi = temp_matrix[max(0,y1):min(tH,y2), max(0,x1):min(tW,x2)]
            if roi.size > 0:
                ann.t_max = round(float(np.nanmax(roi)), 2)
                ann.t_min = round(float(np.nanmin(roi)), 2)
                ann.t_mean = round(float(np.nanmean(roi)), 2)
                max_flat = np.nanargmax(roi)
                max_ly, max_lx = np.unravel_index(max_flat, roi.shape)
                ann.max_x = int(x1 + max_lx)
                ann.max_y = int(y1 + max_ly)
            db.add(ann)
        db.commit()

    return img


@router.post("/projects/{project_id}/images/")
async def upload_images(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    results = []

    # Save uploaded file to temp location
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    ext = os.path.splitext(file.filename)[1].lower()
    if ext == ".zip":
        # Extract zip and process each jpg
        with zipfile.ZipFile(tmp_path) as zf:
            for name in sorted(zf.namelist()):
                if not name.lower().endswith((".jpg", ".jpeg")):
                    continue
                inner_path = os.path.join(os.path.dirname(tmp_path), os.path.basename(name))
                zf.extract(name, os.path.dirname(tmp_path))
                actual_path = os.path.join(os.path.dirname(tmp_path), name)
                try:
                    img = process_single_image(actual_path, os.path.basename(name), project_id, db)
                    results.append({"id": img.id, "filename": img.filename, "t_max": img.t_max})
                except HTTPException:
                    pass  # Skip failed images
    else:
        img = process_single_image(tmp_path, file.filename, project_id, db)
        results.append({"id": img.id, "filename": img.filename, "t_max": img.t_max})

    os.unlink(tmp_path)
    return {"uploaded": len(results), "images": results}


@router.get("/images/{image_id}")
def get_image(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    # Compute stable preview URL from original_path (doesn't drift when date/equipment change)
    from config import UPLOAD_DIR
    try:
        rel = os.path.relpath(img.original_path, UPLOAD_DIR)
        preview_url = f"/uploads/{rel}"
    except (ValueError, AttributeError):
        preview_url = f"/uploads/{img.project_id}/{img.date or 'unknown'}/{img.equipment or 'unknown'}/{img.filename}"

    return {
        "id": img.id,
        "project_id": img.project_id,
        "equipment_id": img.equipment_id,
        "filename": img.filename,
        "date": img.date,
        "area": img.area,
        "equipment": img.equipment,
        "t_min": img.t_min,
        "t_max": img.t_max,
        "t_mean": img.t_mean,
        "thermal_width": img.thermal_width,
        "thermal_height": img.thermal_height,
        "display_width": img.display_width,
        "display_height": img.display_height,
        "preview_url": preview_url,
        "annotations": [
            {
                "id": a.id,
                "box_coords": a.box_coords,
                "t_max": a.t_max,
                "t_min": a.t_min,
                "t_mean": a.t_mean,
                "status": a.status,
            }
            for a in img.annotations
        ],
    }


@router.get("/images/{image_id}/thermal")
def get_thermal_matrix(image_id: int, db: Session = Depends(get_db)):
    import numpy as np

    img = db.query(Image).filter(Image.id == image_id).first()
    if not img or not img.thermal_npy_path:
        raise HTTPException(status_code=404, detail="Thermal data not found")
    arr = np.load(img.thermal_npy_path)
    # Return as nested list (truncate if too large)
    if arr.size > 1_000_000:
        return {"error": "Matrix too large, use cropped queries"}
    return {"data": arr.tolist(), "shape": list(arr.shape)}
