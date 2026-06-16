# AI Kwau (愛看有) — Project Context for Claude Code

## Project Goal

AI Kwau is an on-device visual accessibility tool for HP laptops. It detects where the user is looking (gaze tracking) and automatically enhances the text they are reading — making it darker/bolder (L1) or larger (L2) — and optionally provides a short AI-generated summary of the paragraph.

Primary target: Intel Panther Lake laptops (NPU 100+ TOPS), HP pre-install scenario.

## Key Design Decisions (already made, do not change without discussing)

- **On-device only**: No cloud API, no telemetry. All AI runs via OpenVINO on Intel hardware.
- **Model**: Phi-4 Mini INT4 (~1.8 GB). Downloaded from HuggingFace, converted via optimum-intel.
- **Device priority**: `NPU,GPU,CPU` (OpenVINO auto-fallback). On Panther Lake, NPU first.
- **Browser target**: Microsoft Edge (pre-installed on HP). MV3 extension.
- **Communication**: Edge extension ↔ Python native host via Native Messaging (stdin/stdout, length-prefixed JSON).
- **Registry key**: `HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer` (no admin required).
- **Gaze simulation**: Mouse hover 2s dwell = gaze hold (PoC mode). Real eye tracking via WebGazer.js (webcam mode) is integrated but requires bundling webgazer.js separately.
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
    │   ├── download_convert.py      # Downloads Phi-4-mini, converts to OpenVINO INT4 IR
    │   └── benchmark.py             # Tests NPU/GPU/CPU latency, prints tok/s, recommends best device
    ├── native_host/
    │   ├── native_host.py           # Inference host: reads stdin, runs LLMPipeline, writes stdout
    │   ├── host_manifest.json       # Edge native host descriptor (path/origin patched by register.py)
    │   └── register.py              # Writes Windows Registry key + creates run_host.bat shim
    └── extension/
        ├── manifest.json            # MV3: nativeMessaging, activeTab, scripting, storage
        ├── gaze_tracker.js          # GazeTracker class — mouse simulation or WebGazer webcam mode
        ├── background.js            # Service worker: manages native port, routes requests with reqId
        ├── content.js               # Listens to gazefocus/gazeblur → L1 effect + summary badge
        └── content.css              # L1 bold/darken, summary badge (loading/ready/error)
```

## Current State (as of 2026-06-16)

All PoC files are implemented and pushed to `main`. The extension is feature-complete for mouse-simulation mode. The following have NOT been tested on real hardware yet:

- [ ] OpenVINO model conversion on Panther Lake
- [ ] NPU detection and inference via `benchmark.py`
- [ ] Native Messaging host registration and end-to-end test
- [ ] Real WebGazer.js eye tracking (requires bundling webgazer.js)

## Immediate Next Steps (on Panther Lake)

### Step 1 — Python environment
```cmd
cd ai-kwau\poc\model_setup
install_deps.bat
.venv\Scripts\activate
```

### Step 2 — Download + convert model (~15 min, ~1.8 GB output)
```cmd
python download_convert.py
```

### Step 3 — Benchmark hardware
```cmd
python benchmark.py
```
Expected: NPU listed in available devices, latency < 1 s on Panther Lake.

### Step 4 — Register native host
```cmd
cd ..\native_host
# First load extension in edge://extensions, copy the Extension ID
python register.py --extension-id <EXTENSION_ID>
```

### Step 5 — Test extension
- Open Edge → `edge://extensions` → Developer mode → Load unpacked → select `poc/extension/`
- Navigate to any article
- Hover a paragraph for 2 seconds
- Verify: text darkens + bold (L1), blue badge shows "Summarising…", then summary text

## Extension Architecture

```
[content.js]  ──gazefocus──>  triggerL1(el)
                                  └─> chrome.runtime.sendMessage({type:'summarize', text, lang})
                                              |
[background.js]  <─────────────────────────────
    └─> connectNative('com.hp.aikwau.summarizer')
    └─> port.postMessage({action:'summarize', text, lang, reqId})
                |
[native_host.py]  (Python, Windows process)
    └─> OpenVINO LLMPipeline.generate(prompt)
    └─> send_msg({status:'ok', summary:'...', reqId})
                |
[background.js]  <── response ──
    └─> pending.get(reqId)(resp)  ──> sendResponse
                |
[content.js]  <── sendResponse ──
    └─> updateBadge(summary)
```

## GazeTracker Modes

**Mouse mode (default):**
- `mouseover` + 2000ms `setTimeout` → `gazefocus` event
- `mouseout` → `gazeblur` event + cancel timer
- No hardware required, works for PoC demos

**Webcam mode (real eye tracking):**
1. Download `webgazer.js` from https://github.com/brownhci/WebGazer/releases
2. Place in `poc/extension/webgazer.js`
3. Add `"webgazer.js"` to `manifest.json` content_scripts js array (before `gaze_tracker.js`)
4. Set mode: `chrome.storage.local.set({ aikwau_gaze_mode: 'webcam' })`
5. Reload extension + page

WebGazer accuracy: ±50-100px after calibration (click 9 points on screen). Good enough for paragraph-level gaze detection. Works on any webcam.

## Key File Details

### `native_host.py` — Inference Host
- Reads 4-byte LE uint32 length prefix, then JSON from stdin
- Sends 4-byte LE uint32 length prefix, then JSON to stdout
- Supports actions: `ping` (returns `{status:'ready'}`) and `summarize` (returns `{status:'ok', summary:'...'}`)
- `reqId` is echoed back for async matching
- Logs to `aikwau_host.log` in same directory
- `DEVICE_PRIORITY = "NPU,GPU,CPU"` — change to `"CPU"` for debugging

### `background.js` — Service Worker
- Lazy-connects native host on first `summarize` request
- Pings host on connect to confirm model loaded
- Maps `reqId` → callback in `pending` Map
- On disconnect: rejects all pending with error

### `gaze_tracker.js` — GazeTracker
- Loaded before `content.js` in manifest content_scripts
- Sets `window.__aikwauTracker = new GazeTracker()`
- Mode persisted in `chrome.storage.local.aikwau_gaze_mode`
- Emits `CustomEvent('gazefocus')` and `CustomEvent('gazeblur')` on itself (not document)

### `register.py` — Host Registration
- Creates `run_host.bat` that calls `python native_host.py`
- Patches `host_manifest.json` with real `.bat` path and extension ID
- Writes registry key `HKCU\...\com.hp.aikwau.summarizer` pointing to `host_manifest.json`
- After running: reload the extension in Edge

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
| Eye tracking (PoC) | Mouse hover simulation |
| Eye tracking (real) | WebGazer.js (webcam, JS) |
| AI inference | OpenVINO GenAI (Python) |
| Model | Phi-4 Mini, INT4 quantized via optimum-intel |
| Hardware | Intel NPU → iGPU → CPU (auto-fallback) |
| Host protocol | Native Messaging (length-prefixed JSON) |
| Registry | HKCU (no admin required) |

## Potential Next Features (not yet started)

- [ ] L2 text enlargement (triggered by longer dwell, e.g. 4s)
- [ ] Gaze ring visual overlay (show where gaze is estimated)
- [ ] Calibration UI for WebGazer (9-point click calibration)
- [ ] Extension popup for toggling modes (mouse vs webcam)
- [ ] Streaming inference (show summary word-by-word as generated)
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

# View logs
type poc\native_host\aikwau_host.log

# Check registry key exists
reg query HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer
```
