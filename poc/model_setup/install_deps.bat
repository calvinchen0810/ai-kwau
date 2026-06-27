@echo off
echo [AI Kwau PoC] Setting up Python environment...
python -m venv .venv
call .venv\Scripts\activate
pip install --upgrade pip
pip install openvino openvino-genai openvino-tokenizers "optimum[openvino]" huggingface_hub transformers
echo.
echo Done. Run: .venv\Scripts\activate
pause
