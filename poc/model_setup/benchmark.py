"""
Step 2: Benchmark Phi-4-mini on available Intel hardware.
Tests NPU -> GPU -> CPU and prints latency + tokens/sec for each.
"""
import time
import sys
from pathlib import Path

MODEL_DIR = str(Path(__file__).parent.parent / "models" / "phi4-mini-int4")

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


def run_device(device: str):
    try:
        import openvino_genai as ov_genai
    except ImportError:
        print("ERROR: Run install_deps.bat first.")
        sys.exit(1)

    print(f"\n{'='*50}")
    print(f"Device: {device}")
    print(f"{'='*50}")

    try:
        t0 = time.time()
        pipe = ov_genai.LLMPipeline(MODEL_DIR, device)
        load_time = time.time() - t0
        print(f"  Load time : {load_time:.1f}s")

        # Warm-up
        pipe.generate("Hello", max_new_tokens=3)

        times = []
        for i in range(ROUNDS):
            t = time.time()
            result = pipe.generate(PROMPT, max_new_tokens=MAX_TOKENS)
            elapsed = time.time() - t
            times.append(elapsed)
            print(f"  Round {i+1}   : {elapsed:.2f}s | {result.strip()[:70]}...")

        avg = sum(times) / len(times)
        tps = MAX_TOKENS / avg
        print(f"\n  Avg latency : {avg:.2f}s")
        print(f"  Tokens/sec  : {tps:.1f}")
        return {"device": device, "avg_latency": avg, "tokens_per_sec": tps}

    except Exception as e:
        print(f"  SKIPPED ({e})")
        return None


def main():
    import openvino as ov

    core = ov.Core()
    available = core.available_devices
    print(f"Available devices: {available}")

    if "NPU" in available:
        npu_name = core.get_property("NPU", "FULL_DEVICE_NAME")
        print(f"NPU: {npu_name}")

    results = []
    for device in ["NPU", "GPU", "CPU"]:
        if device in available:
            r = run_device(device)
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


if __name__ == "__main__":
    main()
