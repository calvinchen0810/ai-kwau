"""
Native Messaging Host for AI Kwau.
Communicates with the Edge extension via stdin/stdout (length-prefixed JSON).
"""
import sys
import json
import struct
import logging
import os
from pathlib import Path

LOG_PATH = Path(__file__).parent / "aikwau_host.log"
# Qwen2.5-1.5B: standard architecture, verified working on Intel Panther Lake NPU
# Phi-4-mini: NOT compatible with NPU (corrupted output)
MODEL_DIR = str(Path(__file__).parent.parent / "models" / "qwen2.5-1.5b-int4")
DEVICE_PRIORITY = "CPU"

logging.basicConfig(
    filename=str(LOG_PATH),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


def read_msg() -> dict | None:
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack("=I", raw)[0]
    if length == 0:
        return None
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_msg(obj: dict):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def build_prompt(text: str, lang: str) -> str:
    text = text[:1200]
    if lang == "zh":
        return f"請用 2 句話摘要以下文字：\n\n{text}\n\n摘要："
    return f"Summarize in 2 sentences:\n\n{text}\n\nSummary:"


def _parse_device_candidates() -> list[str]:
    # Allow runtime override (for AMD/CPU-only boxes): AIKWAU_DEVICE_PRIORITY=CPU
    raw = os.getenv("AIKWAU_DEVICE_PRIORITY", DEVICE_PRIORITY)
    candidates = [x.strip() for x in raw.split(",") if x.strip()]
    if not candidates:
        candidates = ["CPU"]
    if "CPU" not in candidates:
        candidates.append("CPU")
    return candidates


def _build_pipeline(ov_genai):
    candidates = _parse_device_candidates()
    logging.info(f"Device candidates: {candidates}")

    last_error = None
    for device in candidates:
        try:
            ov_config = {}
            if device == "NPU":
                ov_config["PERFORMANCE_HINT"] = "LATENCY"

            logging.info(f"Trying model load on device: {device}")
            pipe = ov_genai.LLMPipeline(MODEL_DIR, device, **ov_config)
            pipe.generate("Ready", max_new_tokens=1)  # warm-up
            logging.info(f"Model loaded and warmed up on {device}.")
            return pipe, device
        except Exception as e:
            last_error = e
            logging.warning(f"Device {device} failed: {e}")

    raise RuntimeError(f"All devices failed. Last error: {last_error}")


def main():
    logging.info("Native host starting...")

    try:
        import openvino_genai as ov_genai
    except ImportError:
        logging.error("openvino_genai not found. Run install_deps.bat.")
        send_msg({"status": "error", "message": "openvino_genai not installed"})
        return

    logging.info(f"Loading model from {MODEL_DIR}")
    try:
        pipe, active_device = _build_pipeline(ov_genai)
    except Exception as e:
        logging.error(f"Model load failed: {e}")
        send_msg({"status": "error", "message": str(e)})
        return

    while True:
        try:
            msg = read_msg()
        except Exception as e:
            logging.error(f"Read error: {e}")
            break

        if msg is None:
            logging.info("EOF received, exiting.")
            break

        action = msg.get("action")
        req_id = msg.get("reqId", 0)
        logging.info(f"Action: {action} (reqId={req_id})")

        if action == "ping":
            send_msg({"status": "ready", "device": active_device, "reqId": req_id})

        elif action == "summarize":
            try:
                prompt = build_prompt(msg.get("text", ""), msg.get("lang", "en"))
                result = pipe.generate(prompt, max_new_tokens=80)
                summary = result.strip()
                logging.info(f"Done: {summary[:80]}")
                send_msg({"status": "ok", "summary": summary, "reqId": req_id})
            except Exception as e:
                logging.error(f"Inference error: {e}")
                send_msg({"status": "error", "message": str(e), "reqId": req_id})

        else:
            send_msg({"status": "error", "message": f"Unknown action: {action}", "reqId": req_id})


if __name__ == "__main__":
    main()
