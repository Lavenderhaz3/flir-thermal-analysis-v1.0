"""Word report generation for FLIR thermal analysis projects."""

import io
from datetime import datetime
from docxtpl import DocxTemplate

from models.schema import Project, Image


def generate_report(project: Project, template_path: str) -> io.BytesIO:
    """Generate a .docx report for a project.

    Args:
        project: Project ORM object with .images and .annotations loaded.
        template_path: Path to the docxtpl Word template.

    Returns:
        BytesIO buffer containing the generated .docx.
    """
    doc = DocxTemplate(template_path)

    images_data = []
    for img in project.images:
        image_entry = {
            "filename": img.filename,
            "date": img.date or "-",
            "area": img.area or "-",
            "equipment": img.equipment or "-",
            "t_max": img.t_max,
            "t_min": img.t_min,
            "t_mean": img.t_mean,
            "annotations": [
                {
                    "box": f"({a.box_coords.get('x1')},{a.box_coords.get('y1')})-"
                           f"({a.box_coords.get('x2')},{a.box_coords.get('y2')})",
                    "t_max": a.t_max,
                    "t_mean": a.t_mean,
                    "status": a.status,
                }
                for a in img.annotations
            ],
        }
        images_data.append(image_entry)

    context = {
        "project_name": project.name,
        "report_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "image_count": len(images_data),
        "images": images_data,
    }

    doc.render(context)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
