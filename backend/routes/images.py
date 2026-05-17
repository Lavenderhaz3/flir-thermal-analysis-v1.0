import os
import shutil
import zipfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from config import UPLOAD_DIR
from models.database import get_db
from models.schema import Project, Image, Annotation, Equipment
from services.flir_extractor import process_image
from services.filename_parser import parse_filename
from services.auto_detect import run_detection
from services.file_utils import (
    MAX_ZIP_MEMBERS,
    MAX_ZIP_UNCOMPRESSED_BYTES,
    copy_stream_to_temp,
    ensure_under_directory,
    sanitize_filename,
    save_upload_to_temp,
    unique_path,
)
import numpy as np

router = APIRouter(prefix="/api", tags=["images"])


def process_single_image(file_path: str, filename: str, project_id: int, db: Session) -> Image:
    """Process a single FLIR JPEG: extract temps, save artifacts, create DB record.

    Files are organized as: uploads/{project_id}/{date}/{equipment}/{filename}
    """
    filename = sanitize_filename(filename, "image.jpg")

    # Parse filename for date/equipment
    parsed = parse_filename(filename)
    date_str = parsed["date"] if parsed else "unknown"
    equip_str = parsed["equip_id"] if parsed else "unknown"

    # Organized directory: uploads/{project_id}/{date}/{equipment}/
    proj_dir = os.path.join(UPLOAD_DIR, str(project_id))
    org_dir = os.path.join(proj_dir, date_str, equip_str)
    os.makedirs(org_dir, exist_ok=True)

    # Save original file
    dest_path = unique_path(org_dir, filename)
    ensure_under_directory(dest_path, UPLOAD_DIR)
    shutil.copy(file_path, dest_path)

    # FLIR extraction → same organized directory
    try:
        artifact_name = os.path.splitext(os.path.basename(dest_path))[0] + "_artifacts"
        artifact_dir = os.path.join(org_dir, artifact_name)
        ensure_under_directory(artifact_dir, UPLOAD_DIR)
        result = process_image(dest_path, artifact_dir)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=f"FLIR processing failed: {e}")

    # ── Per-equipment cap: keep at most 20 images ─────────────────
    if parsed and parsed.get("equip_id"):
        existing = (
            db.query(Image)
            .filter(Image.equipment == parsed["equip_id"], Image.area == parsed.get("area"))
            .order_by(Image.created_at.asc())
            .all()
        )
        while len(existing) >= 20:
            oldest = existing.pop(0)
            # Delete files
            for path in [oldest.original_path, oldest.thermal_npy_path, oldest.preview_path]:
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
            if oldest.thermal_npy_path:
                artifact_root = os.path.dirname(oldest.thermal_npy_path)
                if os.path.isdir(artifact_root):
                    shutil.rmtree(artifact_root, ignore_errors=True)
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
    errors = []
    tmp_path = await save_upload_to_temp(file)

    try:
        original_name = sanitize_filename(file.filename, "upload")
        ext = os.path.splitext(original_name)[1].lower()
        if ext == ".zip":
            try:
                with zipfile.ZipFile(tmp_path) as zf:
                    members = [info for info in zf.infolist() if not info.is_dir()]
                    if len(members) > MAX_ZIP_MEMBERS:
                        raise HTTPException(status_code=413, detail="ZIP contains too many files")
                    total_size = sum(info.file_size for info in members)
                    if total_size > MAX_ZIP_UNCOMPRESSED_BYTES:
                        raise HTTPException(status_code=413, detail="ZIP uncompressed size too large")

                    for info in sorted(members, key=lambda item: item.filename):
                        safe_name = sanitize_filename(info.filename, "image.jpg")
                        if not safe_name.lower().endswith((".jpg", ".jpeg")):
                            continue
                        member_tmp = None
                        try:
                            with zf.open(info, "r") as src:
                                member_tmp = copy_stream_to_temp(src, suffix=os.path.splitext(safe_name)[1])
                            img = process_single_image(member_tmp, safe_name, project_id, db)
                            results.append({"id": img.id, "filename": img.filename, "t_max": img.t_max})
                        except HTTPException as exc:
                            errors.append({"filename": safe_name, "detail": exc.detail})
                        finally:
                            if member_tmp and os.path.exists(member_tmp):
                                os.unlink(member_tmp)
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="Invalid ZIP file")
        else:
            if ext not in [".jpg", ".jpeg"]:
                raise HTTPException(status_code=400, detail="Only JPG/JPEG or ZIP files are supported")
            img = process_single_image(tmp_path, original_name, project_id, db)
            results.append({"id": img.id, "filename": img.filename, "t_max": img.t_max})
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return {"uploaded": len(results), "images": results, "errors": errors}


@router.get("/images/{image_id}")
def get_image(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    # Compute stable preview URL from original_path (doesn't drift when date/equipment change)
    from config import UPLOAD_DIR
    try:
        safe_path = ensure_under_directory(img.original_path, UPLOAD_DIR)
        rel = os.path.relpath(safe_path, UPLOAD_DIR)
        preview_url = f"/uploads/{rel}"
    except (ValueError, AttributeError, HTTPException):
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
                "max_position": {"x": a.max_x, "y": a.max_y} if a.max_x is not None else None,
                "source": a.source,
                "status": a.status,
                "version": a.version,
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
