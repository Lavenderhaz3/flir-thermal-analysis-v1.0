import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import UPLOAD_DIR
from models.database import get_db
from models.schema import Project, Image
from services.file_utils import ensure_under_directory, sanitize_filename, unique_path

router = APIRouter(prefix="/api/projects", tags=["projects"])

MODEL_CHOICES = [
    {"value": "none", "label": "无（人工标注）"},
    {"value": "transformer", "label": "变压器"},
    {"value": "switchgear", "label": "开关柜"},
    {"value": "cable", "label": "电缆接头"},
    {"value": "busbar", "label": "母线"},
    {"value": "insulator", "label": "绝缘子"},
]


@router.get("/model-choices")
def get_model_choices():
    return MODEL_CHOICES


@router.post("/")
async def create_project(
    name: str = Form(...),
    model_type: str = Form("none"),
    template: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    if model_type not in {choice["value"] for choice in MODEL_CHOICES}:
        raise HTTPException(status_code=400, detail="Invalid model_type")

    template_path = None
    if template and template.filename:
        # Save uploaded template
        safe_project_name = sanitize_filename(name, "project")
        safe_template_name = sanitize_filename(template.filename, "report.docx")
        if not safe_template_name.lower().endswith(".docx"):
            raise HTTPException(status_code=400, detail="Template must be a .docx file")
        proj_dir = os.path.join(UPLOAD_DIR, "templates", safe_project_name)
        os.makedirs(proj_dir, exist_ok=True)
        template_path = unique_path(proj_dir, safe_template_name)
        ensure_under_directory(template_path, UPLOAD_DIR)
        with open(template_path, "wb") as f:
            shutil.copyfileobj(template.file, f)

    proj = Project(
        name=name,
        model_type=model_type,
        report_template_path=template_path,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    return {
        "id": proj.id,
        "name": proj.name,
        "model_type": proj.model_type,
        "report_template_path": proj.report_template_path,
        "created_at": proj.created_at.isoformat(),
    }


@router.get("/")
def list_projects(db: Session = Depends(get_db)):
    rows = (
        db.query(Project, func.count(Image.id).label("image_count"))
        .outerjoin(Image, Image.project_id == Project.id)
        .group_by(Project.id)
        .order_by(Project.created_at.desc())
        .all()
    )
    return [
        {
            "id": p.id,
            "name": p.name,
            "model_type": p.model_type,
            "created_at": p.created_at.isoformat(),
            "image_count": image_count,
        }
        for p, image_count in rows
    ]


@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "id": proj.id,
        "name": proj.name,
        "model_type": proj.model_type,
        "report_template_path": proj.report_template_path,
        "created_at": proj.created_at.isoformat(),
        "images": [
            {
                "id": i.id,
                "filename": i.filename,
                "date": i.date,
                "area": i.area,
                "equipment": i.equipment,
                "t_min": i.t_min,
                "t_max": i.t_max,
                "t_mean": i.t_mean,
                "preview_url": _stable_preview_url(i.original_path, proj.id, i.date, i.equipment, i.filename),
            }
            for i in proj.images
        ],
    }


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_upload_dir = os.path.join(UPLOAD_DIR, str(project_id))
    template_path = proj.report_template_path
    db.delete(proj)
    db.commit()
    if os.path.isdir(project_upload_dir):
        shutil.rmtree(project_upload_dir, ignore_errors=True)
    if template_path:
        try:
            safe_template_path = ensure_under_directory(template_path, UPLOAD_DIR)
            if os.path.exists(safe_template_path):
                os.remove(safe_template_path)
        except HTTPException:
            pass
    return {"ok": True}


from collections import defaultdict


@router.get("/{project_id}/trend")
def get_project_trend(project_id: int, db: Session = Depends(get_db)):
    """Return max temperature trend over time for each equipment in the project.

    Each data point includes date, t_max, image_id so the frontend can
    navigate to the specific image on click.
    """
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    images = (
        db.query(Image)
        .filter(Image.project_id == project_id, Image.date.isnot(None))
        .order_by(Image.date)
        .all()
    )

    # Group by equipment, sorted by date
    by_equipment = defaultdict(list)
    for img in images:
        equip = img.equipment or "unknown"
        by_equipment[equip].append({
            "date": img.date,
            "t_max": round(img.t_max, 2) if img.t_max else None,
            "t_mean": round(img.t_mean, 2) if img.t_mean else None,
            "image_id": img.id,
            "area": img.area,
            "filename": img.filename,
        })

    # Sort each equipment's points by date
    for equip in by_equipment:
        by_equipment[equip].sort(key=lambda x: x["date"] or "")

    return {
        "project_id": project_id,
        "equipment_trends": dict(by_equipment),
    }


def _stable_preview_url(original_path, project_id, date, equipment, filename):
    """Return a stable preview URL from original_path, falling back to dynamic construction."""
    if original_path:
        try:
            safe_path = ensure_under_directory(original_path, UPLOAD_DIR)
            rel = os.path.relpath(safe_path, UPLOAD_DIR)
            return f"/uploads/{rel}"
        except (ValueError, HTTPException):
            pass
    return f"/uploads/{project_id}/{date or 'unknown'}/{equipment or 'unknown'}/{filename}"
