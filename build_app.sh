#!/bin/bash
# ──────────────────────────────────────────────────────────
#  Build macOS .app for FLIR Thermal Analysis
#  Usage: ./build_app.sh
# ──────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "═══════════════════════════════════════════"
echo "  Building FLIR Thermal Analysis .app"
echo "═══════════════════════════════════════════"

# ── Step 1: Build frontend ─────────────────────────────
echo "[1/4] Building frontend..."
cd "$ROOT/frontend"
npm run build

# ── Step 2: Install PyInstaller if needed ──────────────
echo "[2/4] Checking PyInstaller..."
python3 -c "import PyInstaller" 2>/dev/null || pip3 install pyinstaller

# ── Step 3: Collect data files ─────────────────────────
echo "[3/4] Collecting data files..."

# Ensure template exists
TEMPLATE_DIR="$ROOT/backend/templates"
mkdir -p "$TEMPLATE_DIR"
if [ ! -f "$TEMPLATE_DIR/report.docx" ]; then
    echo "  Generating default report template..."
    cd "$ROOT/backend"
    python3 -c "from services.create_template import create_default_template; create_default_template('$TEMPLATE_DIR/report.docx')"
fi

# ── Step 4: Run PyInstaller ────────────────────────────
echo "[4/4] Running PyInstaller..."
cd "$ROOT"

python3 -m PyInstaller \
    --name "FLIR红外测温" \
    --windowed \
    --onedir \
    --add-data "backend/templates:templates" \
    --add-data "frontend/dist:frontend/dist" \
    --hidden-import uvicorn \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import fastapi \
    --hidden-import sqlalchemy \
    --hidden-import sqlalchemy.sql.default_comparator \
    --hidden-import docxtpl \
    --hidden-import docx \
    --hidden-import PIL \
    --hidden-import PIL._imaging \
    --hidden-import numpy \
    --hidden-import numpy.core._methods \
    --hidden-import numpy.lib.format \
    --hidden-import pydantic \
    --clean \
    backend/main.py

echo ""
echo "═══════════════════════════════════════════"
echo "  Build complete!"
echo "  .app: $ROOT/dist/FLIR红外测温.app"
echo "═══════════════════════════════════════════"
