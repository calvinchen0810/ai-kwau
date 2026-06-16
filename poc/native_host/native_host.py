"""
Native Messaging Host for AI Kwau.
Communicates with the Edge extension via stdin/stdout (length-prefixed JSON).
"""
import sys
import json
import struct
import logging
from pathlib import Path

LOG_PATH = Path(__file__).parent / "aikwau_host.log"
MODEL_DIR = str(Path(__file__).parent.parent / "models" / "phi4-mini-int4")
DEVICE_PRIORITY = "NPU,GPU,CPU"

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


def main():
    logging.info("Native host starting...")

    try:
        import openvino_genai as ov_genai
    except ImportError:
        logging.error("openvino_genai not found. Run install_deps.bat.")
        send_msg({"status": "error", "message": "openvino_genai not installed"})
        return

    logging.info(f"Loading model from {MODEL_DIR} on {DEVICE_PRIORITY}")
    try:
        pipe = ov_genai.LLMPipeline(MODEL_DIR, DEVICE_PRIORITY)
        pipe.generate("Ready", max_new_tokens=1)   # warm-up
        logging.info("Model loaded and warmed up.")
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
            send_msg({"status": "ready", "reqId": req_id})

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
