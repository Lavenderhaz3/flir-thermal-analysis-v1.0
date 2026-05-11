"""
FLIR radiometric JPEG temperature extraction service.
Ported from flir_verify_poc.py — verified against FlirImageExtractor / flirpy / Thermimage.
"""

import json
import math
import os
import subprocess
import tempfile
import warnings
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── Required EXIF tags for radiometric JPEG ──────────────────────────
FLIR_TAGS = [
    "PlanckR1", "PlanckR2", "PlanckB", "PlanckF", "PlanckO",
    "Emissivity", "ObjectDistance", "AtmosphericTemperature",
    "ReflectedApparentTemperature", "RelativeHumidity",
    "IRWindowTemperature", "IRWindowTransmission",
    "RawThermalImageWidth", "RawThermalImageHeight",
    "Make", "Model", "DateTimeOriginal",
]

REQUIRED_TAGS = [
    "PlanckR1", "PlanckR2", "PlanckB", "PlanckF", "PlanckO",
    "RawThermalImageWidth", "RawThermalImageHeight",
]


# ── Step 1: Extract metadata ─────────────────────────────────────────
def extract_metadata(image_path: str) -> dict:
    args = ["exiftool", "-j"] + [f"-{t}" for t in FLIR_TAGS] + [image_path]
    result = subprocess.run(args, capture_output=True, text=True)
    data = json.loads(result.stdout)
    if not data:
        raise RuntimeError(f"exiftool returned no data for {image_path}")
    return data[0]


# ── Step 2: Extract raw thermal (embedded PNG) ────────────────────────
def extract_raw_thermal(image_path: str) -> np.ndarray:
    """Extract embedded RawThermalImage PNG with byte-order fix.

    FLIR stores uint16 values in the embedded PNG in wrong endianness.
    """
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name

    subprocess.run(
        ["exiftool", "-b", "-RawThermalImage", image_path],
        stdout=open(tmp_path, "wb"),
        check=True,
    )

    raw_img = Image.open(tmp_path)
    arr = np.array(raw_img, dtype=np.uint16)
    os.unlink(tmp_path)

    # FLIR byte-order fix
    arr = np.right_shift(arr, 8) + np.left_shift(np.bitwise_and(arr, 0x00FF), 8)
    return arr.astype(np.float64)


# ── Step 3: Planck temperature inversion ──────────────────────────────
def raw_to_temperature(raw: np.ndarray, meta: dict) -> np.ndarray:
    """Convert raw thermal pixel values to °C with full atmospheric correction.

    Formula: T = B / ln(R1 / (R2 * (raw_obj + O)) + F) - 273.15
    Raw values are camera counts used directly — no Real2IR division.
    """
    PR1 = float(meta["PlanckR1"])
    PR2 = float(meta["PlanckR2"])
    PB = float(meta["PlanckB"])
    PF = float(meta["PlanckF"])
    PO = float(meta["PlanckO"])

    def _pf(val):
        if isinstance(val, (int, float)):
            return float(val)
        return float(str(val).strip().split(" ")[0])

    E = float(meta.get("Emissivity", 1.0))
    OD = _pf(meta.get("ObjectDistance", "1.0"))
    RTemp = _pf(meta.get("ReflectedApparentTemperature", "20.0"))
    ATemp = _pf(meta.get("AtmosphericTemperature", "20.0"))
    IRWTemp = _pf(meta.get("IRWindowTemperature", "20.0"))
    IRT = float(meta.get("IRWindowTransmission", 1.0))
    RH = _pf(meta.get("RelativeHumidity", "50.0"))

    # Atmospheric transmission constants
    ATA1, ATA2 = 0.006569, 0.01262
    ATB1, ATB2 = -0.002276, -0.00667
    ATX = 1.9
    emiss_wind, refl_wind = 1.0 - IRT, 0.0

    # Water vapour pressure
    h2o = (RH / 100.0) * math.exp(
        1.5587 + 0.06939 * ATemp - 0.00027816 * ATemp**2 + 0.00000068455 * ATemp**3
    )
    tau1 = ATX * np.exp(-np.sqrt(OD / 2.0) * (ATA1 + ATB1 * np.sqrt(h2o))) + \
           (1.0 - ATX) * np.exp(-np.sqrt(OD / 2.0) * (ATA2 + ATB2 * np.sqrt(h2o)))
    tau2 = tau1

    # Radiance components in camera-count space
    raw_refl1 = PR1 / (PR2 * (np.exp(PB / (RTemp + 273.15)) - PF)) - PO
    raw_atm1 = PR1 / (PR2 * (np.exp(PB / (ATemp + 273.15)) - PF)) - PO
    raw_wind = PR1 / (PR2 * (np.exp(PB / (IRWTemp + 273.15)) - PF)) - PO
    raw_refl2 = PR1 / (PR2 * (np.exp(PB / (RTemp + 273.15)) - PF)) - PO
    raw_atm2 = PR1 / (PR2 * (np.exp(PB / (ATemp + 273.15)) - PF)) - PO

    ediv = 1.0 / E / tau1 / IRT / tau2
    raw_obj = (
        raw * ediv
        - (1.0 - E) / E * raw_refl1
        - (1.0 - tau1) / E / tau1 * raw_atm1
        - emiss_wind / E / tau1 / IRT * raw_wind
        - refl_wind / E / tau1 / IRT * raw_refl2
        - (1.0 - tau2) / E / tau1 / IRT / tau2 * raw_atm2
    )

    # Planck inversion
    val_to_log = PR1 / (PR2 * (raw_obj + PO)) + PF
    valid = val_to_log > 0
    T_kelvin = np.full_like(raw, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        T_kelvin[valid] = PB / np.log(val_to_log[valid])

    return T_kelvin - 273.15


# ── Step 4: Full pipeline ─────────────────────────────────────────────
def compute_temperatures(image_path: str) -> tuple:
    """Full pipeline: metadata → raw → temperature matrix.

    Returns (temp_celsius, exif_meta).
    """
    exif_meta = extract_metadata(image_path)

    missing = [t for t in REQUIRED_TAGS if t not in exif_meta]
    if missing:
        raise RuntimeError(
            f"Missing required FLIR radiometric tags: {missing}\n"
            f"Image may not be a radiometric JPEG."
        )

    raw = extract_raw_thermal(image_path)
    temp_c = raw_to_temperature(raw, exif_meta)
    return temp_c, exif_meta


# ── Step 5: Preview image ─────────────────────────────────────────────
def create_preview(image_path: str, temp_c: np.ndarray, output_path: str):
    """Create annotated preview using the FLIR JPEG as base image."""
    if image_path and os.path.exists(image_path):
        img = Image.open(image_path).convert("RGB")
    else:
        # Fallback: render from temperature
        t_min, t_max = float(np.nanmin(temp_c)), float(np.nanmax(temp_c))
        norm = np.clip((temp_c - t_min) / (t_max - t_min) * 255, 0, 255)
        norm = np.nan_to_num(norm, nan=0).astype(np.uint8)
        colormap = np.zeros((256, 3), dtype=np.uint8)
        for i in range(256):
            if i < 85:
                colormap[i] = [i * 3, 0, 0]
            elif i < 170:
                colormap[i] = [255, (i - 85) * 3, 0]
            else:
                colormap[i] = [255, 255, (i - 170) * 3]
        img = Image.fromarray(colormap[norm]).convert("RGB")

    w, h = img.size
    view_scale = 800 / max(w, h) if max(w, h) > 800 else 1.0
    new_size = (int(w * view_scale), int(h * view_scale))
    img_resized = img.resize(new_size, Image.LANCZOS)

    draw = ImageDraw.Draw(img_resized)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except Exception:
        font = ImageFont.load_default()
    t_min, t_max = float(np.nanmin(temp_c)), float(np.nanmax(temp_c))
    draw.text((5, 5), f"Tmax: {t_max:.1f}C  Tmin: {t_min:.1f}C", fill=(255, 255, 255), font=font)
    img_resized.save(output_path)


# ── Public API ────────────────────────────────────────────────────────
def process_image(image_path: str, output_dir: str) -> dict:
    """Full processing: extract temperatures, save .npy + preview.

    Returns dict with paths and stats.
    """
    temp_c, exif_meta = compute_temperatures(image_path)
    os.makedirs(output_dir, exist_ok=True)

    # Save temperature matrix
    npy_path = os.path.join(output_dir, "temperature_matrix.npy")
    np.save(npy_path, temp_c)

    # Save preview
    preview_path = os.path.join(output_dir, "preview.png")
    create_preview(image_path, temp_c, preview_path)

    # Get display image size
    display_w = display_h = None
    try:
        display_img = Image.open(image_path)
        display_w, display_h = display_img.size
    except Exception:
        pass

    return {
        "thermal_npy_path": npy_path,
        "preview_path": preview_path,
        "t_min": round(float(np.nanmin(temp_c)), 2),
        "t_max": round(float(np.nanmax(temp_c)), 2),
        "t_mean": round(float(np.nanmean(temp_c)), 2),
        "thermal_width": int(exif_meta.get("RawThermalImageWidth", temp_c.shape[1])),
        "thermal_height": int(exif_meta.get("RawThermalImageHeight", temp_c.shape[0])),
        "display_width": display_w,
        "display_height": display_h,
        "atmospheric_temp": _safe_float(exif_meta.get("AtmosphericTemperature")),
        "camera_make": exif_meta.get("Make", "unknown"),
        "camera_model": exif_meta.get("Model", "unknown"),
    }



def _safe_float(val) -> Optional[float]:
    """Safely convert a value to float, returning None on failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
