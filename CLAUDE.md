# AI Kwau (愛看有) — Project Context for Claude Code

## Project Goal

AI Kwau is an on-device visual accessibility tool for HP laptops. It detects where the user is looking (gaze tracking) and automatically enhances the text they are reading — making it darker/bolder (L1) or larger (L2) — and optionally provides a short AI-generated summary of the paragraph.

Primary target: Intel Panther Lake laptops (NPU 100+ TOPS), HP pre-install scenario.

## Key Design Decisions (already made, do not change without discussing)

- **On-device only**: No cloud API, no telemetry. All AI runs via OpenVINO on Intel hardware.
- **Model**: ~~Phi-4 Mini~~ **Qwen2.5-1.5B-Instruct INT4** (~800 MB). Downloaded from HuggingFace, converted via optimum-intel. Phi-4-mini was abandoned: its custom architecture (`configuration_phi3.py`) causes corrupted output on NPU with OpenVINO 2026.2.
- **Device priority**: `NPU,GPU,CPU` (OpenVINO auto-fallback). On Panther Lake, NPU first. Verified working with Qwen2.5-1.5B.
- **Browser target**: Microsoft Edge (pre-installed on HP). MV3 extension.
- **Communication**: Edge extension ↔ Python native host via Native Messaging (stdin/stdout, length-prefixed JSON).
- **Registry key**: `HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer` (no admin required).
- **Gaze tracking**: Mouse hover 2s dwell (PoC default) OR WebGazer.js v2.1.2 (webcam, bundled). Toggled via extension popup.
- **WebGazer world**: Runs in MAIN world (not isolated) to bypass MV3 extension CSP which blocks `new Function()` used by TF.js. Gaze events bridge to isolated world via DOM CustomEvents with (x,y) coordinates.
- **Languages**: English and Traditional Chinese (zh). Prompt and badge language auto-detected from `document.documentElement.lang`.

## Repository Structure

```
ai-kwau/
├── index.html              # English presentation (10 slides, 960×540 scaler)
├── index-cht.html          # Chinese presentation (9 slides)
├── doc/
│   └── index.html          # Developer documentation (this PoC's architecture + phases)
└── poc/
    ├── model_setup/
    │   ├── install_deps.bat         # Creates .venv, installs openvino + huggingface deps
    │   ├── download_convert.py      # Downloads Qwen2.5-1.5B, converts to OpenVINO INT4 IR
    │   └── benchmark.py             # Tests NPU/GPU/CPU latency, prints tok/s, recommends best device
    ├── native_host/
    │   ├── native_host.py           # Inference host: reads stdin, runs LLMPipeline, writes stdout
    │   ├── host_manifest.json       # Edge native host descriptor (path/origin patched by register.py)
    │   └── register.py              # Writes Windows Registry key + creates run_host.bat shim
    └── extension/
        ├── manifest.json            # MV3 v0.3.0: three content_scripts entries (see architecture)
        ├── mode_bridge.js           # Isolated world, document_start: reads storage → DOM attribute
        ├── webgazer.js              # WebGazer v2.1.2 minified (2.3 MB, bundled, MAIN world)
        ├── gaze_tracker.js          # MAIN world: mouse/webcam tracking → document CustomEvents
        ├── background.js            # Service worker: manages native port, routes requests with reqId
        ├── content.js               # Isolated world: listens to gaze events → L1 effect + badge
        ├── content.css              # L1 bold/darken, summary badge (loading/ready/error)
        ├── popup.html               # Extension popup UI (mode toggle, recalibrate button)
        └── popup.js                 # Popup logic: reads/writes chrome.storage for mode
```

## Current State (as of 2026-06-22)

### Completed
- [x] OpenVINO model conversion on Panther Lake (Qwen2.5-1.5B INT4)
- [x] NPU/GPU/CPU inference benchmarked
- [x] Mouse mode: L1 effect (bold/darken) + badge pipeline working end-to-end
- [x] WebGazer v2.1.2 bundled and running in MAIN world
- [x] 9-point calibration UI (full-screen overlay, sequential click)
- [x] Gaze ring visual indicator (blue circle follows estimated gaze)
- [x] EMA smoothing on gaze coordinates (SMOOTH_ALPHA = 0.05)
- [x] Extension popup for mode switching (mouse ↔ webcam) + recalibrate button
- [ ] Native Messaging host registration and end-to-end test ← **next step**
- [ ] L2 text enlargement

### Hardware Test Results (Panther Lake, Qwen2.5-1.5B INT4)
| Device | Latency | Tokens/sec | Status |
|--------|---------|------------|--------|
| NPU (Intel AI Boost) | 1.62s | 37 tok/s | Clean output ✅ |
| GPU (iGPU) | 0.85s | 71 tok/s | Clean output ✅ |
| CPU | 1.32s | 45 tok/s | Clean output ✅ |

### Key Finding: Model Compatibility
- **Phi-4-mini**: INCOMPATIBLE with NPU — custom `configuration_phi3.py` architecture causes garbled/Greek-character output on OpenVINO 2026.2 NPU backend.
- **Qwen2.5-1.5B-Instruct**: COMPATIBLE — standard architecture, NPU produces correct output. INT4 (sym, group_size=128) achieves 37 tok/s on NPU.

### Key Finding: WebGazer CSP Issue
- WebGazer v3.x uses MediaPipe, which dynamically loads JS files at runtime. Host page CSP (`script-src`) blocks these loads — incompatible with content scripts.
- WebGazer v2.1.2 uses TF.js + clmtrackr (no dynamic JS loading), but TF.js uses `new Function()` for WebGL shaders, blocked by MV3 extension isolated-world CSP.
- **Solution**: Run webgazer.js in MAIN world (`"world": "MAIN"` in manifest content_scripts). Bridge gaze events to isolated world via DOM CustomEvents carrying `{x, y}` coordinates (primitives cross world boundaries; HTML elements do not).

## Immediate Next Step — Register Native Host

### Step 1 — Get Extension ID
`edge://extensions` → AI Kwau PoC → copy the 32-character **ID**

### Step 2 — Activate Python environment
```cmd
cd poc\model_setup
.venv\Scripts\activate
```
If not yet set up: `install_deps.bat` first.

### Step 3 — Download + convert model (if not done, ~15 min)
```cmd
python download_convert.py
```

### Step 4 — Register native host
```cmd
cd ..\native_host
python register.py --extension-id <EXTENSION_ID>
```

### Step 5 — Reload extension and test
- `edge://extensions` → reload AI Kwau PoC
- Navigate to any article, hover a paragraph 2 seconds (mouse mode)
- Verify: text bold/dark (L1) + blue badge shows summary text

## Extension Architecture

### Content script injection order (manifest.json)
```
document_start  [isolated]  mode_bridge.js
                              └─> chrome.storage → document.setAttribute('data-aikwau-mode', mode)
                              └─> document.dispatchEvent('aikwau:mode-ready')

document_idle   [MAIN]      webgazer.js  →  gaze_tracker.js
                              └─> reads data-aikwau-mode attribute
                              └─> mouse: mouseover+2s dwell
                                  webcam: webgazer.begin() → calibration UI → gaze listener
                              └─> document.dispatchEvent('aikwau:gazefocus', {x, y})
                              └─> document.dispatchEvent('aikwau:gazeblur')

document_idle   [isolated]  content.js
                              └─> document.addEventListener('aikwau:gazefocus')
                              └─> elementFromPoint(x, y) → triggerL1(el)
                              └─> chrome.runtime.sendMessage({type:'summarize', text, lang})
```

### Summary pipeline
```
[content.js isolated] ──sendMessage──> [background.js service worker]
                                            └─> connectNative('com.hp.aikwau.summarizer')
                                            └─> port.postMessage({action:'summarize', ...})
                                                        |
                                            [native_host.py — Python]
                                                └─> OpenVINO LLMPipeline.generate()
                                                └─> send_msg({status:'ok', summary:'...'})
                                                        |
                                        [background.js] ──sendResponse──> [content.js]
                                                                              └─> updateBadge(summary)
```

## Key File Details

### `mode_bridge.js` — World bridge (NEW)
- Runs at `document_start` in isolated world
- Sets `document.documentElement.setAttribute('data-aikwau-mode', 'mouse')` synchronously
- Reads `chrome.storage.local.aikwau_gaze_mode` → updates attribute + fires `aikwau:mode-ready` event

### `gaze_tracker.js` — Gaze tracking (MAIN world)
- Reads mode from DOM attribute (not chrome.storage — not accessible in MAIN world)
- Mouse mode: `document.mouseover` + 2000ms dwell → dispatch `aikwau:gazefocus`
- Webcam mode: `webgazer.begin()` → 9-point calibration overlay → EMA-smoothed gaze → dispatch events
- EMA smoothing: `SMOOTH_ALPHA = 0.05` (lower = smoother, higher = more responsive)
- Gaze ring: blue 40px fixed-position circle follows smoothed gaze point
- Calibration: full-screen dark overlay, 9 dots at 3×3 grid positions, sequential click, skip button
- Events carry `{x, y}` viewport coords — NOT element references (elements don't cross world boundary)

### `content.js` — L1 + badge (isolated world)
- Listens to `aikwau:gazefocus` on document, extracts `{x, y}`, calls `elementFromPoint(x, y)`
- Applies `aikwau-l1` class, shows loading badge, sends summarize message
- On response: updates badge to summary text (truncated to 72 chars) or error

### `native_host.py` — Inference Host
- Reads 4-byte LE uint32 length prefix, then JSON from stdin
- Sends 4-byte LE uint32 length prefix, then JSON to stdout
- Supports actions: `ping` → `{status:'ready'}` and `summarize` → `{status:'ok', summary:'...'}`
- `reqId` echoed back for async matching; logs to `aikwau_host.log`
- `DEVICE_PRIORITY = "NPU,GPU,CPU"` — change to `"CPU"` for debugging

### `background.js` — Service Worker
- Lazy-connects native host on first `summarize` request
- Pings host on connect to confirm model loaded
- Maps `reqId` → callback in `pending` Map
- On disconnect: rejects all pending with error

### `register.py` — Host Registration
- Creates `run_host.bat` that calls `python native_host.py`
- Patches `host_manifest.json` with real `.bat` path and extension ID
- Writes registry key `HKCU\...\com.hp.aikwau.summarizer` → `host_manifest.json`
- After running: reload the extension in Edge

### `popup.html` / `popup.js` — Mode switcher
- Radio buttons: 滑鼠模式 / 眼球追蹤
- On change: writes `chrome.storage.local.aikwau_gaze_mode`, shows "請重新整理頁面生效"
- Recalibrate button: sets `aikwau_needs_calibration: true` (calibration triggers on next page load)

## WebGazer Notes

- **Version**: 2.1.2 (npm), bundled as `poc/extension/webgazer.js` (2.3 MB minified)
- **Why v2 not v3**: v3 uses MediaPipe which dynamically loads JS — blocked by page CSP
- **Why MAIN world**: v2 uses TF.js which calls `new Function()` for WebGL — blocked by extension isolated-world CSP
- **Model source**: TF.js loads facemesh model from `https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1` on first use (requires internet, cached by browser after first load)
- **Accuracy**: ±100–200px uncalibrated; improves to ±50–100px after 9-point calibration. Good enough for paragraph-level detection.
- **Smoothing**: EMA with α=0.05 applied to raw gaze coordinates before hit-testing and ring display

## Presentation Files

`index.html` (EN) and `index-cht.html` (CHT) are single-file slide presentations:
- 960×540 virtual canvas scaled with `transform:scale()` on `.scaler`
- Mouse coordinate correction: `(e.clientX - rect.left) / scale`
- S4c mockup demonstrates L1/L2 effects with JS badge overlay
- `let cur=0, total=10` (EN) / `total=9` (CHT)
- Do NOT edit with browser Save-As — it bakes in transforms and breaks layout

## Tech Stack

| Layer | Technology |
|---|---|
| Browser | Microsoft Edge (MV3 extension) |
| Eye tracking (PoC) | Mouse hover simulation (default) |
| Eye tracking (real) | WebGazer.js v2.1.2 (webcam, TF.js-based, MAIN world) |
| AI inference | OpenVINO GenAI (Python) |
| Model | Qwen2.5-1.5B-Instruct, INT4 quantized via optimum-intel (sym, group_size=128) |
| Hardware | Intel NPU → iGPU → CPU (auto-fallback) |
| Host protocol | Native Messaging (length-prefixed JSON) |
| Registry | HKCU (no admin required) |

## Potential Next Features

- [ ] Native Messaging host registration and end-to-end test ← **immediate**
- [ ] L2 text enlargement (triggered by longer dwell, e.g. 4s)
- [ ] Streaming inference (show summary word-by-word as generated)
- [ ] WebGazer local model cache (avoid tfhub.dev dependency)
- [ ] Windows Accessibility API integration (Phase 2 — beyond browser)
- [ ] Tobii/HP SureView real eye tracker hardware integration

## Useful Commands

```cmd
# Check OpenVINO can see NPU
python -c "import openvino as ov; print(ov.Core().available_devices)"

# Test native host manually (run from poc/native_host/ with venv active)
python -c "
import subprocess, json, struct
p = subprocess.Popen(['python','native_host.py'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
def send(o): d=json.dumps(o).encode(); p.stdin.write(struct.pack('=I',len(d))+d); p.stdin.flush()
def recv(): n=struct.unpack('=I',p.stdout.read(4))[0]; return json.loads(p.stdout.read(n))
send({'action':'ping','reqId':1}); print(recv())
send({'action':'summarize','text':'AI is transforming healthcare with new diagnostic tools.','lang':'en','reqId':2}); print(recv())
"

# View native host logs
type poc\native_host\aikwau_host.log

# Check registry key exists
reg query HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer

# Check extension mode in storage (run from background service worker DevTools console)
chrome.storage.local.get(null, console.log)
```
