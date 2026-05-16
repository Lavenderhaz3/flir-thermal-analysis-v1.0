# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['backend/main.py'],
    pathex=[],
    binaries=[],
    datas=[('backend/templates', 'templates'), ('frontend/dist', 'frontend/dist')],
    hiddenimports=['uvicorn', 'uvicorn.loops.auto', 'uvicorn.protocols.http.auto', 'fastapi', 'sqlalchemy', 'sqlalchemy.sql.default_comparator', 'docxtpl', 'docx', 'PIL', 'PIL._imaging', 'numpy', 'numpy.core._methods', 'numpy.lib.format', 'pydantic'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='FLIR红外测温',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='FLIR红外测温',
)
app = BUNDLE(
    coll,
    name='FLIR红外测温.app',
    icon=None,
    bundle_identifier=None,
)
