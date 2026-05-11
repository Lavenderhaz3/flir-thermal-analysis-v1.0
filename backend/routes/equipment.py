from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.database import get_db
from models.schema import Equipment, Image, Project

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


@router.get("/{equipment_id}/trend")
def get_equipment_trend(equipment_id: int, db: Session = Depends(get_db)):
    """Return max temperature trend over time for a specific equipment.

    Queries ALL images linked to this equipment, sorted by date.
    Each point includes image_id for navigation.
    """
    equip = db.query(Equipment).filter(Equipment.id == equipment_id).first()
    if not equip:
        raise HTTPException(status_code=404, detail="Equipment not found")

    # Get all images for this equipment, sorted by date
    images = (
        db.query(Image)
        .filter(
            Image.equipment_id == equipment_id,
            Image.date.isnot(None),
        )
        .order_by(Image.date)
        .all()
    )

    points = []
    for img in images:
        project = db.query(Project).filter(Project.id == img.project_id).first()
        points.append({
            "date": img.date,
            "t_max": round(img.t_max, 2) if img.t_max else None,
            "t_mean": round(img.t_mean, 2) if img.t_mean else None,
            "image_id": img.id,
            "project_id": img.project_id,
            "project_name": project.name if project else None,
            "area": img.area,
            "filename": img.filename,
        })

    return {
        "equipment_id": equip.id,
        "equipment_name": equip.name,
        "area": equip.area,
        "device_type": equip.device_type,
        "points": points,
    }


@router.get("/by-name")
def find_equipment(
    project_id: int,
    name: str = None,
    area: str = None,
    db: Session = Depends(get_db),
):
    """Find equipment by name/area, optionally scoped to a project."""
    q = db.query(Equipment)
    if project_id:
        q = q.filter(Equipment.project_id == project_id)
    if name:
        q = q.filter(Equipment.name == name)
    if area:
        q = q.filter(Equipment.area == area)
    results = q.all()
    return [
        {
            "id": e.id,
            "name": e.name,
            "area": e.area,
            "project_id": e.project_id,
            "device_type": e.device_type,
        }
        for e in results
    ]
