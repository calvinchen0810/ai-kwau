# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for native_host.exe (--onedir)
#
# Run from poc/native_host/ with venv active:
#   pyinstaller native_host.spec
#
# Output: dist/native_host/
#   native_host.exe        <-- Edge calls this directly
#   _internal/             <-- OpenVINO DLLs + Python runtime (~270 MB)

from PyInstaller.utils.hooks import collect_all

# Collect everything PyInstaller knows about these packages
ov_datas,  ov_binaries,  ov_hidden  = collect_all('openvino')
ovg_datas, ovg_binaries, ovg_hidden = collect_all('openvino_genai')
# openvino_tokenizers.dll is loaded at runtime by LLMPipeline as a C++ plugin;
# collect_all picks up the DLL from openvino_tokenizers/lib/
ovt_datas, ovt_binaries, ovt_hidden = collect_all('openvino_tokenizers')
# zhconv: pure-Python simplified↔traditional converter (includes data/zhcdict.json.gz)
zhc_datas, zhc_binaries, zhc_hidden = collect_all('zhconv')

# Drop development-only subdirectories (C++ headers, cmake, build tooling)
# These are never needed at inference runtime.
_DEV_DIRS = (
    '\\include\\', '/include/',
    '\\cmake\\',   '/cmake/',
    '\\tools\\',   '/tools/',
    '\\torch\\',   '/torch/',
    '\\lib\\cmake', '/lib/cmake',
)
def _keep(src):
    return not any(d in src for d in _DEV_DIRS)

ov_datas    = [(s, d) for s, d in ov_datas    if _keep(s)]
ov_binaries = [(s, d) for s, d in ov_binaries if _keep(s)]

import os as _os

# Drop only the exact-named Python-bundled CRT DLLs (v14.31) so the frozen
# exe falls back to System32's v14.44.  openvino_genai.dll was compiled with
# MSVC v14.40+ and has inlined std::mutex code expecting the SRWLOCK-based
# _Mtx_internal_imp layout; v14.31's CRITICAL_SECTION layout causes a NULL
# pointer crash at mtx_do_lock+0x9c.  Exact matching preserves numpy's
# private hash-suffixed copy (msvcp140-<hash>.dll).
_CRT_EXACT = {
    'msvcp140.dll', 'msvcp140_atomic_wait.dll',
    'vcruntime140.dll', 'vcruntime140_1.dll',
    'vccorlib140.dll', 'concrt140.dll',
}
def _is_crt(name):
    b = _os.path.basename(name).lower()
    return b in _CRT_EXACT or b.startswith('api-ms-win-crt-')

def _drop_crt_2(binaries):
    return [(src, dst) for src, dst in binaries if not _is_crt(src)]

def _drop_crt_3(binaries):
    return [(name, src, kind) for name, src, kind in binaries if not _is_crt(name)]

a = Analysis(
    ['native_host.py'],
    pathex=[],
    binaries=_drop_crt_2(ov_binaries + ovg_binaries + ovt_binaries + zhc_binaries),
    datas=ov_datas + ovg_datas + ovt_datas + zhc_datas,
    hiddenimports=(
        ov_hidden + ovg_hidden + ovt_hidden + zhc_hidden +
        ['openvino._pyopenvino', 'openvino._offline_transformations', 'zhconv']
    ),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Only exclude heavy third-party packages we're certain are unused.
    # Do NOT exclude standard library modules — pathlib needs urllib,
    # zipfile is used by PyInstaller's own runtime, xml is needed by
    # OpenVINO's IR frontend. Excluding them breaks the boot sequence.
    #
    # CRITICAL: openvino_telemetry must be excluded.
    # openvino/__init__.py imports openvino.tools.ovc which calls
    # telemetry.send_event() → submits GA4Backend.send to a ThreadPoolExecutor.
    # In PyInstaller, that worker thread crashes with access violation
    # (SSL/network stack not fully initialised in the bundle).
    # With openvino_telemetry excluded, ovc/telemetry_utils.py falls back to
    # the bundled telemetry_stub (no-op) — no thread pool, no crash.
    excludes=[
        'tkinter', 'matplotlib', 'PIL', 'cv2', 'scipy', 'pandas',
        'IPython', 'jupyter', 'notebook', 'pytest',
        'turtle', 'curses',
        'openvino_telemetry',
    ],
    noarchive=False,
)

a.binaries = _drop_crt_3(a.binaries)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,       # keep binaries separate (onedir)
    name='native_host',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                   # UPX can corrupt OpenVINO / TBB DLLs
    console=True,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name='native_host',
)
