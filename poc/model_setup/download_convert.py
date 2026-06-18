"""
Step 1: Download Phi-4-mini from HuggingFace and convert to OpenVINO IR.
Runtime: ~10-20 min on first run (downloads ~8 GB, outputs ~1.8 GB).
Note: Current toolchain (optimum-intel 2.0.0 + transformers 5.0.0) produces INT8 quantization.
NPU backend has compatibility issues; GPU/CPU are stable and tested.
"""
import sys
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "models" / "phi4-mini-int4"

def main():
    try:
        from optimum.intel import OVModelForCausalLM
        from transformers import AutoTokenizer
        from openvino_tokenizers import convert_tokenizer
        import openvino as ov
    except ImportError as e:
        print(f"ERROR: Run install_deps.bat first. Missing: {e}")
        sys.exit(1)

    MODEL_ID = "microsoft/Phi-4-mini-instruct"
    print(f"Downloading and converting: {MODEL_ID}")
    print(f"Output: {OUTPUT_DIR}\n")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/3] Downloading tokenizer...")
    tok = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)

    print("[2/3] Converting model to OpenVINO IR...")
    print("      (optimum-intel 2.0.0 applies default quantization)")
    try:
        model = OVModelForCausalLM.from_pretrained(
            MODEL_ID,
            export=True,
            trust_remote_code=True,
        )
        model.save_pretrained(str(OUTPUT_DIR))
        print("      Model export successful")
    except Exception as e:
        print(f"ERROR during model export: {e}")
        sys.exit(1)

    print("[3/3] Converting tokenizer to OpenVINO format...")
    try:
        tokenizer_model, detokenizer_model = convert_tokenizer(
            tok,
            with_detokenizer=True
        )
        ov.save_model(tokenizer_model, str(OUTPUT_DIR / "openvino_tokenizer.xml"))
        ov.save_model(detokenizer_model, str(OUTPUT_DIR / "openvino_detokenizer.xml"))
        print("      Tokenizer and detokenizer converted successfully")
    except Exception as e:
        print(f"  Error converting tokenizer: {e}")
        tok.save_pretrained(str(OUTPUT_DIR))
        print("  Fallback: saved HuggingFace tokenizer")

    print(f"\nDone. Model saved to: {OUTPUT_DIR.resolve()}")
    print("Next step: run benchmark.py")

if __name__ == "__main__":
    main()
