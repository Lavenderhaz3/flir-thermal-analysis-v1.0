"""Filename parser for FLIR image naming convention.

Format: YYYY-MM-DD<area>-<equip_id><type>.jpg
Example: 2025-05-02主变区-T01变压器.jpg
"""

import re
from typing import Optional

PATTERN = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})"
    r"(?P<area>[A-Za-z\u4e00-\u9fff]+)"
    r"-(?P<equip_id>[A-Za-z0-9]+)"
    r"(?:-\d+)?"
    r"(?P<type>[A-Za-z\u4e00-\u9fff]+)"
    r"\.(jpg|jpeg)$",
    re.IGNORECASE,
)


def parse_filename(filename: str) -> Optional[dict]:
    """Parse filename into date/area/equip_id/type components.

    Returns None if filename doesn't match the expected format.
    """
    m = PATTERN.match(filename)
    if not m:
        return None
    return m.groupdict()
