"""
Step 3: Register the native messaging host with Microsoft Edge.
Run once after loading the extension and obtaining its ID.

Usage (source / dev):
  python register.py --extension-id <EDGE_EXTENSION_ID>

Usage (PyInstaller exe in transfer package):
  register.exe --extension-id <EDGE_EXTENSION_ID>
  (called automatically by install.bat)
"""
import argparse
import json
import os
import sys
import winreg
from pathlib import Path

REG_KEY = r"SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer"

# Dev-mode constants (not used when frozen)
_DEV_DIR     = Path(__file__).parent
_MANIFEST    = _DEV_DIR / "host_manifest.json"
_HOST_SCRIPT = _DEV_DIR / "native_host.py"


def find_python() -> str:
    return sys.executable


def write_wrapper_bat(python_exe: str) -> Path:
    """Create a .bat shim so Edge can launch the Python script (dev mode only)."""
    bat_path = _DEV_DIR / "run_host.bat"
    bat_path.write_text(
        f'@echo off\n"{python_exe}" "{_HOST_SCRIPT.resolve()}" %*\n'
    )
    return bat_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extension-id", required=True,
                        help="Edge extension ID (from edge://extensions)")
    args = parser.parse_args()
    ext_id = args.extension_id.strip()

    if getattr(sys, 'frozen', False):
        # ── PyInstaller exe ─────────────────────────────────────────────────
        # sys.executable = <install_root>/host/register.exe
        # native_host.exe lives in the same host/ directory
        base_dir      = Path(sys.executable).parent
        host_target   = str((base_dir / "native_host.exe").resolve())
        # Template is embedded in the exe (extracted by onefile to sys._MEIPASS)
        template_path = Path(sys._MEIPASS) / "host_manifest.json"
        # Patched manifest is written next to register.exe; registry points here
        manifest_path = base_dir / "host_manifest.json"
    else:
        # ── Dev / source mode ───────────────────────────────────────────────
        python_exe    = find_python()
        bat_path      = write_wrapper_bat(python_exe)
        host_target   = str(bat_path.resolve())
        template_path = _MANIFEST
        manifest_path = _MANIFEST

    # Patch manifest
    with open(template_path, encoding="utf-8") as f:
        manifest = json.load(f)

    manifest["path"]            = host_target
    manifest["allowed_origins"] = [f"chrome-extension://{ext_id}/"]

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Write registry key (HKCU — no admin required)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_KEY) as key:
        winreg.SetValue(key, "", winreg.REG_SZ, str(manifest_path.resolve()))

    print(f"Registered native host for extension: {ext_id}")
    print(f"Manifest   : {manifest_path.resolve()}")
    print(f"Host       : {host_target}")
    if not getattr(sys, 'frozen', False):
        print(f"Python     : {find_python()}")
    print("\nNext: Reload the extension in Edge and test.")


if __name__ == "__main__":
    main()
