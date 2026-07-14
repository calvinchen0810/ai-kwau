# High Contrast Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5-value High Contrast theme (off / aquatic / desert / dusk / nightsky) that recolours L1, summary ready/shown outlines, and blind-spot highlights, selectable from the popup, replacing the existing custom colour pickers.

**Architecture:** Static CSS keyed off a `data-aikwau-hc-theme` attribute on `<html>`, set by `mode_bridge.js` (isolated world, `document_start`) from `chrome.storage.local.aikwau_hc_theme`, with a live `chrome.storage.onChanged` listener so theme switches apply without a page reload. No runtime CSS generation — all five palettes are static rule blocks in `content.css`.

**Tech Stack:** Vanilla JS (MV3 extension, no build step), plain CSS, `chrome.storage.local`.

## Global Constraints

- New storage key: `aikwau_hc_theme`, values `'off' | 'aquatic' | 'desert' | 'dusk' | 'nightsky'`.
- Default when key is unset: `'nightsky'` (NOT `'off'`).
- Removed storage keys: `aikwau_color_ready`, `aikwau_color_shown`.
- Palette table (exact hex values, do not substitute):

  | Theme | L1 bg | L1 text | Ready outline | Shown outline | Accent (blind-spot) |
  |---|---|---|---|---|---|
  | off | (none) | `#080808` (unchanged) | `#ffee00` | `#00cc77` | `#ffee00` (unchanged) |
  | aquatic | `#003044` | `#eaffff` | `#00c2e0` | `#00e5ff` | `#00e5ff` |
  | desert | `#2b1400` | `#fff2d9` | `#d68a2e` | `#ffb020` | `#ffb020` |
  | dusk | `#2a0a3d` | `#f5e6ff` | `#d64fc0` | `#ff4fd8` | `#ff4fd8` |
  | nightsky | `#05060f` | `#f0f4ff` | `#3a8fd6` | `#4fc3ff` | `#4fc3ff` |

- Ready outline is always 2px, shown outline is always 3px + a glow (`box-shadow`), across every theme including `off`.
- Use CSS `outline` (not `border`) for ready/shown/highlight states — `outline` doesn't affect box layout, avoiding paragraph reflow when switching 2px→3px.
- No Extension reload required for a theme switch: it's a live `chrome.storage.onChanged` reaction, not a stored value read once at page load (unlike `aikwau_gaze_mode`, which does require a reload).
- This project has no automated test runner. "Tests" in this plan are exact manual steps (DevTools console commands with expected output) — run them for real and confirm the actual output before moving to the next step.

---

### Task 1: Live HC theme attribute in `mode_bridge.js`

**Files:**
- Modify: `poc/extension/mode_bridge.js` (currently 7 lines, full file shown below)

**Interfaces:**
- Produces: `document.documentElement` carries attribute `data-aikwau-hc-theme` with value `'off' | 'aquatic' | 'desert' | 'dusk' | 'nightsky'`, defaulting to `'nightsky'` when `chrome.storage.local.aikwau_hc_theme` is unset, and updating live on storage change. `content.css` (Task 2) selects on this attribute.

- [ ] **Step 1: Replace `mode_bridge.js` with the new content**

```javascript
// Isolated world: read chrome.storage, expose mode + HC theme to MAIN world via DOM attributes.
document.documentElement.setAttribute('data-aikwau-mode', 'mouse');
document.documentElement.setAttribute('data-aikwau-hc-theme', 'nightsky');

chrome.storage.local.get(['aikwau_gaze_mode', 'aikwau_hc_theme'], ({ aikwau_gaze_mode, aikwau_hc_theme }) => {
  const mode  = aikwau_gaze_mode ?? 'mouse';
  const theme = aikwau_hc_theme ?? 'nightsky';
  document.documentElement.setAttribute('data-aikwau-mode', mode);
  document.documentElement.setAttribute('data-aikwau-hc-theme', theme);
  document.dispatchEvent(new CustomEvent('aikwau:mode-ready', { detail: { mode, theme } }));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.aikwau_hc_theme) {
    document.documentElement.setAttribute('data-aikwau-hc-theme', changes.aikwau_hc_theme.newValue ?? 'nightsky');
  }
});
```

- [ ] **Step 2: Reload the unpacked extension and verify the default attribute**

In `edge://extensions`, click reload on the AI Kwau PoC card. Open any `http(s)://` page, open DevTools console, and run:

```javascript
chrome.storage.local.remove('aikwau_hc_theme', () => location.reload())
```

After the page reloads, run:

```javascript
document.documentElement.getAttribute('data-aikwau-hc-theme')
```

Expected: `'nightsky'`

- [ ] **Step 3: Verify live update without reload**

In the same console (do not reload the page), run:

```javascript
chrome.storage.local.set({ aikwau_hc_theme: 'desert' })
```

Then, without reloading, run:

```javascript
document.documentElement.getAttribute('data-aikwau-hc-theme')
```

Expected: `'desert'` (attribute changed with no page reload)

- [ ] **Step 4: Commit**

```bash
git add poc/extension/mode_bridge.js
git commit -m "feat: add live HC theme attribute to mode_bridge.js"
```

---

### Task 2: HC theme CSS in `content.css`

**Files:**
- Modify: `poc/extension/content.css:15-32` (paragraph highlight states)
- Modify: `poc/extension/content.css:75-155` (blind-spot highlight/hint block — append theme overrides after it)

**Interfaces:**
- Consumes: `data-aikwau-hc-theme` attribute on `<html>` (Task 1).
- Produces: `.aikwau-l1`, `.aikwau-summary-ready`, `.aikwau-summary-shown`, `.aikwau-highlight`, `.aikwau-hint-icon` all render themed per the Global Constraints palette table. No JS or inline styles are involved — purely CSS selectors.

- [ ] **Step 1: Replace the paragraph highlight block (lines 15–32) with outline-only defaults**

Replace:

```css
/* ── Paragraph highlight states (colours overridden by injected <style> from content.js) ── */
.aikwau-summary-ready {
  background-color: rgba(255, 238, 0, 0.15) !important;
  outline: 2px solid rgba(220, 200, 0, 0.35) !important;
  outline-offset: 2px;
  border-radius: 3px;
  transition: background-color 0.3s ease, outline 0.3s ease;
  cursor: pointer;
}

.aikwau-summary-shown {
  background-color: rgba(0, 204, 119, 0.20) !important;
  outline: 2px solid rgba(0, 180, 100, 0.45) !important;
  outline-offset: 2px;
  border-radius: 3px;
  transition: background-color 0.3s ease, outline 0.3s ease;
  cursor: pointer;
}
```

With:

```css
/* ── Paragraph highlight states: outline-only, colour set per HC theme (data-aikwau-hc-theme) ── */
.aikwau-summary-ready {
  background: none !important;
  outline: 2px solid #ffee00 !important;
  outline-offset: 2px;
  border-radius: 3px;
  transition: outline-color 0.3s ease, box-shadow 0.3s ease;
  cursor: pointer;
}

.aikwau-summary-shown {
  background: none !important;
  outline: 3px solid #00cc77 !important;
  outline-offset: 2px;
  border-radius: 3px;
  box-shadow: 0 0 6px #00cc77;
  transition: outline-color 0.3s ease, box-shadow 0.3s ease;
  cursor: pointer;
}
```

- [ ] **Step 2: Add themed L1 + summary + blind-spot rule blocks at the end of the file**

Append to the end of `content.css`:

```css
/* ── High Contrast themes (data-aikwau-hc-theme) ─────────────────────── */
[data-aikwau-hc-theme="aquatic"] .aikwau-l1 { background-color: #003044 !important; color: #eaffff !important; }
[data-aikwau-hc-theme="aquatic"] .aikwau-summary-ready { outline-color: #00c2e0 !important; }
[data-aikwau-hc-theme="aquatic"] .aikwau-summary-shown { outline-color: #00e5ff !important; box-shadow: 0 0 6px #00e5ff; }
[data-aikwau-hc-theme="aquatic"] .aikwau-highlight { outline-color: rgba(0, 229, 255, 0.75) !important; animation-name: aikwau-hl-pulse-aquatic; }
[data-aikwau-hc-theme="aquatic"] .aikwau-hint-icon { background: #00e5ff; }
@keyframes aikwau-hl-pulse-aquatic {
  0%, 100% { outline-color: rgba(0, 194, 224, 0.50); box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.08); }
  50%      { outline-color: rgba(0, 229, 255, 1.00); box-shadow: 0 0 0 5px rgba(0, 229, 255, 0.25), 0 0 14px rgba(0, 229, 255, 0.40); }
}

[data-aikwau-hc-theme="desert"] .aikwau-l1 { background-color: #2b1400 !important; color: #fff2d9 !important; }
[data-aikwau-hc-theme="desert"] .aikwau-summary-ready { outline-color: #d68a2e !important; }
[data-aikwau-hc-theme="desert"] .aikwau-summary-shown { outline-color: #ffb020 !important; box-shadow: 0 0 6px #ffb020; }
[data-aikwau-hc-theme="desert"] .aikwau-highlight { outline-color: rgba(255, 176, 32, 0.75) !important; animation-name: aikwau-hl-pulse-desert; }
[data-aikwau-hc-theme="desert"] .aikwau-hint-icon { background: #ffb020; }
@keyframes aikwau-hl-pulse-desert {
  0%, 100% { outline-color: rgba(214, 138, 46, 0.50); box-shadow: 0 0 0 3px rgba(255, 176, 32, 0.08); }
  50%      { outline-color: rgba(255, 176, 32, 1.00); box-shadow: 0 0 0 5px rgba(255, 176, 32, 0.25), 0 0 14px rgba(255, 176, 32, 0.40); }
}

[data-aikwau-hc-theme="dusk"] .aikwau-l1 { background-color: #2a0a3d !important; color: #f5e6ff !important; }
[data-aikwau-hc-theme="dusk"] .aikwau-summary-ready { outline-color: #d64fc0 !important; }
[data-aikwau-hc-theme="dusk"] .aikwau-summary-shown { outline-color: #ff4fd8 !important; box-shadow: 0 0 6px #ff4fd8; }
[data-aikwau-hc-theme="dusk"] .aikwau-highlight { outline-color: rgba(255, 79, 216, 0.75) !important; animation-name: aikwau-hl-pulse-dusk; }
[data-aikwau-hc-theme="dusk"] .aikwau-hint-icon { background: #ff4fd8; }
@keyframes aikwau-hl-pulse-dusk {
  0%, 100% { outline-color: rgba(214, 79, 192, 0.50); box-shadow: 0 0 0 3px rgba(255, 79, 216, 0.08); }
  50%      { outline-color: rgba(255, 79, 216, 1.00); box-shadow: 0 0 0 5px rgba(255, 79, 216, 0.25), 0 0 14px rgba(255, 79, 216, 0.40); }
}

[data-aikwau-hc-theme="nightsky"] .aikwau-l1 { background-color: #05060f !important; color: #f0f4ff !important; }
[data-aikwau-hc-theme="nightsky"] .aikwau-summary-ready { outline-color: #3a8fd6 !important; }
[data-aikwau-hc-theme="nightsky"] .aikwau-summary-shown { outline-color: #4fc3ff !important; box-shadow: 0 0 6px #4fc3ff; }
[data-aikwau-hc-theme="nightsky"] .aikwau-highlight { outline-color: rgba(79, 195, 255, 0.75) !important; animation-name: aikwau-hl-pulse-nightsky; }
[data-aikwau-hc-theme="nightsky"] .aikwau-hint-icon { background: #4fc3ff; }
@keyframes aikwau-hl-pulse-nightsky {
  0%, 100% { outline-color: rgba(58, 143, 214, 0.50); box-shadow: 0 0 0 3px rgba(79, 195, 255, 0.08); }
  50%      { outline-color: rgba(79, 195, 255, 1.00); box-shadow: 0 0 0 5px rgba(79, 195, 255, 0.25), 0 0 14px rgba(79, 195, 255, 0.40); }
}
```

- [ ] **Step 3: Verify computed styles per theme**

Reload the extension, open a test page with a `<p>` at least 40 characters long, open DevTools console, and for each theme run:

```javascript
chrome.storage.local.set({ aikwau_hc_theme: 'aquatic' }, () => {
  const p = document.querySelector('p');
  p.classList.add('aikwau-l1');
  console.log(getComputedStyle(p).backgroundColor, getComputedStyle(p).color);
});
```

Expected: `rgb(0, 48, 68) rgb(234, 255, 255)` (aquatic's `#003044` / `#eaffff`). Repeat with `'desert'`, `'dusk'`, `'nightsky'`, `'off'` and confirm `backgroundColor` is `rgba(0, 0, 0, 0)` for `'off'` and `color` stays `rgb(8, 8, 8)`.

- [ ] **Step 4: Commit**

```bash
git add poc/extension/content.css
git commit -m "feat: add High Contrast theme CSS rule blocks"
```

---

### Task 3: Remove colour-picker plumbing from `content.js`

**Files:**
- Modify: `poc/extension/content.js:28-30` (state vars)
- Modify: `poc/extension/content.js:292-311` (`hexToRgba` / `applyHighlightColors`)
- Modify: `poc/extension/content.js:326-337` (init storage read)
- Modify: `poc/extension/content.js:694-698` (`gaze:highlight-colors` message handler)

**Interfaces:**
- Consumes: none (pure deletion — theme colours now come entirely from `content.css` via Task 2).
- Produces: `content.js` no longer references `aikwau_color_ready`, `aikwau_color_shown`, `hexToRgba`, `applyHighlightColors`, or `colorStyleEl`.

- [ ] **Step 1: Remove the colour state variables**

In `content.js`, delete these lines (currently 28–30):

```javascript
  let colorReady        = '#ffee00';
  let colorShown        = '#00cc77';
  let colorStyleEl      = null;
```

- [ ] **Step 2: Remove `hexToRgba` and `applyHighlightColors`**

Delete this whole block (currently lines 292–311, including the section comment):

```javascript
  // ── Highlight colour injection ────────────────────────────────────────────
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function applyHighlightColors() {
    if (!colorStyleEl) {
      colorStyleEl = document.createElement('style');
      colorStyleEl.id = '__aikwau_colors';
      document.head.appendChild(colorStyleEl);
    }
    colorStyleEl.textContent =
      `.aikwau-summary-ready{background-color:${hexToRgba(colorReady, 0.15)}!important;` +
      `outline-color:${hexToRgba(colorReady, 0.40)}!important;}` +
      `.aikwau-summary-shown{background-color:${hexToRgba(colorShown, 0.20)}!important;` +
      `outline-color:${hexToRgba(colorShown, 0.50)}!important;}`;
  }

```

- [ ] **Step 3: Simplify the init storage read**

Replace (currently lines 326–337):

```javascript
  // ── Mode + feature-flag init ──────────────────────────────────────────────
  chrome.storage.local.get(
    ['aikwau_gaze_mode', 'aikwau_l2_enabled',
     'aikwau_color_ready', 'aikwau_color_shown'],
    (data) => {
      l2Enabled  = data.aikwau_l2_enabled !== false;
      colorReady = data.aikwau_color_ready ?? '#ffee00';
      colorShown = data.aikwau_color_shown ?? '#00cc77';
      isWebcamMode      = (data.aikwau_gaze_mode ?? 'mouse') === 'webcam';
      applyHighlightColors();
      if (isWebcamMode) initWebcam();
    }
  );
```

With:

```javascript
  // ── Mode + feature-flag init ──────────────────────────────────────────────
  chrome.storage.local.get(
    ['aikwau_gaze_mode', 'aikwau_l2_enabled'],
    (data) => {
      l2Enabled    = data.aikwau_l2_enabled !== false;
      isWebcamMode = (data.aikwau_gaze_mode ?? 'mouse') === 'webcam';
      if (isWebcamMode) initWebcam();
    }
  );
```

- [ ] **Step 4: Remove the `gaze:highlight-colors` message handler**

Delete this block (currently lines 694–698):

```javascript
    if (msg.type === 'gaze:highlight-colors') {
      if (msg.colorReady) colorReady = msg.colorReady;
      if (msg.colorShown) colorShown = msg.colorShown;
      applyHighlightColors();
    }
```

- [ ] **Step 5: Verify no references remain**

Run:

```bash
grep -n "colorReady\|colorShown\|hexToRgba\|applyHighlightColors\|colorStyleEl\|__aikwau_colors" poc/extension/content.js
```

Expected: no output (empty).

- [ ] **Step 6: Manual smoke test**

Reload the extension, open a test article page, hover a paragraph for 2s (mouse mode). Confirm in DevTools that the paragraph gets `.aikwau-summary-ready` once the summary arrives, and its outline colour matches whatever `aikwau_hc_theme` is currently set to (per Task 2's CSS) — with no console errors.

Then, on a page that uses `pushState` (or run `history.pushState({}, '', location.href)` in the console to simulate one), confirm `document.documentElement.getAttribute('data-aikwau-hc-theme')` is unchanged after the navigation — the theme attribute is set by `mode_bridge.js` independently of `content.js`'s `_clearOnNavigate()`/`cleanup()`, so SPA navigation must not reset or clear it.

- [ ] **Step 7: Commit**

```bash
git add poc/extension/content.js
git commit -m "refactor: remove colour-picker plumbing from content.js"
```

---

### Task 4: Replace colour pickers with theme buttons in `popup.html`

**Files:**
- Modify: `poc/extension/popup.html:46-49` (`.color-row` CSS)
- Modify: `poc/extension/popup.html:73-85` (colour picker markup)

**Interfaces:**
- Produces: 5 buttons with class `theme-btn` and `data-theme="off|aquatic|desert|dusk|nightsky"` inside a container `#themeGrid`, each toggling class `selected`. Consumed by Task 5 (`popup.js`).

- [ ] **Step 1: Replace the `.color-row` CSS block**

Replace (currently lines 46–49):

```css
    /* Color picker row */
    .color-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; font-size: 12px; color: #333; cursor: default; }
    .color-row input[type="color"] { margin-left: auto; width: 32px; height: 22px; padding: 1px 2px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: none; }
    .color-swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #bbb; flex-shrink: 0; }
```

With:

```css
    /* HC theme button grid */
    .theme-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 4px; }
    .theme-btn {
      font-size: 11px; padding: 6px 4px; border: 1px solid #ccc; border-radius: 4px;
      background: #fff; color: #333; cursor: pointer;
    }
    .theme-btn:hover { background: #f0f0f0; }
    .theme-btn.selected { background: #0058b0; color: #fff; border-color: #0058b0; font-weight: 600; }
```

- [ ] **Step 2: Replace the colour picker markup**

Replace (currently lines 73–85):

```html
  <div class="feat-sect">
    <div class="sect-lbl">段落醒目顏色（點擊切換摘要）</div>
    <div class="color-row">
      <span class="color-swatch" id="swatchReady" style="background:rgba(255,238,0,0.5)"></span>
      <span>摘要就緒</span>
      <input type="color" id="colorReady" value="#ffee00" title="摘要就緒顏色">
    </div>
    <div class="color-row">
      <span class="color-swatch" id="swatchShown" style="background:rgba(0,204,119,0.5)"></span>
      <span>摘要顯示中</span>
      <input type="color" id="colorShown" value="#00cc77" title="摘要顯示中顏色">
    </div>
  </div>
```

With:

```html
  <div class="feat-sect">
    <div class="sect-lbl">High Contrast 主題</div>
    <div class="theme-grid" id="themeGrid">
      <button type="button" class="theme-btn" data-theme="off">關閉</button>
      <button type="button" class="theme-btn" data-theme="aquatic">Aquatic</button>
      <button type="button" class="theme-btn" data-theme="desert">Desert</button>
      <button type="button" class="theme-btn" data-theme="dusk">Dusk</button>
      <button type="button" class="theme-btn" data-theme="nightsky">Night Sky</button>
    </div>
  </div>
```

- [ ] **Step 3: Verify no leftover references**

Run:

```bash
grep -n "colorReady\|colorShown\|color-row\|color-swatch" poc/extension/popup.html
```

Expected: no output (empty).

- [ ] **Step 4: Commit**

```bash
git add poc/extension/popup.html
git commit -m "feat: replace colour pickers with HC theme buttons in popup"
```

---

### Task 5: Wire theme buttons in `popup.js`

**Files:**
- Modify: `poc/extension/popup.js:1-13` (element refs)
- Modify: `poc/extension/popup.js:29-35` (`updateSwatch`)
- Modify: `poc/extension/popup.js:37-55` (init storage read)
- Modify: `poc/extension/popup.js:107-119` (colour input listeners)

**Interfaces:**
- Consumes: `.theme-btn[data-theme]` buttons from Task 4.
- Produces: writes `aikwau_hc_theme` to `chrome.storage.local` on click; `mode_bridge.js` (Task 1) picks up the change live — no `sendToTab` message needed for this feature.

- [ ] **Step 1: Replace element refs**

Replace (currently lines 1–13):

```javascript
const modeRadios      = document.querySelectorAll('input[name="mode"]');
const calPtsRadios    = document.querySelectorAll('input[name="calpts"]');
const recalibrate     = document.getElementById('recalibrate');
const calPointsOpts   = document.getElementById('calPointsOpts');
const webcamToggles   = document.getElementById('webcamToggles');
const panelVisible    = document.getElementById('panelVisible');
const ringVisible     = document.getElementById('ringVisible');
const l2Enabled       = document.getElementById('l2Enabled');
const colorReadyInput = document.getElementById('colorReady');
const colorShownInput = document.getElementById('colorShown');
const swatchReady     = document.getElementById('swatchReady');
const swatchShown     = document.getElementById('swatchShown');
const status          = document.getElementById('status');
```

With:

```javascript
const modeRadios      = document.querySelectorAll('input[name="mode"]');
const calPtsRadios    = document.querySelectorAll('input[name="calpts"]');
const recalibrate     = document.getElementById('recalibrate');
const calPointsOpts   = document.getElementById('calPointsOpts');
const webcamToggles   = document.getElementById('webcamToggles');
const panelVisible    = document.getElementById('panelVisible');
const ringVisible     = document.getElementById('ringVisible');
const l2Enabled       = document.getElementById('l2Enabled');
const themeButtons    = document.querySelectorAll('.theme-btn');
const status          = document.getElementById('status');
```

- [ ] **Step 2: Remove `updateSwatch` and add `setThemeUI`**

Replace (currently lines 29–35):

```javascript
// ── Load saved preferences ────────────────────────────────────────────────────
function updateSwatch(swatchEl, hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  swatchEl.style.background = `rgba(${r},${g},${b},0.5)`;
}
```

With:

```javascript
// ── Load saved preferences ────────────────────────────────────────────────────
function setThemeUI(theme) {
  themeButtons.forEach(btn => btn.classList.toggle('selected', btn.dataset.theme === theme));
}
```

- [ ] **Step 3: Update the init storage read**

Replace (currently lines 37–55):

```javascript
chrome.storage.local.get(
  ['aikwau_gaze_mode', 'aikwau_cal_points',
   'aikwau_webcam_panel_visible', 'aikwau_gaze_ring_visible',
   'aikwau_l2_enabled', 'aikwau_color_ready', 'aikwau_color_shown'],
  (data) => {
    const mode   = data.aikwau_gaze_mode ?? 'mouse';
    const pts    = data.aikwau_cal_points ?? 25;
    const cReady = data.aikwau_color_ready ?? '#ffee00';
    const cShown = data.aikwau_color_shown ?? '#00cc77';
    document.querySelector(`input[value="${mode}"]`).checked = true;
    setWebcamExtras(mode === 'webcam');
    setCalPtsUI(pts);
    panelVisible.checked = data.aikwau_webcam_panel_visible !== false;
    ringVisible.checked  = data.aikwau_gaze_ring_visible   !== false;
    l2Enabled.checked    = data.aikwau_l2_enabled          !== false;
    colorReadyInput.value = cReady; updateSwatch(swatchReady, cReady);
    colorShownInput.value = cShown; updateSwatch(swatchShown, cShown);
  }
);
```

With:

```javascript
chrome.storage.local.get(
  ['aikwau_gaze_mode', 'aikwau_cal_points',
   'aikwau_webcam_panel_visible', 'aikwau_gaze_ring_visible',
   'aikwau_l2_enabled', 'aikwau_hc_theme'],
  (data) => {
    const mode  = data.aikwau_gaze_mode ?? 'mouse';
    const pts   = data.aikwau_cal_points ?? 25;
    const theme = data.aikwau_hc_theme ?? 'nightsky';
    document.querySelector(`input[value="${mode}"]`).checked = true;
    setWebcamExtras(mode === 'webcam');
    setCalPtsUI(pts);
    panelVisible.checked = data.aikwau_webcam_panel_visible !== false;
    ringVisible.checked  = data.aikwau_gaze_ring_visible   !== false;
    l2Enabled.checked    = data.aikwau_l2_enabled          !== false;
    setThemeUI(theme);
  }
);
```

- [ ] **Step 4: Replace the colour input listeners with theme button listeners**

Replace (currently lines 107–119):

```javascript
colorReadyInput.addEventListener('input', () => {
  const color = colorReadyInput.value;
  updateSwatch(swatchReady, color);
  chrome.storage.local.set({ aikwau_color_ready: color });
  sendToTab({ type: 'gaze:highlight-colors', colorReady: color });
});

colorShownInput.addEventListener('input', () => {
  const color = colorShownInput.value;
  updateSwatch(swatchShown, color);
  chrome.storage.local.set({ aikwau_color_shown: color });
  sendToTab({ type: 'gaze:highlight-colors', colorShown: color });
});
```

With:

```javascript
themeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    chrome.storage.local.set({ aikwau_hc_theme: theme }, () => {
      setThemeUI(theme);
      status.textContent = `已切換至 ${btn.textContent} 主題`;
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});
```

- [ ] **Step 5: Verify no leftover references**

Run:

```bash
grep -n "colorReadyInput\|colorShownInput\|swatchReady\|swatchShown\|updateSwatch\|aikwau_color_ready\|aikwau_color_shown" poc/extension/popup.js
```

Expected: no output (empty).

- [ ] **Step 6: End-to-end manual verification**

Reload the extension, open the popup, and:
1. Confirm 5 theme buttons render, with "Night Sky" showing as `.selected` on first open (fresh storage).
2. Click each of the 5 buttons in turn; confirm the `status` text briefly shows `已切換至 <name> 主題` and the clicked button gets the `.selected` style.
3. With the popup open side-by-side with the page (or switch tabs and back), confirm the page's L1/summary/blind-spot colours update to match each clicked theme without needing a page reload.
4. Click "關閉" (off) and confirm the page reverts to the original bold/dark L1 with gold/green outline summary states.

- [ ] **Step 7: Commit**

```bash
git add poc/extension/popup.js
git commit -m "feat: wire HC theme buttons in popup to storage"
```
