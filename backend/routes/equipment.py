from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.database import get_db
from models.schema import Equipment, Image, Project

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


def _find_equipment_images(
    *,
    db: Session,
    equipment_name: str,
    area: Optional[str] = None,
) -> list[Image]:
    """Find all images matching an equipment name (+ optional area) across ALL projects."""
    q = db.query(Image).filter(Image.equipment == equipment_name)
    if area:
        q = q.filter(Image.area == area)
    return q.order_by(Image.date).all()


@router.get("/{equipment_id}/trend")
def get_equipment_trend(equipment_id: int, db: Session = Depends(get_db)):
    """Trend for a specific equipment record (single project)."""
    equip = db.query(Equipment).filter(Equipment.id == equipment_id).first()
    if not equip:
        raise HTTPException(status_code=404, detail="Equipment not found")

    # Find ALL images with same name+area across all projects
    images = _find_equipment_images(db=db, equipment_name=equip.name, area=equip.area)

    return _build_trend_response(equip, images, db)


@router.get("/trend")
def get_equipment_trend_by_name(
    name: str = Query(..., description="Equipment name, e.g. T01"),
    area: Optional[str] = Query(None, description="Equipment area, e.g. 主变区"),
    db: Session = Depends(get_db),
):
    """Cross-project trend by equipment name + area. No equipment_id needed."""
    images = _find_equipment_images(db=db, equipment_name=name, area=area)
    if not images:
        raise HTTPException(status_code=404, detail="No images found for this equipment")

    # Use the first equipment record for metadata
    first_equip = (
        db.query(Equipment)
        .filter(Equipment.name == name)
        .first()
    )

    return {
        "equipment_id": first_equip.id if first_equip else None,
        "equipment_name": name,
        "area": area,
        "device_type": first_equip.device_type if first_equip else None,
        "points": _build_points(images, db),
    }


@router.get("/by-name")
def find_equipment(
    project_id: Optional[int] = Query(None),
    name: Optional[str] = Query(None),
    area: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Find equipment records by name/area, optionally scoped to a project."""
    q = db.query(Equipment)
    if project_id:
        q = q.filter(Equipment.project_id == project_id)
    if name:
        q = q.filter(Equipment.name == name)
    if area:
        q = q.filter(Equipment.area == area)
    return [
        {"id": e.id, "name": e.name, "area": e.area,
         "project_id": e.project_id, "device_type": e.device_type}
        for e in q.all()
    ]


PREDEFINED_AREAS = [
    "500kV交流场",
    "500kV交流滤波器场",
    "直流场",
    "换流变区域",
    "二次屏柜",
]


@router.get("/areas")
def list_areas(db: Session = Depends(get_db)):
    """Return all available areas — predefined + extracted from images."""
    img_areas = {
        row[0] for row in
        db.query(Image.area).filter(Image.area.isnot(None)).distinct().all()
    }
    all_areas = sorted(set(PREDEFINED_AREAS) | img_areas)
    return all_areas


@router.get("/list")
def list_equipment(db: Session = Depends(get_db)):
    """Return all unique equipment (area + name) with image counts for dropdowns."""
    rows = (
        db.query(Image.area, Image.equipment, func.count(Image.id))
        .filter(Image.equipment.isnot(None))
        .group_by(Image.area, Image.equipment)
        .all()
    )
    result = [
        {"area": area or "未知", "name": equipment, "count": count}
        for area, equipment, count in rows
    ]
    result.sort(key=lambda x: (x["area"], x["name"]))
    return result


# ── Helpers ────────────────────────────────────────────────────────

def _build_points(images: list[Image], db: Session) -> list[dict]:
    points = []
    project_ids = {img.project_id for img in images}
    projects = {
        project.id: project
        for project in db.query(Project).filter(Project.id.in_(project_ids)).all()
    } if project_ids else {}
    for img in images:
        project = projects.get(img.project_id)
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
    return points


def _build_trend_response(equip: Equipment, images: list[Image], db: Session) -> dict:
    return {
        "equipment_id": equip.id,
        "equipment_name": equip.name,
        "area": equip.area,
        "device_type": equip.device_type,
        "points": _build_points(images, db),
    }
