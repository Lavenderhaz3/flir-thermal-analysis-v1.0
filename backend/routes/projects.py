import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from config import UPLOAD_DIR
from models.database import get_db
from models.schema import Project

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
    template_path = None
    if template and template.filename:
        # Save uploaded template
        proj_dir = os.path.join(UPLOAD_DIR, "templates", name)
        os.makedirs(proj_dir, exist_ok=True)
        template_path = os.path.join(proj_dir, template.filename)
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
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "model_type": p.model_type,
            "created_at": p.created_at.isoformat(),
            "image_count": len(p.images),
        }
        for p in projects
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
                "preview_url": f"/uploads/{proj.id}/{i.date or 'unknown'}/{i.equipment or 'unknown'}/{i.filename}",
            }
            for i in proj.images
        ],
    }


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(proj)
    db.commit()
    return {"ok": True}
