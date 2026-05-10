import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from models.database import get_db
from models.schema import Project
from services.report_generator import generate_report

router = APIRouter(prefix="/api", tags=["reports"])

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "..", "templates", "report.docx")


@router.post("/projects/{project_id}/report/")
def create_report(project_id: int, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    # Ensure annotations are loaded
    _ = [img.annotations for img in proj.images]

    if not os.path.exists(TEMPLATE_PATH):
        raise HTTPException(status_code=500, detail="Report template not found")

    buf = generate_report(proj, TEMPLATE_PATH)

    filename = f"{proj.name}_测温报告_{proj.created_at.strftime('%Y%m%d')}.docx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
