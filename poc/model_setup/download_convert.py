"""
Step 1: Download and convert a supported local LLM to OpenVINO IR (INT4).

Supported models:
  qwen2.5-1.5b  — Qwen/Qwen2.5-1.5B-Instruct   (~800 MB, verified on NPU)
  gemma4-e4b    — google/gemma-4-e4b-it          (~2 GB,  needs HF login)
  phi4-mini     — microsoft/Phi-4-mini-instruct  (legacy, NPU INCOMPATIBLE)

Usage:
  python download_convert.py                    # default: qwen2.5-1.5b
  python download_convert.py --model gemma4-e4b
"""
import sys
import argparse
from pathlib import Path

MODELS_BASE = Path(__file__).parent.parent / "models"

# INT4 symmetric quantization — matches Qwen2.5 verified settings
INT4_QUANT = dict(bits=4, sym=True, group_size=128)

MODELS = {
    "qwen2.5-1.5b": {
        "model_id":          "Qwen/Qwen2.5-1.5B-Instruct",
        "output_dir":        MODELS_BASE / "qwen2.5-1.5b-int4",
        "trust_remote_code": False,
        "gated":             False,
        "quant":             INT4_QUANT,
    },
    "gemma4-e4b": {
        "model_id":          "google/gemma-4-e4b-it",
        "output_dir":        MODELS_BASE / "gemma4-e4b-int4",
        "trust_remote_code": False,
        "gated":             True,   # requires HF login + licence acceptance
        "quant":             INT4_QUANT,
    },
    "phi4-mini": {
        "model_id":          "microsoft/Phi-4-mini-instruct",
        "output_dir":        MODELS_BASE / "phi4-mini-int4",
        "trust_remote_code": True,
        "gated":             False,
        "quant":             INT4_QUANT,
        "npu_warning":       "Phi-4-mini produces garbled output on NPU (custom architecture). CPU/GPU only.",
    },
}


def check_hf_login():
    """Return True if a HuggingFace token is available."""
    try:
        from huggingface_hub import HfApi
        HfApi().whoami()
        return True
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        choices=list(MODELS.keys()),
        default="qwen2.5-1.5b",
        help="Which model to download and convert (default: qwen2.5-1.5b)",
    )
    args = parser.parse_args()

    try:
        from optimum.intel import OVModelForCausalLM, OVWeightQuantizationConfig
        from transformers import AutoTokenizer
        from openvino_tokenizers import convert_tokenizer
        import openvino as ov
    except ImportError as e:
        print(f"ERROR: Run install_deps.bat first. Missing: {e}")
        sys.exit(1)

    cfg = MODELS[args.model]

    if "npu_warning" in cfg:
        print(f"\n  WARNING: {cfg['npu_warning']}\n")

    if cfg["gated"]:
        print(f"NOTE: {cfg['model_id']} is a gated model.")
        print("      You must accept the licence at huggingface.co and run:")
        print("        huggingface-cli login")
        if not check_hf_login():
            print("\nERROR: No HuggingFace token found. Run `huggingface-cli login` first.")
            sys.exit(1)
        print("      HuggingFace token found. Proceeding...\n")

    model_id  = cfg["model_id"]
    output_dir = cfg["output_dir"]
    quant_cfg  = OVWeightQuantizationConfig(**cfg["quant"])

    print(f"Model  : {model_id}")
    print(f"Output : {output_dir}")
    print(f"Quant  : INT{cfg['quant']['bits']} sym={cfg['quant']['sym']} group={cfg['quant']['group_size']}\n")

    output_dir.mkdir(parents=True, exist_ok=True)

    print("[1/3] Downloading tokenizer...")
    tok = AutoTokenizer.from_pretrained(
        model_id,
        trust_remote_code=cfg["trust_remote_code"],
    )

    print("[2/3] Converting model to OpenVINO IR (INT4)...")
    try:
        model = OVModelForCausalLM.from_pretrained(
            model_id,
            export=True,
            quantization_config=quant_cfg,
            trust_remote_code=cfg["trust_remote_code"],
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
            with_detokenizer=True,
        )
        ov.save_model(tokenizer_model,   str(output_dir / "openvino_tokenizer.xml"))
        ov.save_model(detokenizer_model, str(output_dir / "openvino_detokenizer.xml"))
        print("      Tokenizer and detokenizer converted successfully")
    except Exception as e:
        print(f"  Warning — tokenizer conversion failed: {e}")
        tok.save_pretrained(str(output_dir))
        print("  Fallback: saved HuggingFace tokenizer")

    print(f"\nDone. Model saved to: {output_dir.resolve()}")
    print("Next step: run  python benchmark.py --model-dir", output_dir.resolve())


if __name__ == "__main__":
    main()
