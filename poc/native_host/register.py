"""
Step 3: Register the native messaging host with Microsoft Edge.
Run once after loading the extension and obtaining its ID.

Usage:
  python register.py --extension-id <EDGE_EXTENSION_ID>
"""
import argparse
import json
import os
import sys
import winreg
from pathlib import Path

MANIFEST_PATH = Path(__file__).parent / "host_manifest.json"
HOST_SCRIPT = Path(__file__).parent / "native_host.py"
REG_KEY = r"SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer"


def find_python() -> str:
    """Return the active Python executable path."""
    return sys.executable


def write_wrapper_bat(python_exe: str) -> Path:
    """Create a .bat shim so Edge can launch the Python script."""
    bat_path = Path(__file__).parent / "run_host.bat"
    script_path = HOST_SCRIPT.resolve()
    bat_content = f'@echo off\n"{python_exe}" "{script_path}" %*\n'
    bat_path.write_text(bat_content)
    return bat_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extension-id", required=True,
                        help="Edge extension ID (from edge://extensions)")
    args = parser.parse_args()

    ext_id = args.extension_id.strip()
    python_exe = find_python()
    bat_path = write_wrapper_bat(python_exe)

    # Update manifest
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    manifest["path"] = str(bat_path.resolve())
    manifest["allowed_origins"] = [f"chrome-extension://{ext_id}/"]

    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)

    # Write registry (HKCU — no admin required)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_KEY) as key:
        winreg.SetValue(key, "", winreg.REG_SZ, str(MANIFEST_PATH.resolve()))

    print(f"Registered native host for extension: {ext_id}")
    print(f"Manifest   : {MANIFEST_PATH.resolve()}")
    print(f"Host script: {HOST_SCRIPT.resolve()}")
    print(f"Python     : {python_exe}")
    print("\nNext: Reload the extension in Edge and test.")


if __name__ == "__main__":
    main()
