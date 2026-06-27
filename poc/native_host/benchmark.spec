# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for benchmark.exe (--onedir, same as native_host)
#
# Run from poc/native_host/ with venv active:
#   pyinstaller benchmark.spec
#
# Output: dist/benchmark/benchmark.exe + dist/benchmark/_internal/
#
# In the transfer package, only benchmark.exe is copied to host\ because
# native_host's _internal\ already contains the full OpenVINO stack.
# benchmark.exe at runtime resolves _internal\ relative to its own location,
# so host\benchmark.exe + host\_internal\ (native_host's) works transparently.

from PyInstaller.utils.hooks import collect_all

ov_datas,  ov_binaries,  ov_hidden  = collect_all('openvino')
ovg_datas, ovg_binaries, ovg_hidden = collect_all('openvino_genai')
ovt_datas, ovt_binaries, ovt_hidden = collect_all('openvino_tokenizers')

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

# Drop the Python-bundled CRT DLLs (v14.31) so the frozen exe uses System32's
# v14.44 instead.  openvino_genai.dll was compiled with MSVC v14.40+ and has
# inlined std::mutex code that expects the SRWLOCK-based _Mtx_internal_imp
# layout (offset 0 = SRWLOCK, offset 8 = CONDITION_VARIABLE).  The bundled
# v14.31 initialises the struct with the old CRITICAL_SECTION layout
# (_Type at 0, _Cnd* at 8 lazily NULL), so the inlined lock code reads a
# NULL pointer at offset 8 and crashes.  System32 v14.44 uses the SRWLOCK
# layout that matches — identical to what the venv uses (confirmed working).
#
# Use EXACT file names to avoid dropping numpy's private copy
# (msvcp140-<hash>.dll), which would break numpy DLL loading.
_CRT_EXACT = {
    'msvcp140.dll',
    'msvcp140_atomic_wait.dll',
    'vcruntime140.dll',
    'vcruntime140_1.dll',
    'vccorlib140.dll',
    'concrt140.dll',
}
def _is_crt(name):
    b = _os.path.basename(name).lower()
    return b in _CRT_EXACT or b.startswith('api-ms-win-crt-')

def _drop_crt_2(binaries):
    return [(src, dst) for src, dst in binaries if not _is_crt(src)]

def _drop_crt_3(binaries):
    return [(name, src, kind) for name, src, kind in binaries if not _is_crt(name)]

a = Analysis(
    ['../model_setup/benchmark.py'],
    pathex=[],
    binaries=_drop_crt_2(ov_binaries + ovg_binaries + ovt_binaries),
    datas=ov_datas + ovg_datas + ovt_datas,
    hiddenimports=(
        ov_hidden + ovg_hidden + ovt_hidden +
        ['openvino._pyopenvino', 'openvino._offline_transformations']
    ),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # CRITICAL: openvino_telemetry must be excluded — see native_host.spec comment.
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
    exclude_binaries=True,
    name='benchmark',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
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
    name='benchmark',
)
