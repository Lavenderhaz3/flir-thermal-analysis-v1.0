#!/usr/bin/env python3
"""
FLIR Radiometric JPEG Temperature Extraction — Proof of Concept
================================================================
Verifies that FLIR infrared images can be processed in Python (Linux/Docker compatible).
Supports direct JPEG + zip upload scenarios.

Key corrections from FLIR image processing research:
  - Byte-order fix: FLIR PNG stores uint16 in wrong endianness
  - Correct formula: T = B/ln(R1/(R2*(raw_obj+O)) + F) (no Real2IR division)
  - Full atmospheric correction (emissivity, distance, humidity, window, reflection)

Output per image:
  - Temperature matrix (°C)
  - Full-image max/min/mean
  - Annotated preview image
  - Metadata JSON

Tested cameras: FLIR AX8, FLIR T1040
"""

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import warnings

import numpy as np
from PIL import Image, ImageDraw, ImageFont


# ══════════════════════════════════════════════════════════════════════
# Step 1: Extract all FLIR metadata via exiftool
# ══════════════════════════════════════════════════════════════════════

FLIR_TAGS = [
    "PlanckR1", "PlanckR2", "PlanckB", "PlanckF", "PlanckO",
    "Emissivity", "ObjectDistance", "AtmosphericTemperature",
    "ReflectedApparentTemperature", "RelativeHumidity",
    "IRWindowTemperature", "IRWindowTransmission",
    "RawThermalImageWidth", "RawThermalImageHeight",
    "Make", "Model", "DateTimeOriginal",
]


def extract_metadata(image_path: str) -> dict:
    """Run exiftool and return a dict of FLIR-relevant tags."""
    args = ["exiftool", "-j"] + [f"-{t}" for t in FLIR_TAGS] + [image_path]
    result = subprocess.run(args, capture_output=True, text=True)
    data = json.loads(result.stdout)
    if not data:
        raise RuntimeError(f"exiftool returned no data for {image_path}")
    return data[0]


# ══════════════════════════════════════════════════════════════════════
# Step 2: Extract raw thermal image (embedded PNG)
# ══════════════════════════════════════════════════════════════════════

def extract_raw_thermal(image_path: str) -> np.ndarray:
    """Extract the embedded RawThermalImage PNG and return as float64 array.

    FLIR stores the embedded PNG with byte-swapped uint16 values.
    This function fixes the byte order on load.
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

    # FLIR byte-order fix: PNG stores uint16 in wrong endianness
    arr = np.right_shift(arr, 8) + np.left_shift(np.bitwise_and(arr, 0x00FF), 8)
    return arr.astype(np.float64)


# ══════════════════════════════════════════════════════════════════════
# Step 3: Convert raw values to temperature via Planck formula
# ══════════════════════════════════════════════════════════════════════

def raw_to_temperature(raw: np.ndarray, meta: dict) -> np.ndarray:
    """
    Convert raw thermal pixel values to Celsius with full atmospheric correction.

    Formula (ported from Thermimage R package raw2temp, also used by flirpy and
    FlirImageExtractor):

      T = B / ln(R1 / (R2 * (raw_obj + O)) + F) - 273.15

    where raw_obj is the raw pixel value corrected for atmospheric transmission,
    window transmission, reflected radiation, and emissivity.

    The raw values are camera counts used directly — no Real2IR division.
    """
    PR1 = float(meta["PlanckR1"])
    PR2 = float(meta["PlanckR2"])
    PB = float(meta["PlanckB"])
    PF = float(meta["PlanckF"])
    PO = float(meta["PlanckO"])

    def _parse_float(val):
        if isinstance(val, (int, float)):
            return float(val)
        return float(str(val).strip().split(" ")[0])

    E = float(meta.get("Emissivity", 1.0))
    OD = _parse_float(meta.get("ObjectDistance", "1.0"))
    RTemp = _parse_float(meta.get("ReflectedApparentTemperature", "20.0"))
    ATemp = _parse_float(meta.get("AtmosphericTemperature", "20.0"))
    IRWTemp = _parse_float(meta.get("IRWindowTemperature", "20.0"))
    IRT = float(meta.get("IRWindowTransmission", 1.0))
    RH = _parse_float(meta.get("RelativeHumidity", "50.0"))

    # Atmospheric transmission constants
    ATA1, ATA2 = 0.006569, 0.01262
    ATB1, ATB2 = -0.002276, -0.00667
    ATX = 1.9

    emiss_wind = 1.0 - IRT
    refl_wind = 0.0

    # Water vapour pressure
    h2o = (RH / 100.0) * math.exp(
        1.5587 + 0.06939 * ATemp - 0.00027816 * ATemp**2 + 0.00000068455 * ATemp**3
    )
    tau1 = ATX * np.exp(-np.sqrt(OD / 2.0) * (ATA1 + ATB1 * np.sqrt(h2o))) + \
           (1.0 - ATX) * np.exp(-np.sqrt(OD / 2.0) * (ATA2 + ATB2 * np.sqrt(h2o)))
    tau2 = tau1

    # Radiance components in camera-count space
    raw_refl1 = PR1 / (PR2 * (np.exp(PB / (RTemp + 273.15)) - PF)) - PO
    raw_refl1_attn = (1.0 - E) / E * raw_refl1

    raw_atm1 = PR1 / (PR2 * (np.exp(PB / (ATemp + 273.15)) - PF)) - PO
    raw_atm1_attn = (1.0 - tau1) / E / tau1 * raw_atm1

    raw_wind = PR1 / (PR2 * (np.exp(PB / (IRWTemp + 273.15)) - PF)) - PO
    raw_wind_attn = emiss_wind / E / tau1 / IRT * raw_wind

    raw_refl2 = PR1 / (PR2 * (np.exp(PB / (RTemp + 273.15)) - PF)) - PO
    raw_refl2_attn = refl_wind / E / tau1 / IRT * raw_refl2

    raw_atm2 = PR1 / (PR2 * (np.exp(PB / (ATemp + 273.15)) - PF)) - PO
    raw_atm2_attn = (1.0 - tau2) / E / tau1 / IRT / tau2 * raw_atm2

    # Remove atmospheric and reflected components from measured raw
    ediv = 1.0 / E / tau1 / IRT / tau2
    raw_obj = (
        raw * ediv
        - raw_atm1_attn
        - raw_atm2_attn
        - raw_wind_attn
        - raw_refl1_attn
        - raw_refl2_attn
    )

    # Planck inversion: T = B / ln(R1 / (R2 * (raw_obj + O)) + F)
    val_to_log = PR1 / (PR2 * (raw_obj + PO)) + PF

    valid = val_to_log > 0
    T_kelvin = np.full_like(raw, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        T_kelvin[valid] = PB / np.log(val_to_log[valid])

    return T_kelvin - 273.15


# ══════════════════════════════════════════════════════════════════════
# Step 4: Full pipeline
# ══════════════════════════════════════════════════════════════════════

REQUIRED_TAGS = [
    "PlanckR1", "PlanckR2", "PlanckB", "PlanckF", "PlanckO",
    "RawThermalImageWidth", "RawThermalImageHeight",
]


def compute_temperatures(image_path: str) -> tuple[np.ndarray, dict]:
    """
    Full pipeline: extract metadata → extract raw thermal → convert to °C.
    Returns (temp_matrix_celsius, exif_meta).
    """
    exif_meta = extract_metadata(image_path)

    missing = [t for t in REQUIRED_TAGS if t not in exif_meta]
    if missing:
        raise RuntimeError(
            f"Missing required FLIR radiometric tags: {missing}\n"
            f"This image may not be a radiometric JPEG."
        )

    raw = extract_raw_thermal(image_path)
    temp_c = raw_to_temperature(raw, exif_meta)

    nan_count = np.isnan(temp_c).sum()
    if nan_count > 0:
        print(f"  Warning: {nan_count} NaN pixels ({nan_count/temp_c.size*100:.1f}%)")

    return temp_c, exif_meta


# ══════════════════════════════════════════════════════════════════════
# Step 5: Generate annotated preview (use FLIR JPEG as base image)
# ══════════════════════════════════════════════════════════════════════

def create_preview(
    temp_c: np.ndarray, max_pos: tuple, output_path: str,
    image_path: str = None
) -> Image.Image:
    """Create an annotated preview using the FLIR JPEG as the base image.

    The FLIR radiometric JPEG is already a color-rendered thermal image
    using the Iron palette. We use it directly and overlay annotations,
    guaranteeing exact color match with the original.
    """
    if image_path:
        img = Image.open(image_path).convert("RGB")
    else:
        # Fallback: render from temperature data with hot-metal colormap
        t_min = float(np.nanmin(temp_c))
        t_max = float(np.nanmax(temp_c))
        norm = (temp_c - t_min) / (t_max - t_min) * 255
        norm = np.nan_to_num(norm, nan=0).clip(0, 255).astype(np.uint8)
        colormap = np.zeros((256, 3), dtype=np.uint8)
        for i in range(256):
            if i < 85:      colormap[i] = [i * 3, 0, 0]
            elif i < 170:   colormap[i] = [255, (i - 85) * 3, 0]
            else:           colormap[i] = [255, 255, (i - 170) * 3]
        img = Image.fromarray(colormap[norm]).convert("RGB")

    t_min = float(np.nanmin(temp_c))
    t_max = float(np.nanmax(temp_c))

    # Scale for visibility if image is large
    w, h = img.size
    if max(w, h) > 800:
        view_scale = 800 / max(w, h)
    else:
        view_scale = 1.0
    new_size = (int(w * view_scale), int(h * view_scale))
    img_resized = img.resize(new_size, Image.LANCZOS)

    draw = ImageDraw.Draw(img_resized)
    y, x = max_pos
    x_scaled = int(x * view_scale)
    y_scaled = int(y * view_scale)
    r = max(5, min(img_resized.size) // 60)
    draw.ellipse(
        [x_scaled - r, y_scaled - r, x_scaled + r, y_scaled + r],
        outline=(0, 255, 0),
        width=2,
    )

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except Exception:
        font = ImageFont.load_default()

    draw.text(
        (5, 5),
        f"Tmax: {t_max:.1f}C  Tmin: {t_min:.1f}C",
        fill=(255, 255, 255),
        font=font,
    )

    img_resized.save(output_path)
    return img_resized


# ══════════════════════════════════════════════════════════════════════
# Step 6: Report
# ══════════════════════════════════════════════════════════════════════

def report(
    image_path: str,
    temp_c: np.ndarray,
    exif_meta: dict,
    output_dir: str,
) -> dict:
    max_idx = np.unravel_index(np.nanargmax(temp_c), temp_c.shape)
    min_idx = np.unravel_index(np.nanargmin(temp_c), temp_c.shape)

    result = {
        "file": os.path.basename(image_path),
        "camera": {
            "make": exif_meta.get("Make", "unknown"),
            "model": exif_meta.get("Model", "unknown"),
        },
        "thermal_resolution": list(temp_c.shape),
        "temperature_c": {
            "min": round(float(np.nanmin(temp_c)), 2),
            "max": round(float(np.nanmax(temp_c)), 2),
            "mean": round(float(np.nanmean(temp_c)), 2),
        },
        "max_position": [int(max_idx[0]), int(max_idx[1])],
        "min_position": [int(min_idx[0]), int(min_idx[1])],
        "scaling": {
            "planck_r1": exif_meta.get("PlanckR1"),
            "planck_r2": exif_meta.get("PlanckR2"),
            "planck_b": exif_meta.get("PlanckB"),
            "planck_f": exif_meta.get("PlanckF"),
            "planck_o": exif_meta.get("PlanckO"),
        },
    }

    os.makedirs(output_dir, exist_ok=True)

    json_path = os.path.join(output_dir, "result.json")
    with open(json_path, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    npy_path = os.path.join(output_dir, "temperature_matrix.npy")
    np.save(npy_path, temp_c)

    preview_path = os.path.join(output_dir, "preview.png")
    create_preview(temp_c, max_idx, preview_path, image_path)

    return result


# ══════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Verify FLIR radiometric JPEG temperature extraction"
    )
    parser.add_argument("image", help="Path to FLIR radiometric JPEG")
    parser.add_argument(
        "-o", "--output", default="./flir_output", help="Output directory"
    )
    args = parser.parse_args()

    print(f"Processing: {args.image}")
    print(f"Output:    {args.output}")
    print("-" * 50)

    if not os.path.isfile(args.image):
        print(f"ERROR: {args.image} not found.")
        sys.exit(1)

    # Quick validation
    try:
        make_raw = subprocess.run(
            ["exiftool", "-Make", args.image], capture_output=True, text=True
        ).stdout
        if "flir" not in make_raw.lower():
            print(f"Warning: Not a FLIR camera image (Make = {make_raw.strip()})")
            print("Temperature extraction will likely fail.\n")
    except Exception:
        pass

    try:
        temp_c, exif_meta = compute_temperatures(args.image)
    except RuntimeError as e:
        print(f"ERROR: {e}")
        print("\nThis image is NOT a FLIR radiometric JPEG.")
        print("It may be a screenshot, non-radiometric export, or regular photo.")
        sys.exit(1)

    result = report(args.image, temp_c, exif_meta, args.output)

    print(f"\n  Temperature extraction successful!")
    print(f"  Camera:  {result['camera']['make']} {result['camera']['model']}")
    print(f"  Thermal resolution: {result['thermal_resolution'][1]}x{result['thermal_resolution'][0]}")
    print(f"  Temperature range:  {result['temperature_c']['min']}°C – {result['temperature_c']['max']}°C")
    print(f"  Mean temperature:   {result['temperature_c']['mean']}°C")
    print(f"  Max temp location:  ({result['max_position'][0]}, {result['max_position'][1]})")
    print(f"\n  Output files:")
    print(f"    {os.path.join(args.output, 'result.json')}")
    print(f"    {os.path.join(args.output, 'temperature_matrix.npy')}")
    print(f"    {os.path.join(args.output, 'preview.png')}")
    print(f"\n  PoC verified: FLIR radiometric JPEG works in Python on macOS/Linux/Docker.")


if __name__ == "__main__":
    main()
