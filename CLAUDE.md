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
- **Summary format**: Always bullet points (`• `). English paragraph → English bullets; Chinese paragraph → Traditional Chinese bullets (simplified→traditional via zhconv post-processing). Preamble lines (e.g. "以下是三個重點：") are stripped. Output is capped to never exceed the original paragraph length.
- **Summary UX**: No floating loading badge. When summary is ready, paragraph gets an outline (`aikwau-summary-ready`, 2px) plus a small "點擊摘要" tag label anchored at its top-right corner (since the outline alone was easy to miss). Left-clicking the paragraph replaces its text with the bullet summary, switches to a heavier outline + glow (`aikwau-summary-shown`, 3px), and the tag changes to "點擊還原". Clicking again restores the original text and tag. Outline/tag colours come from the active High Contrast theme (see below), not a user colour picker.
- **High Contrast theme**: Popup lets the user pick one of 5 themes — `off` (default look, gold/green outlines), `aquatic`, `desert`, `dusk`, `nightsky` (default on fresh install) — stored in `aikwau_hc_theme`. `mode_bridge.js` sets `data-aikwau-hc-theme` on `<html>` and live-updates it via `chrome.storage.onChanged` (no reload needed); `content.css` has static per-theme rule blocks keyed on that attribute, recolouring L1 (background+text), summary ready/shown outlines, and blind-spot highlight/hint colours. Replaces the old custom colour-picker feature entirely.
- **Click handler persistence**: Once a summary is fetched for a paragraph, the click handler stays on that element until SPA navigation — the user can click to toggle without hovering again.
- **Frozen exe**: `native_host.exe` and `benchmark.exe` are PyInstaller onedir builds. CRT v14.31 (bundled by PyInstaller) must be dropped so the exe uses System32's v14.44 — see CRT ABI fix below.

## Repository Structure

```
ai-kwau/
├── index.html              # English presentation (10 slides, 960×540 scaler)
├── doc/
│   └── index.html          # Developer documentation (bilingual zh/en toggle)
└── poc/
    ├── model_setup/
    │   ├── install_deps.bat         # Creates .venv, installs openvino + huggingface deps + zhconv
    │   ├── download_convert.py      # Downloads Qwen2.5-1.5B, converts to OpenVINO INT4 IR
    │   └── benchmark.py             # Tests NPU/GPU/CPU latency; frozen-exe aware; outputs tok/s
    ├── native_host/
    │   ├── native_host.py           # Inference host: reads stdin, runs LLMPipeline, writes stdout
    │   ├── host_manifest.json       # Edge native host descriptor (path/origin patched by register.py)
    │   ├── register.py              # Writes Windows Registry key + creates run_host.bat shim
    │   ├── build_exe.bat            # One-click build: native_host + benchmark + register → dist/aikwau-dist/
    │   ├── benchmark.spec           # PyInstaller spec for benchmark.exe (shares native_host _internal)
    │   ├── native_host.spec         # PyInstaller spec for native_host.exe (onedir, CRT drop)
    │   └── dist/
    │       ├── benchmark/           # benchmark.exe + _internal/
    │       ├── native_host/         # native_host.exe + _internal/  ← deployment source
    │       └── aikwau-dist/         # assembled transfer package (host/ + models/ + extension/)
    └── extension/
        ├── manifest.json            # MV3 v0.3.0: three content_scripts entries
        ├── mode_bridge.js           # Isolated world, document_start: reads storage → DOM attribute
        ├── webgazer.js              # WebGazer v2.1.2 minified (2.3 MB, bundled, MAIN world)
        ├── gaze_tracker.js          # MAIN world: mouse/webcam tracking → document CustomEvents
        ├── background.js            # Service worker: manages native port, routes requests with reqId
        ├── content.js               # Isolated world: gaze events → L1 + summary + click-toggle
        ├── content.css              # L1/L2 styles, summary-ready/shown highlight states, badge
        ├── popup.html               # Extension popup UI
        └── popup.js                 # Popup logic: storage reads/writes + tab messages
```

## Current State (as of 2026-07-15)

### Completed
- [x] OpenVINO model conversion on Panther Lake (Qwen2.5-1.5B INT4)
- [x] NPU/GPU/CPU inference benchmarked
- [x] Mouse mode: L1 effect (bold/darken) end-to-end
- [x] WebGazer v2.1.2 bundled and running in MAIN world
- [x] 9-point / 25-point calibration UI
- [x] Gaze ring visual indicator
- [x] EMA smoothing on gaze coordinates
- [x] Extension popup: mode switching, recalibrate, L2 toggle, High Contrast theme buttons
- [x] `benchmark.exe` (PyInstaller frozen) — working, correct output, CRT fix applied
- [x] `native_host.exe` (PyInstaller frozen) — working, ping/summarize end-to-end verified
- [x] Summary prompt: raw completion format, 3 bullet points, English→English / Chinese→Traditional Chinese
- [x] zhconv bundled in native_host.exe for simplified→traditional conversion
- [x] `_format_output`: strips preamble lines, strips markdown bold, caps output to ≤ original length
- [x] Outline paragraph highlight when summary ready; heavier outline + glow when summary shown
- [x] Left-click paragraph to toggle between original text and summary (persistent handler)
- [x] Click again to restore original text
- [x] High Contrast theme: 5 selectable themes (off/aquatic/desert/dusk/nightsky), live-applied via `data-aikwau-hc-theme` + static CSS, replacing the old colour-picker feature
- [x] SPA navigation: clears all summary handlers on pushState/replaceState/popstate
- [x] Webcam mode: badge fixed at right side (not cursor-following)
- [x] Per-paragraph language detection by CJK character ratio
- [x] `doc/index.html` updated with bilingual zh/en toggle
- [x] Blind-spot area: in-viewport element highlighting + floating hint tooltip (replaces edge beacon); hint tooltip is icon + arrow only (label text removed)
- [x] `build_exe.bat` fixed: uses `python -m PyInstaller` to avoid hardcoded venv launcher path
- [x] L2 text enlargement: adjustable slider (1.0×–3.0×, default 1.2×), live-applied via `gaze:l2-scale` message
- [x] High Contrast theme buttons preview their own theme's colours directly; selected state shown as a glow ring in the theme's accent colour
- [x] Hyperlinks inside `.aikwau-l1` recoloured per theme + forced underline (previously stayed unstyled, since `<a>`'s own colour rule never inherits from an ancestor)
- [x] Summary state tag label ("點擊摘要"/"點擊還原") anchored at each paragraph's top-right corner, document-positioned so it scrolls with the page
- [x] Popup UI enlarged (340px width, ~30% larger fonts/buttons/heatmap canvas) for readability
- [ ] Native Messaging host registration and browser end-to-end test ← **next step**

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

### Key Finding: PyInstaller launcher hardcodes venv path

`pyinstaller.exe` (the Windows launcher in `Scripts/`) bakes the absolute Python path at venv creation time. If the repo is moved or cloned to a different path, the launcher fails with `Unable to create process`. **Always use `python -m PyInstaller`** instead of calling `pyinstaller.exe` directly. `build_exe.bat` already uses `"%PYTHON%" -m PyInstaller` for this reason.

### Key Finding: Qwen Chat Template causes early EOS
Using Qwen2.5's `<|im_start|>/<|im_end|>` chat template causes the model to emit EOS after the first bullet point. Use raw completion prompts instead:
- ZH: `列出以下文章的重點（3點）：\n\n{text}\n\n重點：\n1.`
- EN: `List 3 key points from the following paragraph (each point under 20 words):\n\n{text}\n\nKey points:\n1.`

The model outputs numbered lists; `_format_output()` converts to `•` bullets, strips preamble, and caps length.

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
- Verify: text bold/dark (L1) + paragraph gets a themed outline + "點擊摘要" tag when summary ready
- Click the paragraph → text replaced with bullet summary, outline heavier + tag becomes "點擊還原"
- Click again → original text restored, back to the "點擊摘要" outline/tag

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
                              └─> on response: markSummaryReady(el, summary)
                                  └─> adds .aikwau-summary-ready (themed outline) + "點擊摘要" label
                                  └─> installs persistent click handler on el
                              └─> click → shows summary + .aikwau-summary-shown (themed outline) + "點擊還原" label
                              └─> click again → restores original text + back to "點擊摘要"
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
                                                └─> _format_output(result, lang, orig_len)
                                                    ├─> zhconv.convert(..., 'zh-tw')  [if zh]
                                                    ├─> strip preamble line (ends with ：or :)
                                                    ├─> strip markdown bold **...**
                                                    ├─> numbered list → • bullets
                                                    └─> cap output to ≤ orig_len chars
                                                └─> send_msg({status:'ok', summary:'...'})
                                                        |
                                        [background.js] ──sendResponse──> [content.js]
                                                                              └─> markSummaryReady(el, summary)
                                                                              └─> themed outline + "點擊摘要" label + click handler
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
- `_format_output(result, lang, orig_len)`: zhconv zh→tw, strip preamble line, strip `**md**`, numbered→`•` bullets, cap to `orig_len` chars
- `OPENVINO_TOKENIZERS_PATH_GENAI` env var set in frozen init block for C++ plugin discovery

### `native_host.spec` / `benchmark.spec` — PyInstaller specs
- `collect_all('openvino')` + `collect_all('openvino_genai')` + `collect_all('openvino_tokenizers')` + `collect_all('zhconv')`
- `_CRT_EXACT` set drops bundled CRT DLLs by exact filename (preserves numpy's `msvcp140-<hash>.dll`)
- Excludes: `tkinter`, `matplotlib`, `PIL`, `cv2`, `scipy`, `pandas`, `openvino_telemetry`
- `openvino_telemetry` excluded to prevent telemetry thread crash in frozen env
- Dev headers/cmake/tools filtered out by `_DEV_DIRS`

### `content.js` — L1 + summary + click-toggle + blind-spot (isolated world)
- `detectTextLang(text)`: counts CJK chars; >8% → `'zh'`, else `'en'`
- `triggerL1(el, text)`: applies L1/L2, silently requests summary (no loading badge); skips if element already in `summaryReadyEls`. L2 sizing: captures `el.dataset.aikwauBase` (computed font-size in px) once, then sets an inline `font-size: base*l2Scale !important` — this inline style is what the browser actually renders; `content.css`'s `.aikwau-l2` class rule is only a fallback default and is always overridden when this runs.
- `l2Scale` (module state, default `1.2`): read from `aikwau_l2_scale` at init; live-updated via the `gaze:l2-scale` message from popup.js (mirrors `gaze:l2-toggle`)
- `reapplyL2Scale()`: on `gaze:l2-scale`, re-applies the new scale's inline font-size to every element currently carrying `.aikwau-l2` (via `document.querySelectorAll`), so dragging the popup slider live-resizes already-enlarged paragraphs without needing to re-gaze
- `markSummaryReady(el, summary)`: adds `.aikwau-summary-ready` and installs persistent click handler; stored in `summaryReadyEls` Map. Outline colour comes entirely from CSS (`content.css`'s per-theme rule blocks) — content.js does no colour logic. Also creates a `.aikwau-summary-label` div ("點擊摘要"), appended to `document.body`, stored as `entry.labelEl`.
- `positionSummaryLabel(labelEl, el)`: anchors the label to el's top-**right** corner using **document** coordinates (`rect.right/top + window.scrollX/scrollY - labelEl.offsetWidth`), not viewport ones — scrolls with the page automatically, no scroll listener needed (unlike the `position:fixed` blind-spot hints). Reads `labelEl.offsetWidth`, so the label's text must already be set and it must already be attached to the DOM before this runs.
- `repositionAllSummaryLabels()`: re-anchors every active label; called on window `resize` and after any element's own toggle (toggling changes that paragraph's height, which can reflow — i.e. shift the page position of — every label below it).
- Click handler (per element, persists until SPA navigation):
  - 1st click: saves `origText`, sets `el.textContent = summary`, switches to `.aikwau-summary-shown` (heavier outline + glow), label text → "點擊還原" + `.aikwau-summary-label--shown`
  - 2nd click: restores `origText`, switches back to `.aikwau-summary-ready`, label text → "點擊摘要"
- `clearAllSummaryEls()`: removes all click handlers, restores text if shown, clears classes, removes each `entry.labelEl` — called on SPA navigation
- `cleanup()`: only clears badge + `activeEl` ref; does NOT remove click handlers
- `compactSummary()`: preserves `\n` (only collapses spaces/tabs), supports 220-char limit
- SPA navigation: `pushState`/`replaceState`/`popstate` all call `_clearOnNavigate()` → clears summaries AND highlights (the `data-aikwau-hc-theme` attribute is untouched by this, since it's owned by `mode_bridge.js`, not content.js)
- Webcam mode: badge positioned at right side (`positionBadgeRight`) instead of cursor
- `isWebcamMode` flag read from storage at init
- **Blind-spot area** (gaze heatmap 24×14 grid, accumulated every ≥200ms):
  - `hmAccumulate(vx, vy)`: increments heatmap cell on each gaze event; persists to storage every 5s
  - `coldCells()`: finds cells with 0 gaze data surrounded by ≥3 active cells (excludes unscrolled regions)
  - `scanBlindButtons()`: called after each `hmSave()`; finds in-viewport interactive elements whose center falls in a cold cell; adds up to `MAX_HIGHLIGHTS=4` total (only adds, never removes on scan)
  - `gazeCenter()`: computes weighted centroid of all hot cells → determines which side of element faces the user
  - `updateHighlights(list)`: adds `.aikwau-highlight` border to element + creates `.aikwau-hint` tooltip on the hot side (toward gaze centroid); tooltip is icon + arrow only (no label text — `elLabel()` was removed along with it)
  - `positionHint(hintEl, rect, side)`: places hint adjacent to element edge, clamped to viewport
  - `repositionAllHints()`: scroll/resize handler; hides hints for off-screen elements, repositions visible ones
  - `clearAllHighlights()`: removes all borders and tooltips; called on manual clear (`clearHighlights` message) or SPA nav; also resets `hmCells` and cancels `hmSaveTimer` so cleared storage isn't overwritten
  - `clearHighlights` message from popup: calls `clearAllHighlights()` + resets `hmCells.fill(0)` + cancels pending save timer
  - **Known limitation**: `coldCells()` ≥3 neighbor rule misses far-left/far-right sticky sidebars when the entire column is cold (no active neighbors in that direction)

### `content.css`
- `.aikwau-l1`: bold + dark text (base/`off`); themed blocks add a background colour + swap text colour. `.aikwau-l1 a`/`a:visited` are restyled separately (own accent colour per theme, gold `#ffee00` for `off`, forced `text-decoration: underline`) — a plain `<a>` colour rule always wins over inherited ancestor colour, so links need an explicit override or they'd stay unchanged after L1/theme darkens the paragraph around them.
- `.aikwau-l2`: `font-size: 1.2em !important` fallback default only — the real size is an inline style content.js sets per-element (see below), which always wins the cascade over this class rule
- `.aikwau-summary-ready`: outline-only (2px), `cursor:pointer` (signals clickable). Base/`off` colour: `#ffee00` (gold).
- `.aikwau-summary-shown`: outline-only (3px) + glow, `cursor:pointer` (summary is displayed). Base/`off` colour: `#00cc77` (green).
- `.aikwau-summary-label`: small pill tag ("點擊摘要"/"點擊還原"), `position: absolute` (document-anchored by content.js at the paragraph's top-right corner, not fixed), `pointer-events: none` so it never blocks page interaction. Background matches the paragraph's current outline colour per theme; `.aikwau-summary-label--shown` swaps to the shown-state colour.
- `.aikwau-badge`: floating summary badge (`white-space: pre-line` for bullet newlines)
- `.aikwau-highlight`: pulsing outline (`aikwau-hl-pulse` 2s, gold in base/`off`) applied to cold-zone interactive elements
- `.aikwau-hint`: fixed-position capsule tooltip, icon + arrow only (no label text); `.aikwau-hint-icon` (gold `!` circle in base/`off`), `.aikwau-hint-arrow`; `aikwau-hint-pulse` 2s breathing animation
- **High Contrast themes**: `[data-aikwau-hc-theme="aquatic|desert|dusk|nightsky"]` attribute-selector blocks at the end of the file override `.aikwau-l1` (bg+text), `.aikwau-summary-ready`/`-shown` (outline-color/box-shadow), `.aikwau-summary-label`/`-label--shown` (background), `.aikwau-highlight` (outline-color + `animation-name` to a themed `@keyframes` variant), and `.aikwau-hint-icon` (background). No dedicated `off` block — base rules above ARE the `off` appearance. See CLAUDE.md's Key Design Decisions and `docs/superpowers/specs/2026-07-15-high-contrast-theme-design.md` for the exact palette.

### `popup.html` / `popup.js` — Popup UI
- Mode: 滑鼠模式 / 眼球追蹤
- Reading features: L2 toggle + L2 scale slider (`#l2Scale`, range 1.0–3.0, step 0.1, default 1.2×) with live numeric label (`#l2ScaleLabel`); `input` event writes `aikwau_l2_scale` to storage (persistence) AND sends `gaze:l2-scale` via `sendToTab` (live application — mirrors the existing `gaze:l2-toggle` pattern, since content.js owns the actual font-size logic, not a CSS variable)
- High Contrast theme buttons: 5-button grid (`.theme-btn[data-theme]` = `off`/`aquatic`/`desert`/`dusk`/`nightsky`) in `#themeGrid`; click writes `aikwau_hc_theme` to storage and toggles `.selected` via `setThemeUI(theme)`. No `sendToTab` message needed — `mode_bridge.js`'s live `storage.onChanged` listener propagates the change. Each button previews its own theme's L1 background/text colours directly (`popup.html`'s `.theme-btn[data-theme="..."]` rules — same palette as `content.css`); selection is shown as a glow ring in the theme's own accent colour (`.theme-btn.selected[data-theme="..."]`), not a background swap, since the background is now taken by the theme preview.
- Webcam extras: panel visible, gaze ring visible, calibration points (9/25), recalibrate button
- Heatmap: 24×14 grid heat visualization, clear button — clicking clear: removes storage key AND sends `clearHighlights` to content.js (prevents stale `hmCells` from re-writing storage)
- Storage keys: `aikwau_gaze_mode`, `aikwau_l2_enabled`, `aikwau_l2_scale`, `aikwau_hc_theme`, `aikwau_webcam_panel_visible`, `aikwau_gaze_ring_visible`, `aikwau_cal_points`

### `mode_bridge.js` — World bridge
- Runs at `document_start` in isolated world
- Sets `document.documentElement.setAttribute('data-aikwau-mode', 'mouse')` and `data-aikwau-hc-theme='nightsky'` synchronously (defaults, before storage read completes)
- Reads `chrome.storage.local.{aikwau_gaze_mode, aikwau_hc_theme}` → updates both attributes + fires `aikwau:mode-ready` with `{mode, theme}`
- `aikwau_gaze_mode` is a one-shot read — changing mode requires a page reload. `aikwau_hc_theme` is different: a `chrome.storage.onChanged` listener updates `data-aikwau-hc-theme` live, so theme switches apply with no reload.
- Does NOT own L2 scale — that's content.js's job (inline per-element style, not a CSS attribute/variable), since `.aikwau-l2` sizing must be pinned to each element's captured base font-size rather than cascade through a shared variable.

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

## Features Intentionally Removed

- **Shift key replace**: Removed. Left-click on yellow paragraph is the only toggle mechanism.
- **Margin note (旁注摘要)**: Removed entirely — no sidebar annotations, no `.aikwau-margin-note` CSS, no `aikwau_margin_note` storage key.
- **Edge beacon (`.aikwau-beacon`)**: Removed. Replaced by in-viewport `.aikwau-highlight` border + `.aikwau-hint` tooltip system.

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

# Rebuild frozen exes — use build_exe.bat (assembles full transfer package)
# From poc/native_host/ with venv active:
.\build_exe.bat
# Output: dist\aikwau-dist\ (host\ + models\ + extension\ + install.bat)

# Or build individual specs manually (python -m PyInstaller avoids hardcoded launcher path):
# Delete ov_cache first if PermissionError: rmdir /s /q dist\native_host\ov_cache
..\model_setup\.venv\Scripts\python.exe -m PyInstaller --clean -y native_host.spec
..\model_setup\.venv\Scripts\python.exe -m PyInstaller --clean -y benchmark.spec

# Run benchmark (frozen exe)
dist\benchmark\benchmark.exe --model-dir C:\...\poc\models\qwen2.5-1.5b-int4

# View native host logs
type poc\native_host\aikwau_host.log

# Check registry key exists
reg query HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.hp.aikwau.summarizer

# Check extension storage (run in Edge DevTools → background service worker console)
chrome.storage.local.get(null, console.log)
```
