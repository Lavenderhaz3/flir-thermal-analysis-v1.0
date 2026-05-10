"""Create and manage the Word report template."""

import os
from docx import Document


def create_default_template(output_path: str):
    """Create a default docxtpl template with Jinja2 placeholders."""
    doc = Document()

    doc.add_heading("FLIR 红外测温分析报告", level=0)

    doc.add_paragraph(f"项目名称: {{project_name}}")
    doc.add_paragraph(f"报告日期: {{report_date}}")
    doc.add_paragraph(f"图片总数: {{image_count}}")

    doc.add_heading("设备测温明细", level=1)

    # Jinja2 for-loop in table
    doc.add_paragraph("{% for img in images %}")
    doc.add_heading("{{ img.filename }}", level=2)

    table = doc.add_table(rows=5, cols=2, style="Table Grid")
    headers = ["日期", "区域", "设备编号", "最高温 (°C)", "平均温 (°C)"]
    values = ["{{ img.date }}", "{{ img.area }}", "{{ img.equipment }}",
              "{{ img.t_max }}", "{{ img.t_mean }}"]
    for i, (h, v) in enumerate(zip(headers, values)):
        table.rows[i].cells[0].text = h
        table.rows[i].cells[1].text = v

    doc.add_paragraph("框选标注:")
    doc.add_paragraph("{% for ann in img.annotations %}")
    doc.add_paragraph("  框 {{ ann.box }} — 最高温: {{ ann.t_max }}°C, 平均温: {{ ann.t_mean }}°C")
    doc.add_paragraph("{% endfor %}")
    doc.add_paragraph("{% endfor %}")

    doc.save(output_path)
    return output_path


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "templates", "report.docx")
    create_default_template(out)
    print(f"Template saved to {out}")
