"""Word report generation for FLIR thermal analysis projects."""

import io
from datetime import datetime
from typing import Optional

from docxtpl import DocxTemplate

from models.schema import Project


def _compute_relative_delta(
    t_max: float,
    normal_temp: float,
    ambient_temp: Optional[float],
) -> Optional[float]:
    """
    相对温差 = (T_max - T_normal) / (T_max - T_ambient)

    Returns None if ambient_temp is missing or denominator would be zero.
    """
    if ambient_temp is None:
        return None
    denom = t_max - ambient_temp
    if abs(denom) < 1e-6:
        return None
    return (t_max - normal_temp) / denom


def _fmt(val: Optional[float], suffix: str = "", fallback: str = "N/A") -> str:
    """Format a float value for the report, handling None."""
    if val is None:
        return fallback
    return f"{val:.2f}{suffix}"


def generate_report(
    project: Project,
    template_path: str,
    normal_temp: float,
    ambient_temp_override: Optional[float] = None,
) -> io.BytesIO:
    """Generate a .docx report for a project.

    Args:
        project: Project ORM object with .images and .annotations loaded.
        template_path: Path to the docxtpl Word template.
        normal_temp: Normal equipment temperature (°C).
        ambient_temp_override: Manual ambient temp override. None = use FLIR EXIF.

    Returns:
        BytesIO buffer containing the generated .docx.
    """
    doc = DocxTemplate(template_path)

    images_data = []
    for img in project.images:
        # Resolve ambient temperature: override > FLIR EXIF > fallback
        ambient = ambient_temp_override if ambient_temp_override is not None else img.atmospheric_temp

        image_entry = {
            "filename": img.filename,
            "date": img.date or "-",
            "area": img.area or "-",
            "equipment": img.equipment or "-",
            "t_max": img.t_max,
            "t_min": img.t_min,
            "t_mean": img.t_mean,
            "ambient_temp": ambient,
            "annotations": [],
        }

        for a in img.annotations:
            rel_delta = _compute_relative_delta(a.t_max, normal_temp, ambient)
            image_entry["annotations"].append({
                "box": (f"({a.box_coords.get('x1')},{a.box_coords.get('y1')})-"
                        f"({a.box_coords.get('x2')},{a.box_coords.get('y2')})"),
                "t_max": a.t_max,
                "t_mean": a.t_mean,
                "normal_temp": normal_temp,
                "ambient_temp": ambient,
                "relative_delta": rel_delta,
                "relative_delta_pct": f"{rel_delta * 100:.1f}%" if rel_delta is not None else "N/A",
                "status": a.status,
            })

        images_data.append(image_entry)

    context = {
        "project_name": project.name,
        "report_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "normal_temp": normal_temp,
        "image_count": len(images_data),
        "images": images_data,
    }

    doc.render(context)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
