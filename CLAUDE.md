# AI Kwau (愛看有) — Project Context for Claude Code

## Project Goal

AI Kwau is an on-device visual accessibility tool for HP laptops. It detects where the user is looking (gaze tracking) and automatically enhances the text they are reading — making it darker/bolder (L1) or larger (L2) — and provides a short AI-generated bullet-point summary of the paragraph.

Primary target: Intel Panther Lake laptops (NPU 100+ TOPS), HP pre-install scenario.

## Key Design Decisions (already made, do not change without discussing)

- **On-device only**: No cloud API, no telemetry. All AI runs via OpenVINO on Intel hardware.
- **Model**: ~~Phi-4 Mini~~ **Qwen2.5-1.5B-Instruct INT4** (~800 MB). Downloaded from HuggingFace, converted via optimum-intel. Phi-4-mini was abandoned: its custom architecture (`configuration_phi3.py`) causes corrupted output on NPU with OpenVINO 2026.2.
- **Device priority**: `CPU` (current dev machine only has CPU). On Panther Lake, set to `NPU,GPU,CPU`. Verified working with Qwen2.5-1.5B.
- **Browser target**: Microsoft Edge (pre-installed on HP). MV3 extension.
- **Communication**: Edge extension ↔ Python native host via Native Messaging (stdin/stdout, length-prefixed JSON).
- **Registry key**: `HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer` (no admin required).
- **Gaze tracking**: Mouse hover 2s dwell (PoC default) OR WebGazer.js v2.1.2 (webcam, bundled). Toggled via extension popup.
- **WebGazer world**: Runs in MAIN world (not isolated) to bypass MV3 extension CSP which blocks `new Function()` used by TF.js. Gaze events bridge to isolated world via DOM CustomEvents with (x,y) coordinates.
- **Language detection**: Per-paragraph, based on CJK character ratio in the text (not page `lang` attribute). >8% CJK → Traditional Chinese summary; otherwise → English summary.
- **Summary format**: Always bullet points (`• `). English paragraph → English bullets; Chinese paragraph → Traditional Chinese bullets (simplified→traditional via zhconv post-processing).
- **Summary UX**: No floating badge. When summary is ready, paragraph gets a semi-transparent yellow background highlight. User presses Shift to replace paragraph text with summary.
- **Frozen exe**: `native_host.exe` and `benchmark.exe` are PyInstaller onedir builds. CRT v14.31 (bundled by PyInstaller) must be dropped so the exe uses System32's v14.44 — see CRT ABI fix below.

## Repository Structure

```
ai-kwau/
├── index.html              # English presentation (10 slides, 960×540 scaler)
├── doc/
│   └── index.html          # Developer documentation
└── poc/
    ├── model_setup/
    │   ├── install_deps.bat         # Creates .venv, installs openvino + huggingface deps + zhconv
    │   ├── download_convert.py      # Downloads Qwen2.5-1.5B, converts to OpenVINO INT4 IR
    │   └── benchmark.py             # Tests NPU/GPU/CPU latency; frozen-exe aware; outputs tok/s
    ├── native_host/
    │   ├── native_host.py           # Inference host: reads stdin, runs LLMPipeline, writes stdout
    │   ├── host_manifest.json       # Edge native host descriptor (path/origin patched by register.py)
    │   ├── register.py              # Writes Windows Registry key + creates run_host.bat shim
    │   ├── benchmark.spec           # PyInstaller spec for benchmark.exe (shares native_host _internal)
    │   ├── native_host.spec         # PyInstaller spec for native_host.exe (onedir, CRT drop)
    │   └── dist/
    │       ├── benchmark/           # benchmark.exe + _internal/
    │       └── native_host/         # native_host.exe + _internal/  ← deployment source
    └── extension/
        ├── manifest.json            # MV3 v0.3.0: three content_scripts entries
        ├── mode_bridge.js           # Isolated world, document_start: reads storage → DOM attribute
        ├── webgazer.js              # WebGazer v2.1.2 minified (2.3 MB, bundled, MAIN world)
        ├── gaze_tracker.js          # MAIN world: mouse/webcam tracking → document CustomEvents
        ├── background.js            # Service worker: manages native port, routes requests with reqId
        ├── content.js               # Isolated world: gaze events → L1 + summary + yellow highlight
        ├── content.css              # L1/L2 styles, summary-ready yellow, margin note, badge
        ├── popup.html               # Extension popup UI
        └── popup.js                 # Popup logic: storage reads/writes + tab messages
```

## Current State (as of 2026-06-27)

### Completed
- [x] OpenVINO model conversion on Panther Lake (Qwen2.5-1.5B INT4)
- [x] NPU/GPU/CPU inference benchmarked
- [x] Mouse mode: L1 effect (bold/darken) end-to-end
- [x] WebGazer v2.1.2 bundled and running in MAIN world
- [x] 9-point / 25-point calibration UI
- [x] Gaze ring visual indicator
- [x] EMA smoothing on gaze coordinates
- [x] Extension popup: mode switching, recalibrate, L2 toggle, shift-replace toggle, margin note toggle, note theme toggle
- [x] `benchmark.exe` (PyInstaller frozen) — working, correct output, CRT fix applied
- [x] `native_host.exe` (PyInstaller frozen) — working, ping/summarize end-to-end verified
- [x] Summary prompt: raw completion format, 3 bullet points, English→English / Chinese→Traditional Chinese
- [x] zhconv bundled in native_host.exe for simplified→traditional conversion
- [x] Yellow paragraph highlight when summary ready (no loading badge)
- [x] Shift key replaces paragraph text with summary
- [x] Margin note: dark/light theme toggle, `white-space: pre-line`, 240px wide
- [x] SPA navigation: clears margin notes on pushState/replaceState/popstate
- [x] Webcam mode: badge fixed at right side (not cursor-following)
- [x] Per-paragraph language detection by CJK character ratio
- [ ] Native Messaging host registration and browser end-to-end test ← **next step**
- [ ] L2 text enlargement

### Hardware Test Results (Panther Lake, Qwen2.5-1.5B INT4)
| Device | Latency | Tokens/sec | Status |
|--------|---------|------------|--------|
| NPU (Intel AI Boost) | 1.62s | 37 tok/s | Clean output ✅ |
| GPU (iGPU) | 0.85s | 71 tok/s | Clean output ✅ |
| CPU | 1.32s | 45 tok/s | Clean output ✅ |

Dev machine (CPU only): 2.90s avg, 21 tok/s.

### Key Finding: CRT ABI Mismatch (PyInstaller frozen exe crash)

**Root cause**: `openvino_genai.dll` compiled with MSVC v14.40+ uses SRWLOCK-based `std::mutex`. Python's PyInstaller-bundled `msvcp140.dll` is v14.31 (CRITICAL_SECTION-based layout). When the frozen exe loads the bundled CRT, inlined mutex code in `openvino_genai.dll` reads NULL at offset 8 → crash at `mtx_do_lock+0x9c`.

**Fix** (in both `benchmark.spec` and `native_host.spec`): Drop exact-named bundled CRT DLLs so the frozen exe falls back to System32's v14.44 (SRWLOCK-based, matching openvino_genai's expectation):

```python
_CRT_EXACT = {
    'msvcp140.dll', 'msvcp140_atomic_wait.dll',
    'vcruntime140.dll', 'vcruntime140_1.dll',
    'vccorlib140.dll', 'concrt140.dll',
}
def _is_crt(name):
    b = os.path.basename(name).lower()
    return b in _CRT_EXACT or b.startswith('api-ms-win-crt-')
```

Numpy's private `msvcp140-<hash>.dll` is intentionally kept (exact-name match avoids it).

### Key Finding: Model Compatibility
- **Phi-4-mini**: INCOMPATIBLE with NPU — custom architecture causes garbled output on OpenVINO 2026.2 NPU.
- **Qwen2.5-1.5B-Instruct**: COMPATIBLE — standard architecture, all devices produce correct output.

### Key Finding: WebGazer CSP Issue
- WebGazer v3.x: MediaPipe dynamically loads JS — blocked by page CSP.
- WebGazer v2.1.2: TF.js uses `new Function()` for WebGL shaders — blocked by MV3 isolated-world CSP.
- **Solution**: Run `webgazer.js` in MAIN world. Bridge via DOM CustomEvents `{x, y}`.

### Key Finding: Qwen Chat Template causes early EOS
Using Qwen2.5's `<|im_start|>/<|im_end|>` chat template causes the model to emit EOS after the first bullet point. Use raw completion prompts instead:
- ZH: `列出以下文章的重點（3點）：\n\n{text}\n\n重點：\n1.`
- EN: `List 3 key points from the following paragraph (each point under 20 words):\n\n{text}\n\nKey points:\n1.`

The model outputs numbered lists; `_format_output()` converts to `•` bullets and strips markdown.

## Immediate Next Step — Register Native Host

### Step 1 — Install zhconv (if not done)
```cmd
cd poc\model_setup
.venv\Scripts\activate
pip install zhconv
```

### Step 2 — Build frozen executables (if not done)
```cmd
cd ..\native_host
pyinstaller --clean -y native_host.spec
pyinstaller --clean -y benchmark.spec
```
If ov_cache causes PermissionError during `--clean`: delete `dist\native_host\ov_cache\` first.

### Step 3 — Test native host manually
```cmd
# Set model path
set AIKWAU_MODEL_DIR=C:\path\to\poc\models\qwen2.5-1.5b-int4
set PYTHONUTF8=1
python -c "
import subprocess, json, struct, os, time
p = subprocess.Popen(['dist\\native_host\\native_host.exe'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=dict(os.environ))
def send(o): d=json.dumps(o).encode(); p.stdin.write(struct.pack('=I',len(d))+d); p.stdin.flush()
def recv(): n=struct.unpack('=I',p.stdout.read(4))[0]; return json.loads(p.stdout.read(n))
send({'action':'ping','reqId':1}); r=recv()
while r.get('status')=='loading': time.sleep(2); send({'action':'ping','reqId':1}); r=recv()
print(r)
send({'action':'summarize','text':'AI is transforming healthcare.','lang':'en','reqId':2}); print(recv())
"
```

### Step 4 — Get Extension ID
`edge://extensions` → AI Kwau PoC → copy the 32-character **ID**

### Step 5 — Register native host
```cmd
python register.py --extension-id <EXTENSION_ID>
```

### Step 6 — Reload extension and test
- `edge://extensions` → reload AI Kwau PoC
- Navigate to any article, hover a paragraph 2 seconds (mouse mode)
- Verify: text bold/dark (L1) + paragraph turns yellow when summary ready
- Press Shift → paragraph text replaced with bullet-point summary

## Extension Architecture

### Content script injection order (manifest.json)
```
document_start  [isolated]  mode_bridge.js
                              └─> chrome.storage → document.setAttribute('data-aikwau-mode', mode)

document_idle   [MAIN]      webgazer.js  →  gaze_tracker.js
                              └─> reads data-aikwau-mode attribute
                              └─> mouse: mouseover+2s dwell → dispatch aikwau:gazefocus {x, y}
                                  webcam: calibration UI → EMA-smoothed gaze → dispatch events

document_idle   [isolated]  content.js
                              └─> document.addEventListener('aikwau:gazefocus')
                              └─> detectTextLang(text) → lang='zh'|'en'
                              └─> elementFromPoint(x, y) → triggerL1(el)
                              └─> chrome.runtime.sendMessage({type:'summarize', text, lang})
                              └─> on response: markSummaryReady(el) → yellow highlight
                              └─> Shift key → replace paragraph text with summary
```

### Summary pipeline
```
[content.js isolated] ──sendMessage──> [background.js service worker]
                                            └─> connectNative('com.hp.aikwau.summarizer')
                                            └─> port.postMessage({action:'summarize', lang, ...})
                                                        |
                                            [native_host.exe — PyInstaller frozen]
                                                └─> build_prompt(text, lang)
                                                └─> LLMPipeline.generate()
                                                └─> _format_output(result, lang)
                                                    ├─> zhconv.convert(..., 'zh-tw')  [if zh]
                                                    ├─> strip markdown bold **...**
                                                    └─> numbered list → • bullets
                                                └─> send_msg({status:'ok', summary:'...'})
                                                        |
                                        [background.js] ──sendResponse──> [content.js]
                                                                              └─> markSummaryReady(el)
                                                                              └─> yellow highlight
                                                                              └─> installShiftReplace
```

## Key File Details

### `benchmark.py` — Benchmark script
- Frozen-exe aware: `_BASE = Path(sys.executable).parent` when frozen
- Adds DLL search dirs for OpenVINO/tokenizers in frozen mode
- Sets `OPENVINO_TOKENIZERS_PATH_GENAI` env var for C++ plugin loader
- `import openvino_tokenizers` before `import openvino_genai` (avoids mutex race)
- `_silence_fd1()`: redirects fd 1 → devnull using pre-saved `_STDOUT_FD` to hide OpenVINO progress
- Use `--model-dir` flag or `AIKWAU_MODEL_DIR` env var to override default model path
- Outputs device recommendation with correct priority string (NPU,GPU,CPU / GPU,CPU / CPU)

### `native_host.py` — Inference Host
- Reads 4-byte LE uint32 length prefix, then JSON from stdin
- Sends 4-byte LE uint32 length prefix, then JSON to stdout (via `_STDOUT_FD` not fd 1)
- Supports actions: `ping` → `{status:'loading'|'ready'|'error'}` and `summarize` → `{status:'ok', summary:'...'}`
- `reqId` echoed back for async matching; logs to `aikwau_host.log`
- `DEVICE_PRIORITY = "CPU"` — change to `"NPU,GPU,CPU"` on Panther Lake
- Model loaded in background thread; ping returns `loading` while warming up
- `build_prompt(text, lang)`: English → English bullets prompt; zh → Chinese bullets prompt
- `_format_output(result, lang)`: zhconv zh→tw (if zh), strip `**md**`, numbered→`•` bullets
- `OPENVINO_TOKENIZERS_PATH_GENAI` env var set in frozen init block for C++ plugin discovery

### `native_host.spec` / `benchmark.spec` — PyInstaller specs
- `collect_all('openvino')` + `collect_all('openvino_genai')` + `collect_all('openvino_tokenizers')` + `collect_all('zhconv')`
- `_CRT_EXACT` set drops bundled CRT DLLs by exact filename (preserves numpy's `msvcp140-<hash>.dll`)
- Excludes: `tkinter`, `matplotlib`, `PIL`, `cv2`, `scipy`, `pandas`, `openvino_telemetry`
- `openvino_telemetry` excluded to prevent telemetry thread crash in frozen env
- Dev headers/cmake/tools filtered out by `_DEV_DIRS`

### `content.js` — L1 + summary + yellow highlight (isolated world)
- `detectTextLang(text)`: counts CJK chars; >8% → `'zh'`, else `'en'`
- `triggerL1(el, text)`: applies L1/L2, silently requests summary (no loading badge)
- `markSummaryReady(el)`: adds `.aikwau-summary-ready` (yellow background)
- `installShiftReplace(el, summary)`: always installed when summary is ready
- Shift key pressed → `el.textContent = summary`, removes yellow, restores on next cleanup
- `compactSummary()`: preserves `\n` (only collapses spaces/tabs), supports 220-char limit
- SPA navigation: `pushState`/`replaceState`/`popstate` all call `_clearOnNavigate()`
- Webcam mode: badge positioned at right side (`positionBadgeRight`) instead of cursor
- `isWebcamMode` flag read from storage at init
- `noteTheme`: `'dark'`|`'light'`, applied to `.aikwau-margin-note--light` class

### `content.css`
- `.aikwau-l1`: bold + dark text
- `.aikwau-l2`: 1.2× font size
- `.aikwau-summary-ready`: semi-transparent yellow background + gold outline (signals Shift available)
- `.aikwau-badge`: floating summary badge (`white-space: pre-line` for bullet newlines)
- `.aikwau-margin-note`: dark navy bg, white text, 240px wide, `white-space: pre-line`
- `.aikwau-margin-note--light`: white bg, dark text override
- `.aikwau-beacon`: edge arrow for blind-area interactive elements

### `popup.html` / `popup.js` — Popup UI
- Mode: 滑鼠模式 / 眼球追蹤
- Reading features: L2 toggle, Shift-replace toggle, margin note toggle
- Margin note color: 黑底白字 / 白底黑字 (shown when margin note enabled)
- Webcam extras: panel visible, gaze ring visible, calibration points (9/25), recalibrate button
- Heatmap: 24×14 grid heat visualization, clear button
- Storage keys: `aikwau_gaze_mode`, `aikwau_l2_enabled`, `aikwau_shift_replace`, `aikwau_margin_note`, `aikwau_note_theme`, `aikwau_webcam_panel_visible`, `aikwau_gaze_ring_visible`, `aikwau_cal_points`

### `mode_bridge.js` — World bridge
- Runs at `document_start` in isolated world
- Sets `document.documentElement.setAttribute('data-aikwau-mode', 'mouse')` synchronously
- Reads `chrome.storage.local.aikwau_gaze_mode` → updates attribute + fires `aikwau:mode-ready`

### `gaze_tracker.js` — Gaze tracking (MAIN world)
- Mouse mode: `mouseover` + 2000ms dwell → dispatch `aikwau:gazefocus {x, y}`
- Webcam mode: calibration overlay → EMA-smoothed gaze → dispatch events
- EMA: `SMOOTH_ALPHA = 0.05` in gaze_tracker; `0.25` in content.js webcam path
- Events carry `{x, y}` viewport coords only (element refs don't cross world boundary)

### `background.js` — Service Worker
- Lazy-connects native host on first `summarize` request
- Pings host on connect; waits for `ready` before forwarding requests
- Maps `reqId` → callback in `pending` Map
- On disconnect: rejects all pending with error

### `register.py` — Host Registration
- Creates `run_host.bat` calling `native_host.exe` (not python, uses frozen exe)
- Patches `host_manifest.json` with real `.bat` path and extension ID
- Writes registry key `HKCU\...\com.hp.aikwau.summarizer` → `host_manifest.json`

## WebGazer Notes

- **Version**: 2.1.2 (npm), bundled as `poc/extension/webgazer.js` (2.3 MB minified)
- **Why v2 not v3**: v3 uses MediaPipe which dynamically loads JS — blocked by page CSP
- **Why MAIN world**: v2 uses TF.js which calls `new Function()` for WebGL — blocked by extension isolated-world CSP
- **Model source**: TF.js loads facemesh model from tfhub.dev on first use (cached by browser after)
- **Accuracy**: ±100–200px uncalibrated; ±50–100px after calibration (paragraph-level is sufficient)

## Tech Stack

| Layer | Technology |
|---|---|
| Browser | Microsoft Edge (MV3 extension) |
| Eye tracking (PoC) | Mouse hover simulation (default) |
| Eye tracking (real) | WebGazer.js v2.1.2 (webcam, TF.js-based, MAIN world) |
| AI inference | OpenVINO GenAI (Python, frozen exe) |
| Model | Qwen2.5-1.5B-Instruct, INT4 quantized via optimum-intel (sym, group_size=128) |
| Post-processing | zhconv (simplified→traditional Chinese conversion) |
| Hardware | Intel NPU → iGPU → CPU (auto-fallback) |
| Host protocol | Native Messaging (length-prefixed JSON) |
| Distribution | PyInstaller onedir (native_host.exe + _internal/) |
| Registry | HKCU (no admin required) |

## Potential Next Features

- [ ] Native Messaging host registration and browser end-to-end test ← **immediate**
- [ ] L2 text enlargement (triggered by longer dwell, e.g. 4s)
- [ ] Streaming inference (show summary word-by-word as generated)
- [ ] WebGazer local model cache (avoid tfhub.dev dependency)
- [ ] Windows Accessibility API integration (Phase 2 — beyond browser)
- [ ] Tobii/HP SureView real eye tracker hardware integration

## Useful Commands

```cmd
# Check OpenVINO can see NPU
python -c "import openvino as ov; print(ov.Core().available_devices)"

# Test native_host.exe manually (from poc/native_host/, set AIKWAU_MODEL_DIR first)
set AIKWAU_MODEL_DIR=C:\...\poc\models\qwen2.5-1.5b-int4
set PYTHONUTF8=1
python -c "
import subprocess, json, struct, os, time
p = subprocess.Popen(['dist\\native_host\\native_host.exe'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=dict(os.environ))
def send(o): d=json.dumps(o).encode(); p.stdin.write(struct.pack('=I',len(d))+d); p.stdin.flush()
def recv(): n=struct.unpack('=I',p.stdout.read(4))[0]; return json.loads(p.stdout.read(n))
send({'action':'ping','reqId':1}); r=recv()
while r.get('status')=='loading': time.sleep(2); send({'action':'ping','reqId':1}); r=recv()
print('ready:', r)
send({'action':'summarize','text':'AI is transforming healthcare with new diagnostic tools.','lang':'en','reqId':2}); print(recv())
"

# Rebuild frozen exes (from poc/native_host/ with venv active)
# Delete ov_cache first if PermissionError: rmdir /s /q dist\native_host\ov_cache
pyinstaller --clean -y native_host.spec
pyinstaller --clean -y benchmark.spec

# Run benchmark (frozen exe)
dist\benchmark\benchmark.exe --model-dir C:\...\poc\models\qwen2.5-1.5b-int4

# View native host logs
type poc\native_host\aikwau_host.log

# Check registry key exists
reg query HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer

# Check extension storage (run in Edge DevTools → background service worker console)
chrome.storage.local.get(null, console.log)
```
