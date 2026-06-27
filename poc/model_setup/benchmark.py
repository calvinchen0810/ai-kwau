"""
Step 2: Benchmark a converted OpenVINO model on available Intel hardware.
Tests NPU -> GPU -> CPU and prints latency + tokens/sec for each.

Usage:
  python benchmark.py                                        # default: qwen2.5-1.5b-int4
  python benchmark.py --model-dir ../models/gemma4-e4b-int4
"""
import argparse
import contextlib
import logging
import time
import sys
import os
from pathlib import Path

# frozen: benchmark.exe lives in host/, models at host/../models/
# dev:    benchmark.py lives in poc/model_setup/, models at poc/models/
if getattr(sys, 'frozen', False):
    _BASE = Path(sys.executable).parent
else:
    _BASE = Path(__file__).parent

_MODELS_BASE = _BASE.parent / "models"

parser = argparse.ArgumentParser(
    description="Benchmark an OpenVINO IR model on available Intel hardware."
)
parser.add_argument(
    "--model-dir",
    default=os.getenv("AIKWAU_MODEL_DIR") or str(_MODELS_BASE / "qwen2.5-1.5b-int4"),
    help="Path to the OpenVINO IR model directory (default: qwen2.5-1.5b-int4)",
)
_args = parser.parse_args()
MODEL_DIR = _args.model_dir

# DLL search path for the frozen exe: openvino_tokenizers.dll and its
# dependencies must be findable by Windows LoadLibrary.
if getattr(sys, 'frozen', False):
    _pyi_root = sys._MEIPASS if hasattr(sys, '_MEIPASS') else str(_BASE / '_internal')
    _dll_dirs = []
    for _sub in ('', 'openvino\\libs', 'openvino_genai', 'openvino_tokenizers\\lib', 'numpy.libs'):
        _d = os.path.join(_pyi_root, _sub)
        if os.path.isdir(_d):
            os.add_dll_directory(_d)
            _dll_dirs.append(_d)
    os.environ['PATH'] = os.pathsep.join(_dll_dirs + [os.environ.get('PATH', '')])

    # Explicit DLL path for the C++ Tokenizer/LLMPipeline plugin loader.
    _ovt_dll = os.path.join(_pyi_root, 'openvino_tokenizers', 'lib', 'openvino_tokenizers.dll')
    if os.path.isfile(_ovt_dll):
        os.environ['OPENVINO_TOKENIZERS_PATH_GENAI'] = _ovt_dll

# ── shared cache with native_host.exe ────────────────────────────────────────
# When frozen: _BASE = host/, so both binaries use host/ov_cache/.
CACHE_DIR = str(_BASE / "ov_cache")

# ── log file (captures errors even when fd 1 is silenced) ────────────────────
logging.basicConfig(
    filename=str(_BASE / "benchmark.log"),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

# ── stdout guard (same approach as native_host.py) ───────────────────────────
# Save a permanent copy of real stdout BEFORE any OpenVINO code runs.
# This fd is held open and can never be stolen by OpenVINO's own dup() calls,
# so _silence_fd1()'s finally block always restores to the correct handle.
_STDOUT_FD: int = os.dup(1)


@contextlib.contextmanager
def _silence_fd1():
    """Redirect C-level fd 1 → devnull while OpenVINO prints progress.

    Uses _STDOUT_FD (saved at module load, before any OpenVINO code) to
    restore fd 1.  This avoids the fd-number-theft problem: if OpenVINO
    internally calls dup() and gets the same number as a locally-saved fd,
    the restore would silently point fd 1 at the wrong file.  Because
    _STDOUT_FD is allocated at startup and never closed, it cannot be stolen.
    """
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.close(devnull)
    try:
        yield
    finally:
        os.dup2(_STDOUT_FD, 1)


TEST_TEXT = (
    "Studies indicate over 1.1 billion people experience vision impairment globally. "
    "Small fonts and inadequate spacing remain the top barriers to digital accessibility "
    "for aging users and those with mild visual conditions. Extended screen sessions "
    "increase eye strain significantly for low-vision users compared to those with "
    "normal vision — yet most platforms provide no adaptive display options whatsoever."
)
PROMPT = f"Summarize in 2 sentences:\n\n{TEST_TEXT}\n\nSummary:"
MAX_TOKENS = 60
ROUNDS = 3


def looks_corrupted(text: str) -> bool:
    s = text.strip()
    if not s:
        return True
    printable_ratio = sum(ch.isprintable() for ch in s) / len(s)
    alpha_ratio = sum(ch.isalpha() for ch in s) / len(s)
    symbol_ratio = sum(
        not (ch.isalnum() or ch.isspace() or ch in ",.;:!?'-\"()") for ch in s
    ) / len(s)
    return printable_ratio < 0.95 or alpha_ratio < 0.15 or symbol_ratio > 0.10


def run_device(device: str, ov_genai):
    print(f"\n{'='*50}")
    print(f"Device: {device}")
    print(f"{'='*50}")

    try:
        t0 = time.time()
        logging.info(f"Device: {device} | MODEL_DIR: {MODEL_DIR}")

        logging.info("LLMPipeline — start")
        with _silence_fd1():
            pipe = ov_genai.LLMPipeline(MODEL_DIR, device)
        logging.info("LLMPipeline OK")

        os.makedirs(CACHE_DIR, exist_ok=True)
        ov_config = {"CACHE_DIR": CACHE_DIR}
        if device == "NPU":
            ov_config["PERFORMANCE_HINT"] = "LATENCY"
        load_time = time.time() - t0
        logging.info(f"Loaded on {device} in {load_time:.1f}s")
        print(f"\r  Load time : {load_time:.1f}s   ")

        print(f"  Warming up...", end="", flush=True)
        with _silence_fd1():
            pipe.generate("Hello", max_new_tokens=3)
        print(f"\r  Warm-up done.   ")

        times = []
        for i in range(ROUNDS):
            t = time.time()
            with _silence_fd1():
                result = pipe.generate(PROMPT, max_new_tokens=MAX_TOKENS)
            elapsed = time.time() - t
            if device == "NPU" and looks_corrupted(result):
                raise RuntimeError("NPU output quality check failed (corrupted text)")
            times.append(elapsed)
            logging.info(f"Round {i+1}: {elapsed:.2f}s — {result.strip()[:80]}")
            print(f"  Round {i+1}   : {elapsed:.2f}s | {result.strip()[:70]}...")

        avg = sum(times) / len(times)
        tps = MAX_TOKENS / avg
        print(f"\n  Avg latency : {avg:.2f}s")
        print(f"  Tokens/sec  : {tps:.1f}")
        logging.info(f"{device}: avg={avg:.2f}s tps={tps:.1f}")
        return {"device": device, "avg_latency": avg, "tokens_per_sec": tps}

    except Exception as e:
        logging.exception(f"Device {device} failed")
        print(f"\n  SKIPPED — {e}", file=sys.stderr, flush=True)
        return None


def main():
    logging.info("Benchmark starting.")
    try:
        with _silence_fd1():
            import openvino as ov
        import openvino_tokenizers  # pre-init tokenizer extension before genai
        with _silence_fd1():
            import openvino_genai as ov_genai
    except ImportError as e:
        print(f"ERROR: {e}\nRun install_deps.bat first.", file=sys.stderr)
        sys.exit(1)

    core = ov.Core()
    available = core.available_devices
    logging.info(f"Available devices: {available}")
    print(f"Available devices: {available}")

    if "NPU" in available:
        npu_name = core.get_property("NPU", "FULL_DEVICE_NAME")
        print(f"NPU: {npu_name}")

    results = []
    for device in ["NPU", "GPU", "CPU"]:
        if device in available:
            r = run_device(device, ov_genai)
            if r:
                results.append(r)

    print(f"\n{'='*50}")
    print("SUMMARY")
    print(f"{'='*50}")
    for r in results:
        print(f"  {r['device']:<6} {r['avg_latency']:.2f}s   {r['tokens_per_sec']:.0f} tok/s")

    if results:
        best = min(results, key=lambda x: x["avg_latency"])
        print(f"\n  Best device for this machine: {best['device']}")
        _priority = {"NPU": "NPU,GPU,CPU", "GPU": "GPU,CPU"}.get(best['device'], best['device'])
        print(f"  Recommended DEVICE_PRIORITY for native_host: {_priority}")
    else:
        print("  No devices succeeded.", file=sys.stderr)
        print(f"  Check benchmark.log for details: {_BASE / 'benchmark.log'}")

    logging.info("Benchmark complete.")


if __name__ == "__main__":
    main()
