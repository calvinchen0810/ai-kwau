"""
Step 1: Download Phi-4-mini from HuggingFace and convert to OpenVINO IR INT4.
Runtime: ~10-20 min on first run (downloads ~8 GB, outputs ~1.8 GB).
"""
import os
import sys
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "models" / "phi4-mini-int4"

def main():
    try:
        from optimum.intel import OVModelForCausalLM
        from transformers import AutoTokenizer
    except ImportError:
        print("ERROR: Run install_deps.bat first.")
        sys.exit(1)

    MODEL_ID = "microsoft/Phi-4-mini-instruct"
    print(f"Downloading and converting: {MODEL_ID}")
    print(f"Output: {OUTPUT_DIR}\n")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/2] Saving tokenizer...")
    tok = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    tok.save_pretrained(str(OUTPUT_DIR))

    print("[2/2] Converting model to OpenVINO IR + INT4 quantization...")
    model = OVModelForCausalLM.from_pretrained(
        MODEL_ID,
        export=True,
        load_in_4bit=True,
        trust_remote_code=True,
    )
    model.save_pretrained(str(OUTPUT_DIR))

    print(f"\nDone. Model saved to: {OUTPUT_DIR.resolve()}")
    print("Next step: run benchmark.py")

if __name__ == "__main__":
    main()
