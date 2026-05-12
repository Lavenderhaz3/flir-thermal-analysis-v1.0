"""Filename parser for FLIR image naming convention.

Two supported formats:
  NEW: YYYY-MM-DD@<area>-<equip_id>[<type>][-<seq>].jpg    (recommended)
  OLD: YYYY-MM-DD<area>-<equip_id>[-<seq>]<type>.jpg      (legacy)

Examples:
  2025-05-02@主变区-T01.jpg
  2025-05-02@主变区-T01变压器.jpg
  2025-05-02@500kV交流场-QF01-001.jpg
  2025-03-20主变区-T01变压器.jpg          (old format)
"""

import re
from typing import Optional

# New format: date @ area - equip_id [type] [-seq]
PATTERN_NEW = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})"
    r"@(?P<area>[A-Za-z0-9\u4e00-\u9fff]+)"
    r"-(?P<equip_id>[A-Za-z0-9]+)"
    r"(?:(?P<type>[A-Za-z0-9\u4e00-\u9fff]+))?"
    r"(?:-\d+)?"
    r"\.(jpg|jpeg)$",
    re.IGNORECASE,
)

# Old format: date area - equip_id [-seq] type
PATTERN_OLD = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})"
    r"(?P<area>[A-Za-z0-9\u4e00-\u9fff]+)"
    r"-(?P<equip_id>[A-Za-z0-9]+)"
    r"(?:-\d+)?"
    r"(?P<type>[A-Za-z0-9\u4e00-\u9fff]+)"
    r"\.(jpg|jpeg)$",
    re.IGNORECASE,
)


def parse_filename(filename: str) -> Optional[dict]:
    """Parse filename into date/area/equip_id/type components.
    Returns None if filename doesn't match either format.
    """
    for pat in (PATTERN_NEW, PATTERN_OLD):
        m = pat.match(filename)
        if m:
            return m.groupdict()
    return None
