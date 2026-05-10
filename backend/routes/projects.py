from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models.database import get_db
from models.schema import Project

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("/")
def create_project(name: str, db: Session = Depends(get_db)):
    proj = Project(name=name)
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return {"id": proj.id, "name": proj.name, "created_at": proj.created_at.isoformat()}


@router.get("/")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "name": p.name,
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
                "preview_url": f"/uploads/{proj.id}/{i.filename}",
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
