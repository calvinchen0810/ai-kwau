"""
Step 1: Download and convert a supported local LLM to OpenVINO IR.

Default model: Qwen/Qwen2.5-1.5B-Instruct
Legacy option: microsoft/Phi-4-mini-instruct
"""
import sys
import argparse
from pathlib import Path

MODELS_BASE = Path(__file__).parent.parent / "models"

MODELS = {
    "qwen2.5-1.5b": {
        "model_id": "Qwen/Qwen2.5-1.5B-Instruct",
        "output_dir": MODELS_BASE / "qwen2.5-1.5b-int4",
        "trust_remote_code": False,
    },
    "phi4-mini": {
        "model_id": "microsoft/Phi-4-mini-instruct",
        "output_dir": MODELS_BASE / "phi4-mini-int4",
        "trust_remote_code": True,
    },
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        choices=list(MODELS.keys()),
        default="qwen2.5-1.5b",
        help="Which model to download and convert",
    )
    args = parser.parse_args()

    try:
        from optimum.intel import OVModelForCausalLM
        from transformers import AutoTokenizer
        from openvino_tokenizers import convert_tokenizer
        import openvino as ov
    except ImportError as e:
        print(f"ERROR: Run install_deps.bat first. Missing: {e}")
        sys.exit(1)

    cfg = MODELS[args.model]
    model_id = cfg["model_id"]
    output_dir = cfg["output_dir"]
    trust_remote_code = cfg["trust_remote_code"]

    print(f"Downloading and converting: {model_id}")
    print(f"Output: {output_dir}\n")

    output_dir.mkdir(parents=True, exist_ok=True)

    print("[1/3] Downloading tokenizer...")
    tok = AutoTokenizer.from_pretrained(model_id, trust_remote_code=trust_remote_code)

    print("[2/3] Converting model to OpenVINO IR...")
    print("      (optimum-intel exports INT4 quantized OpenVINO IR)")
    try:
        model = OVModelForCausalLM.from_pretrained(
            model_id,
            export=True,
            trust_remote_code=trust_remote_code,
        )
        model.save_pretrained(str(output_dir))
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
        ov.save_model(tokenizer_model, str(output_dir / "openvino_tokenizer.xml"))
        ov.save_model(detokenizer_model, str(output_dir / "openvino_detokenizer.xml"))
        print("      Tokenizer and detokenizer converted successfully")
    except Exception as e:
        print(f"  Error converting tokenizer: {e}")
        tok.save_pretrained(str(output_dir))
        print("  Fallback: saved HuggingFace tokenizer")

    print(f"\nDone. Model saved to: {output_dir.resolve()}")
    print("Next step: run benchmark.py")

if __name__ == "__main__":
    main()
