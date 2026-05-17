import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.database import get_db
from models.schema import Image, Annotation

router = APIRouter(prefix="/api", tags=["annotations"])


class BoxCoords(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int


class AnnotationCreate(BaseModel):
    box_coords: BoxCoords


def calc_box_temps(temp_matrix: np.ndarray, coords: BoxCoords) -> dict:
    """Calculate t_max, t_min, t_mean + max position within box region."""
    x1, y1 = min(coords.x1, coords.x2), min(coords.y1, coords.y2)
    x2, y2 = max(coords.x1, coords.x2), max(coords.y1, coords.y2)

    # Clamp to matrix bounds
    h, w = temp_matrix.shape
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)

    roi = temp_matrix[y1:y2, x1:x2]
    if roi.size == 0:
        raise HTTPException(status_code=400, detail="Box has zero area on temperature matrix")
    if np.all(np.isnan(roi)):
        raise HTTPException(status_code=400, detail="Box contains no valid temperature pixels")

    # Find max position within ROI (local coords)
    max_flat = np.nanargmax(roi)
    max_ly, max_lx = np.unravel_index(max_flat, roi.shape)
    # Convert to global thermal matrix coords
    max_py = int(y1 + max_ly)
    max_px = int(x1 + max_lx)

    return {
        "t_max": round(float(np.nanmax(roi)), 2),
        "t_min": round(float(np.nanmin(roi)), 2),
        "t_mean": round(float(np.nanmean(roi)), 2),
        "max_x": max_px,
        "max_y": max_py,
    }


@router.post("/images/{image_id}/annotations/")
def create_annotation(image_id: int, body: AnnotationCreate, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    if not img.thermal_npy_path:
        raise HTTPException(status_code=400, detail="No thermal data for this image")

    # Calculate temperatures within the box
    temp_matrix = np.load(img.thermal_npy_path)
    temps = calc_box_temps(temp_matrix, body.box_coords)

    ann = Annotation(
        image_id=image_id,
        box_coords=body.box_coords.model_dump(),
        version=1,
        t_max=temps["t_max"],
        t_min=temps["t_min"],
        t_mean=temps["t_mean"],
        max_x=temps["max_x"],
        max_y=temps["max_y"],
        status="draft",
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)

    return {
        "id": ann.id,
        "box_coords": ann.box_coords,
        "t_max": ann.t_max,
        "t_min": ann.t_min,
        "t_mean": ann.t_mean,
        "max_position": {"x": temps["max_x"], "y": temps["max_y"]},
        "source": ann.source,
        "status": ann.status,
    }


@router.put("/annotations/{annotation_id}")
def update_annotation(annotation_id: int, body: AnnotationCreate, db: Session = Depends(get_db)):
    ann = db.query(Annotation).filter(Annotation.id == annotation_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")

    img = ann.image
    if not img.thermal_npy_path:
        raise HTTPException(status_code=400, detail="No thermal data")

    temp_matrix = np.load(img.thermal_npy_path)
    temps = calc_box_temps(temp_matrix, body.box_coords)

    ann.box_coords = body.box_coords.model_dump()
    ann.t_max = temps["t_max"]
    ann.t_min = temps["t_min"]
    ann.t_mean = temps["t_mean"]
    ann.max_x = temps["max_x"]
    ann.max_y = temps["max_y"]
    ann.version += 1
    db.commit()
    db.refresh(ann)

    return {
        "id": ann.id,
        "box_coords": ann.box_coords,
        "t_max": ann.t_max,
        "t_min": ann.t_min,
        "t_mean": ann.t_mean,
        "max_position": {"x": temps["max_x"], "y": temps["max_y"]},
        "source": ann.source,
        "status": ann.status,
        "version": ann.version,
    }


@router.delete("/annotations/{annotation_id}")
def delete_annotation(annotation_id: int, db: Session = Depends(get_db)):
    ann = db.query(Annotation).filter(Annotation.id == annotation_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    db.delete(ann)
    db.commit()
    return {"ok": True}


@router.get("/images/{image_id}/annotations/")
def list_annotations(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    anns = (
        db.query(Annotation)
        .filter(Annotation.image_id == image_id)
        .order_by(Annotation.created_at.desc())
        .all()
    )
    return [
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
        for a in anns
    ]
