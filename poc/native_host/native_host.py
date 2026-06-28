"""
Native Messaging Host for AI Kwau.
Communicates with the Edge extension via stdin/stdout (length-prefixed JSON).

Architecture overview:
- _stdin_reader_fn  : daemon thread — reads messages from stdin into _msg_q.
                      When stdin closes (Edge disconnected) it puts None and exits.
- _load_model       : daemon thread — loads LLMPipeline; sets ready when done.
- main loop         : always blocked on _msg_q.get(), never on ready.wait().
                      On None → os._exit(0) kills all daemon threads immediately.
                      On summarize while loading → polls ready in a tight loop
                      that still checks _msg_q for EOF (pipe-close detection).

Why os._exit instead of sys.exit:
  If Edge closes the port while we're waiting for the model, we must exit fast.
  sys.exit() would wait for daemon threads (loader can run for minutes);
  os._exit() bypasses all Python cleanup and returns immediately.

Thread safety on stdout:
  _STDOUT_FD is os.dup(1) saved before any fd-1 manipulation.
  send_msg() writes to _STDOUT_FD so it works concurrently with _silence_fd1().
"""
import sys
import json
import struct
import logging
import os
import re
import threading
import contextlib
import queue as _queue
from pathlib import Path

# ── path bootstrap ────────────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    _BASE = Path(sys.executable).parent
else:
    _BASE = Path(__file__).parent

LOG_PATH  = _BASE / "aikwau_host.log"
MODEL_DIR = os.getenv("AIKWAU_MODEL_DIR") or str(
    _BASE.parent / "models" / "qwen2.5-1.5b-int4")
CACHE_DIR = str(_BASE / "ov_cache")
DEVICE_PRIORITY = "CPU"

# ── PyInstaller DLL search path ───────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    _pyi_root = sys._MEIPASS if hasattr(sys, '_MEIPASS') else str(_BASE / '_internal')
    _dll_dirs = []
    for _sub in ('', 'openvino\\libs', 'openvino_genai', 'openvino_tokenizers\\lib', 'numpy.libs'):
        _d = os.path.join(_pyi_root, _sub)
        if os.path.isdir(_d):
            os.add_dll_directory(_d)   # for LoadLibraryEx with LOAD_LIBRARY_SEARCH_USER_DIRS
            _dll_dirs.append(_d)
    # PATH is searched by plain LoadLibraryW (no flags) — required for OpenVINO plugin loading
    os.environ['PATH'] = os.pathsep.join(_dll_dirs + [os.environ.get('PATH', '')])
    # Do NOT pre-load openvino_tokenizers.dll here.
    # The C++ LLMPipeline finds and loads it once via a relative path from
    # openvino_genai.dll.  Any earlier load (ctypes or import openvino_tokenizers)
    # causes create_extensions() to run multiple times → DLL state corruption → crash.

logging.basicConfig(
    filename=str(LOG_PATH),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

# ── I/O setup ─────────────────────────────────────────────────────────────────
# Permanent handle to real Edge pipe, saved before any fd-1 redirection.
_STDOUT_FD: int = os.dup(1)
_send_lock = threading.Lock()

# Queue between stdin reader thread and main loop. None = EOF / pipe closed.
_msg_q: _queue.Queue = _queue.Queue()


@contextlib.contextmanager
def _silence_fd1():
    """Redirect fd 1 → devnull while OpenVINO's C++ runtime writes progress.

    send_msg() uses _STDOUT_FD so it is unaffected by this redirection.
    """
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.close(devnull)
    try:
        yield
    finally:
        os.dup2(_STDOUT_FD, 1)


# ── protocol ──────────────────────────────────────────────────────────────────
def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack("=I", raw)[0]
    if length == 0:
        return None
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_msg(obj: dict):
    data    = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    payload = struct.pack("=I", len(data)) + data
    with _send_lock:
        os.write(_STDOUT_FD, payload)


# ── stdin reader thread ───────────────────────────────────────────────────────
def _stdin_reader_fn():
    """Daemon thread: feeds _msg_q from stdin. Puts None on EOF/error."""
    while True:
        try:
            msg = read_msg()
        except Exception as e:
            logging.error(f"stdin read error: {e}")
            msg = None
        _msg_q.put(msg)
        if msg is None:
            break


# ── prompt builder ────────────────────────────────────────────────────────────
def build_prompt(text: str, lang: str) -> str:
    text = text[:1200]
    if lang == 'zh':
        return "列出以下文章的重點（3點）：\n\n" + text + "\n\n重點：\n1."
    return (
        "List 3 key points from the following paragraph"
        " (each point under 20 words):\n\n"
        + text
        + "\n\nKey points:\n1."
    )


def _format_output(raw: str, lang: str, orig_len: int = 0) -> str:
    """Normalise model output: strip preamble, convert to Traditional Chinese if zh,
    numbered list → • bullets, and ensure output is shorter than the original paragraph."""
    text = raw.strip()
    if lang == 'zh':
        try:
            import zhconv
            text = zhconv.convert(text, 'zh-tw')
        except ImportError:
            pass
    # Strip markdown bold/italic
    text = re.sub(r'\*{1,2}([^*\n]+)\*{1,2}', r'\1', text)
    # Strip preamble line: first line that ends with ：or : before any numbered item
    text = re.sub(r'\A[^\n]*[：:]\s*\n+', '', text)
    # Convert numbered/bulleted list markers to •
    text = re.sub(r'(?m)^\s*(?:\d+[.、）)]\s*|\(\d+\)\s*|[-*]\s+)', '• ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    # Ensure output is not longer than the original paragraph
    if orig_len > 0 and len(text) > orig_len:
        lines = text.split('\n')
        kept, total = [], 0
        for line in lines:
            if kept and total + len(line) + 1 > orig_len:
                break
            kept.append(line)
            total += len(line) + 1
        text = '\n'.join(kept).strip()
    return text


# ── model loader (background thread) ─────────────────────────────────────────
def _parse_device_candidates() -> list:
    raw = os.getenv("AIKWAU_DEVICE_PRIORITY", DEVICE_PRIORITY)
    candidates = [x.strip() for x in raw.split(",") if x.strip()]
    if not candidates:
        candidates = ["CPU"]
    if "CPU" not in candidates:
        candidates.append("CPU")
    return candidates


def _load_model(ov_genai, pipe_box: list, error_box: list, ready: threading.Event):
    candidates = _parse_device_candidates()
    logging.info(f"Device candidates: {candidates}")

    last_err = None
    for device in candidates:
        try:
            ov_config = {"CACHE_DIR": CACHE_DIR}
            if device == "NPU":
                ov_config["PERFORMANCE_HINT"] = "LATENCY"

            logging.info(f"Trying model load on device: {device}")
            with _silence_fd1():
                pipe = ov_genai.LLMPipeline(MODEL_DIR, device, **ov_config)
                pipe.generate("Ready", max_new_tokens=1)   # warm-up

            logging.info(f"Model loaded on {device}.")
            pipe_box[0] = pipe
            pipe_box[1] = device
            ready.set()
            return
        except Exception as e:
            last_err = e
            logging.warning(f"Device {device} failed: {e}")

    error_box[0] = str(last_err or "All devices failed")
    logging.error(f"Model load failed: {error_box[0]}")
    ready.set()


# ── main ──────────────────────────────────────────────────────────────────────
def _wait_for_model(ready: threading.Event) -> bool:
    """Block until model is ready, but exit immediately if stdin closes.

    Returns True when model is ready; never returns False (exits via os._exit).
    """
    while not ready.is_set():
        ready.wait(timeout=1)   # wake up every second to check for pipe close
        try:
            msg = _msg_q.get_nowait()
        except _queue.Empty:
            continue
        if msg is None:
            logging.info("Stdin closed while waiting for model — exiting.")
            os._exit(0)
        # A message arrived while loading (very unusual); discard with a warning.
        logging.warning(f"Discarding message received during model load: {msg}")
    return True


def main():
    logging.info("Native host starting...")

    try:
        with _silence_fd1():
            import openvino_genai as ov_genai
    except ImportError:
        logging.error("openvino_genai not found.")
        send_msg({"status": "error", "message": "openvino_genai not installed"})
        return

    pipe_box  = [None, None]   # [LLMPipeline, device_name]
    error_box = [None]
    ready     = threading.Event()

    threading.Thread(
        target=_load_model, args=(ov_genai, pipe_box, error_box, ready), daemon=True
    ).start()

    threading.Thread(target=_stdin_reader_fn, daemon=True).start()

    logging.info("Message loop started (model loading in background).")

    while True:
        msg = _msg_q.get()   # blocks; never stuck on model load

        if msg is None:
            logging.info("Stdin closed — exiting.")
            os._exit(0)

        action = msg.get("action")
        req_id = msg.get("reqId", 0)
        logging.info(f"Action: {action} (reqId={req_id})")

        if action == "ping":
            if not ready.is_set():
                send_msg({"status": "loading", "reqId": req_id})
            elif error_box[0]:
                send_msg({"status": "error", "message": error_box[0], "reqId": req_id})
            else:
                send_msg({"status": "ready", "device": pipe_box[1], "reqId": req_id})

        elif action == "summarize":
            if not ready.is_set():
                logging.info("Waiting for model to finish loading...")
                _wait_for_model(ready)   # polls every 1s, exits on pipe close

            if error_box[0]:
                send_msg({"status": "error", "message": error_box[0], "reqId": req_id})
            elif pipe_box[0] is None:
                send_msg({"status": "error", "message": "Model load timeout", "reqId": req_id})
            else:
                try:
                    lg        = msg.get("lang", "en")
                    orig_text = msg.get("text", "")
                    prompt    = build_prompt(orig_text, lg)
                    with _silence_fd1():
                        result = pipe_box[0].generate(prompt, max_new_tokens=180)
                    summary = _format_output(result, lg, orig_len=len(orig_text))
                    logging.info(f"Done: {summary[:180]}")
                    send_msg({"status": "ok", "summary": summary, "reqId": req_id})
                except Exception as e:
                    logging.error(f"Inference error: {e}")
                    send_msg({"status": "error", "message": str(e), "reqId": req_id})

        else:
            send_msg({"status": "error",
                      "message": f"Unknown action: {action}", "reqId": req_id})


if __name__ == "__main__":
    main()
