"""
Auto-detection service for FLIR thermal images.

Two modes:
  a) YOLO model exists → run inference → return device bounding boxes
  b) No model / model missing → spot the highest-temperature point → return single box

Boxes are returned in thermal-matrix coordinates, ready to save as annotations.
"""

import os
import numpy as np
from typing import Optional

# Model weights directory
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "weights")

# model_type → weight filename mapping
MODEL_MAP = {
    "transformer": "transformer.pt",
    "switchgear": "switchgear.pt",
    "cable": "cable.pt",
    "busbar": "busbar.pt",
    "insulator": "insulator.pt",
}


def _resolve_model_path(model_type: str) -> Optional[str]:
    """Return path to model weights file, or None if not found."""
    if model_type not in MODEL_MAP:
        return None
    path = os.path.join(MODEL_DIR, MODEL_MAP[model_type])
    return path if os.path.isfile(path) else None


def _yolo_detect(image_path: str, model_path: str) -> list[dict]:
    """
    Run YOLO inference on the thermal display image.

    Currently a PLACEHOLDER. When a real .pt model is placed in
    models/weights/, this function will:
      1. Load the YOLO model with torch.hub or ultralytics
      2. Run inference on the JPEG (display image)
      3. Convert display-image bboxes to thermal-matrix coords
      4. Return list of {x1, y1, x2, y2} in thermal coords

    For now, returns empty list (falls through to hotspot mode).
    """
    # TODO: integrate ultralytics YOLO when model is available
    # import torch
    # model = torch.hub.load('ultralytics/yolov5', 'custom', path=model_path)
    # results = model(image_path)
    # ... convert to thermal coords ...
    return []


def _hotspot_box(
    temp_matrix: np.ndarray,
    thermal_w: int,
    thermal_h: int,
) -> dict:
    """
    Create a single box centered on the highest-temperature pixel.

    Box size = 5% of the larger thermal dimension (adaptive to resolution).
    """
    max_idx = np.unravel_index(np.nanargmax(temp_matrix), temp_matrix.shape)
    my, mx = int(max_idx[0]), int(max_idx[1])
    half = int(max(thermal_w, thermal_h) * 0.025)  # 2.5% radius = 5% box
    half = max(half, 3)  # at least 3 px

    x1 = max(0, mx - half)
    y1 = max(0, my - half)
    x2 = min(thermal_w, mx + half)
    y2 = min(thermal_h, my + half)

    return {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "source": "auto",
        "label": "最高温点",
    }


def run_detection(
    image_path: str,
    model_type: str,
    temp_matrix: np.ndarray,
    thermal_w: int,
    thermal_h: int,
) -> list[dict]:
    """
    Main entry point. Returns a list of annotation dicts ready to insert.

    Each dict: {box_coords: {x1,y1,x2,y2}, source: "auto", label: str}

    Returns empty list if model_type is "none" (user chose manual-only).
    """
    if model_type == "none":
        return []

    model_path = _resolve_model_path(model_type)

    if model_path:
        # ── YOLO mode ───────────────────────────────────────────
        boxes = _yolo_detect(image_path, model_path)
        for b in boxes:
            b["source"] = "auto"
            b["label"] = model_type
        return boxes
    else:
        # ── Hotspot fallback mode ──────────────────────────────
        return [_hotspot_box(temp_matrix, thermal_w, thermal_h)]
