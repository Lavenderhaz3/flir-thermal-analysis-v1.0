import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from models.database import get_db
from models.schema import Project
from services.report_generator import generate_report

router = APIRouter(prefix="/api", tags=["reports"])

DEFAULT_TEMPLATE = os.path.join(os.path.dirname(__file__), "..", "templates", "report.docx")


@router.post("/projects/{project_id}/report/")
def create_report(project_id: int, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    # Ensure annotations are loaded
    _ = [img.annotations for img in proj.images]

    # Use project-specific template if available, otherwise default
    template_path = proj.report_template_path if proj.report_template_path and os.path.exists(proj.report_template_path) else DEFAULT_TEMPLATE

    if not os.path.exists(template_path):
        raise HTTPException(status_code=500, detail=f"Report template not found: {template_path}")

    buf = generate_report(proj, template_path)

    filename = f"{proj.name}_测温报告_{proj.created_at.strftime('%Y%m%d')}.docx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
