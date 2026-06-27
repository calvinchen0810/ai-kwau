# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for register.exe (--onefile)
#
# Run from poc/native_host/ with venv active:
#   pyinstaller register.spec
#
# Output: dist/register.exe  (~8 MB, self-contained)
# host_manifest.json is embedded; register.exe writes the patched copy
# to its own directory at runtime, and the registry points there.

a = Analysis(
    ['register.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('host_manifest.json', '.'),   # embedded template; patched at runtime
    ],
    hiddenimports=['winreg'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL', 'scipy'],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

# --onefile: merge everything into a single exe
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='register',
    debug=False,
    strip=False,
    upx=True,
    console=True,
    icon=None,
)
