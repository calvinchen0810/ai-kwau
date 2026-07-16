# Reading Enhancement Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the bundled bold+contrast+summary behavior in the AI Kwau Edge extension into four independently toggleable reading-enhancement features (文字加粗 / 字型放大 / 加強對比 / 段落摘要), each controllable from the popup.

**Architecture:** `.aikwau-l1` (currently font-weight + colour in one CSS class) splits into `.aikwau-bold` and `.aikwau-contrast`. `content.js`'s `triggerL1()` gates each of the four effects (bold class, contrast class, existing L2 enlarge, summary fetch) behind its own boolean, read from `chrome.storage.local` and live-updated via `chrome.runtime`/`chrome.tabs` messages — mirroring the existing `l2Enabled` pattern exactly. `popup.html`/`popup.js` gain three new checkboxes alongside the existing L2 controls; the existing HC theme picker is untouched and stays global.

**Tech Stack:** Vanilla JS (MV3 content script / popup script), plain CSS, `chrome.storage.local`, no build step, no test runner — this codebase is manually verified in Edge (per project convention).

## Global Constraints

- All four new/changed toggles default to `true` (on) when the storage key is absent — read with the `data.aikwau_x_enabled !== false` pattern, matching the existing `l2Enabled` code.
- Toggling any switch does **not** retroactively change paragraphs already marked by a prior gaze trigger — it only affects elements triggered after the toggle changes. This matches existing `l2Enabled` behavior; do not add any "rescan and reapply" logic.
- The HC theme picker (`aikwau_hc_theme`, off/aquatic/desert/dusk/nightsky) stays fully independent of the new Contrast toggle — it must keep controlling summary outline/tag/blind-spot colours regardless of whether Contrast is on or off. Do not gate the theme grid behind the Contrast checkbox.
- Popup checkbox labels must read exactly: `文字加粗`, `字型放大`, `加強對比`, `段落摘要` (in that order).
- Spec source of truth: `docs/superpowers/specs/2026-07-16-reading-enhancement-toggles-design.md`.

---

## Task 1: Split `.aikwau-l1` into `.aikwau-bold` + `.aikwau-contrast` in `content.css`

**Files:**
- Modify: `poc/extension/content.css:1-18` (class definitions)
- Modify: `poc/extension/content.css:186-230` (4 HC theme colour blocks)

**Interfaces:**
- Consumes: nothing (pure CSS, no JS dependency yet)
- Produces: two CSS classes that Task 2's `content.js` will apply — `.aikwau-bold` (font-weight only) and `.aikwau-contrast` (colour/background, themed via `[data-aikwau-hc-theme="..."]` descendant selectors)

- [ ] **Step 1: Replace the `.aikwau-l1` class definition and its link-colour override**

In `poc/extension/content.css`, replace lines 1–18:

```css
/* ── L1: text darkens + bold ───────────────────────────────────────── */
.aikwau-l1 {
  color: #080808 !important;
  font-weight: 700 !important;
  letter-spacing: 0.15px;
  transition: color 0.3s ease, font-weight 0.3s ease, font-size 0.25s ease;
}

/* Links don't inherit .aikwau-l1's color (an <a> rule targets the element
   directly, which always wins over inherited ancestor colour) — restyle them
   explicitly using the active HC theme's own accent colour, so they stay both
   legible against the new background and distinguishable from body text.
   Underline is forced so colour isn't the only cue identifying a link. */
.aikwau-l1 a,
.aikwau-l1 a:visited {
  color: #ffee00 !important;
  text-decoration: underline !important;
}
```

with:

```css
/* ── Bold: font-weight only, no colour change ────────────────────────── */
.aikwau-bold {
  font-weight: 700 !important;
  letter-spacing: 0.15px;
  transition: font-weight 0.3s ease, font-size 0.25s ease;
}

/* ── Contrast: text/background colour, themed via data-aikwau-hc-theme ── */
.aikwau-contrast {
  color: #080808 !important;
  transition: color 0.3s ease, background-color 0.3s ease;
}

/* Links don't inherit .aikwau-contrast's color (an <a> rule targets the
   element directly, which always wins over inherited ancestor colour) —
   restyle them explicitly using the active HC theme's own accent colour,
   so they stay both legible against the new background and distinguishable
   from body text. Underline is forced so colour isn't the only cue
   identifying a link. */
.aikwau-contrast a,
.aikwau-contrast a:visited {
  color: #ffee00 !important;
  text-decoration: underline !important;
}
```

- [ ] **Step 2: Update the four HC theme colour blocks to target `.aikwau-contrast`**

In the same file, the `[data-aikwau-hc-theme="..."]` blocks (originally around lines 186–230) each have a background/colour rule and a two-line link-colour rule targeting `.aikwau-l1`. There is no `off` block (base rules above are the `off` appearance) — only `aquatic`, `desert`, `dusk`, `nightsky` need updating.

Replace:

```css
[data-aikwau-hc-theme="aquatic"] .aikwau-l1 { background-color: #003044 !important; color: #eaffff !important; }
[data-aikwau-hc-theme="aquatic"] .aikwau-l1 a,
[data-aikwau-hc-theme="aquatic"] .aikwau-l1 a:visited { color: #00e5ff !important; }
```

with:

```css
[data-aikwau-hc-theme="aquatic"] .aikwau-contrast { background-color: #003044 !important; color: #eaffff !important; }
[data-aikwau-hc-theme="aquatic"] .aikwau-contrast a,
[data-aikwau-hc-theme="aquatic"] .aikwau-contrast a:visited { color: #00e5ff !important; }
```

Replace:

```css
[data-aikwau-hc-theme="desert"] .aikwau-l1 { background-color: #2b1400 !important; color: #fff2d9 !important; }
[data-aikwau-hc-theme="desert"] .aikwau-l1 a,
[data-aikwau-hc-theme="desert"] .aikwau-l1 a:visited { color: #ffb020 !important; }
```

with:

```css
[data-aikwau-hc-theme="desert"] .aikwau-contrast { background-color: #2b1400 !important; color: #fff2d9 !important; }
[data-aikwau-hc-theme="desert"] .aikwau-contrast a,
[data-aikwau-hc-theme="desert"] .aikwau-contrast a:visited { color: #ffb020 !important; }
```

Replace:

```css
[data-aikwau-hc-theme="dusk"] .aikwau-l1 { background-color: #2a0a3d !important; color: #f5e6ff !important; }
[data-aikwau-hc-theme="dusk"] .aikwau-l1 a,
[data-aikwau-hc-theme="dusk"] .aikwau-l1 a:visited { color: #ff4fd8 !important; }
```

with:

```css
[data-aikwau-hc-theme="dusk"] .aikwau-contrast { background-color: #2a0a3d !important; color: #f5e6ff !important; }
[data-aikwau-hc-theme="dusk"] .aikwau-contrast a,
[data-aikwau-hc-theme="dusk"] .aikwau-contrast a:visited { color: #ff4fd8 !important; }
```

Replace:

```css
[data-aikwau-hc-theme="nightsky"] .aikwau-l1 { background-color: #05060f !important; color: #f0f4ff !important; }
[data-aikwau-hc-theme="nightsky"] .aikwau-l1 a,
[data-aikwau-hc-theme="nightsky"] .aikwau-l1 a:visited { color: #4fc3ff !important; }
```

with:

```css
[data-aikwau-hc-theme="nightsky"] .aikwau-contrast { background-color: #05060f !important; color: #f0f4ff !important; }
[data-aikwau-hc-theme="nightsky"] .aikwau-contrast a,
[data-aikwau-hc-theme="nightsky"] .aikwau-contrast a:visited { color: #4fc3ff !important; }
```

- [ ] **Step 3: Verify `.aikwau-l1` no longer appears anywhere in the file**

Run:
```bash
grep -n "aikwau-l1" poc/extension/content.css
```
Expected: no output (empty). If anything still matches, you missed a block — fix before continuing.

- [ ] **Step 4: Manually verify the CSS renders correctly**

Load the unpacked extension in Edge (`edge://extensions` → reload "AI Kwau PoC") on any article page, open DevTools console, and run:

```js
document.querySelector('p').classList.add('aikwau-bold', 'aikwau-contrast')
```

Expected: the first `<p>` on the page becomes bold with dark text (or, if a non-`off` HC theme is currently selected via the popup, a themed background + text colour). This confirms the renamed classes are wired to real CSS rules even though `content.js` hasn't been updated yet (Task 2).

Then run `document.querySelector('p').classList.remove('aikwau-bold', 'aikwau-contrast')` to reset the page before continuing.

- [ ] **Step 5: Commit**

```bash
git add poc/extension/content.css
git commit -m "$(cat <<'EOF'
Split .aikwau-l1 CSS into independent .aikwau-bold and .aikwau-contrast

Prepares content.css for four fully-decoupled reading-enhancement
toggles (bold/enlarge/contrast/summary) instead of one bundled L1 class.
EOF
)"
```

---

## Task 2: Wire independent bold/contrast/summary toggles into `content.js`

**Files:**
- Modify: `poc/extension/content.js:18-28` (module state)
- Modify: `poc/extension/content.js:288-297` (storage init block)
- Modify: `poc/extension/content.js:655-664` (runtime message handlers)
- Modify: `poc/extension/content.js:740-750` (`clearAllSummaryEls`)
- Modify: `poc/extension/content.js:752-785` (`triggerL1`)

**Interfaces:**
- Consumes: `.aikwau-bold` / `.aikwau-contrast` CSS classes from Task 1
- Produces: three new runtime message types popup.js (Task 3) will send —
  `{ type: 'gaze:bold-toggle', enabled: boolean }`,
  `{ type: 'gaze:contrast-toggle', enabled: boolean }`,
  `{ type: 'gaze:summary-toggle', enabled: boolean }` —
  plus three new storage keys read on init: `aikwau_bold_enabled`, `aikwau_contrast_enabled`, `aikwau_summary_enabled`.

- [ ] **Step 1: Add module state for the three new toggles**

In `poc/extension/content.js`, replace:

```js
  let l2Enabled         = true;   // L2 font enlargement
  let l2Scale           = 1.2;    // L2 enlargement multiplier (popup slider)
```

with:

```js
  let boldEnabled       = true;   // Bold font-weight
  let contrastEnabled   = true;   // Background/text colour recolour
  let l2Enabled         = true;   // L2 font enlargement
  let l2Scale           = 1.2;    // L2 enlargement multiplier (popup slider)
  let summaryEnabled    = true;   // Summary fetch + click-to-toggle
```

- [ ] **Step 2: Read the new storage keys on init**

Replace:

```js
  chrome.storage.local.get(
    ['aikwau_gaze_mode', 'aikwau_l2_enabled', 'aikwau_l2_scale'],
    (data) => {
      l2Enabled    = data.aikwau_l2_enabled !== false;
      l2Scale      = data.aikwau_l2_scale ?? 1.2;
      isWebcamMode = (data.aikwau_gaze_mode ?? 'mouse') === 'webcam';
      if (isWebcamMode) initWebcam();
    }
  );
```

with:

```js
  chrome.storage.local.get(
    ['aikwau_gaze_mode', 'aikwau_l2_enabled', 'aikwau_l2_scale',
     'aikwau_bold_enabled', 'aikwau_contrast_enabled', 'aikwau_summary_enabled'],
    (data) => {
      l2Enabled        = data.aikwau_l2_enabled !== false;
      l2Scale          = data.aikwau_l2_scale ?? 1.2;
      boldEnabled      = data.aikwau_bold_enabled !== false;
      contrastEnabled  = data.aikwau_contrast_enabled !== false;
      summaryEnabled   = data.aikwau_summary_enabled !== false;
      isWebcamMode     = (data.aikwau_gaze_mode ?? 'mouse') === 'webcam';
      if (isWebcamMode) initWebcam();
    }
  );
```

- [ ] **Step 3: Add message handlers for the three new toggle messages**

Replace:

```js
    if (msg.type === 'gaze:l2-toggle') { l2Enabled = msg.enabled; }
    if (msg.type === 'gaze:l2-scale') { l2Scale = msg.scale; reapplyL2Scale(); }
```

with:

```js
    if (msg.type === 'gaze:bold-toggle') { boldEnabled = msg.enabled; }
    if (msg.type === 'gaze:contrast-toggle') { contrastEnabled = msg.enabled; }
    if (msg.type === 'gaze:l2-toggle') { l2Enabled = msg.enabled; }
    if (msg.type === 'gaze:l2-scale') { l2Scale = msg.scale; reapplyL2Scale(); }
    if (msg.type === 'gaze:summary-toggle') { summaryEnabled = msg.enabled; }
```

- [ ] **Step 4: Gate each effect independently inside `triggerL1`**

Replace:

```js
  function triggerL1(el, text) {
    if (el === activeEl) return;
    cleanup();
    activeEl = el;
    el.classList.add('aikwau-l1');
    if (l2Enabled) {
      if (!el.dataset.aikwauBase) {
        el.dataset.aikwauBase = parseFloat(getComputedStyle(el).fontSize);
      }
      el.classList.add('aikwau-l2');
      const base = +el.dataset.aikwauBase;
      if (!isNaN(base)) el.style.setProperty('font-size', `${(base * l2Scale).toFixed(1)}px`, 'important');
    }

    // Already has a summary — nothing more to do
    if (summaryReadyEls.has(el)) return;

    const cacheKey = text.slice(0, 160);
    const cached = summaryCache.get(cacheKey);
    if (cached) {
      markSummaryReady(el, cached);
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'summarize', text, lang: detectTextLang(text) },
      (resp) => {
        if (!resp || resp.status !== 'ok') return;
        const summary = compactSummary(resp.summary);
        summaryCache.set(cacheKey, summary);
        markSummaryReady(el, summary);
      }
    );
  }
```

with:

```js
  function triggerL1(el, text) {
    if (el === activeEl) return;
    cleanup();
    activeEl = el;

    if (boldEnabled) el.classList.add('aikwau-bold');
    if (contrastEnabled) el.classList.add('aikwau-contrast');

    if (l2Enabled) {
      if (!el.dataset.aikwauBase) {
        el.dataset.aikwauBase = parseFloat(getComputedStyle(el).fontSize);
      }
      el.classList.add('aikwau-l2');
      const base = +el.dataset.aikwauBase;
      if (!isNaN(base)) el.style.setProperty('font-size', `${(base * l2Scale).toFixed(1)}px`, 'important');
    }

    if (!summaryEnabled) return;

    // Already has a summary — nothing more to do
    if (summaryReadyEls.has(el)) return;

    const cacheKey = text.slice(0, 160);
    const cached = summaryCache.get(cacheKey);
    if (cached) {
      markSummaryReady(el, cached);
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'summarize', text, lang: detectTextLang(text) },
      (resp) => {
        if (!resp || resp.status !== 'ok') return;
        const summary = compactSummary(resp.summary);
        summaryCache.set(cacheKey, summary);
        markSummaryReady(el, summary);
      }
    );
  }
```

- [ ] **Step 5: Update `clearAllSummaryEls` to remove the renamed classes**

Replace:

```js
      el.classList.remove('aikwau-summary-ready', 'aikwau-summary-shown',
                          'aikwau-l1', 'aikwau-l2');
```

with:

```js
      el.classList.remove('aikwau-summary-ready', 'aikwau-summary-shown',
                          'aikwau-bold', 'aikwau-contrast', 'aikwau-l2');
```

- [ ] **Step 6: Verify no remaining references to the old class name**

Run:
```bash
grep -n "aikwau-l1" poc/extension/content.js
```
Expected: no output (empty).

- [ ] **Step 7: Manually verify default (all-on) behavior is unchanged**

Reload the extension in Edge, navigate to any article page in mouse mode, hover a paragraph for 2 seconds. Expected (identical to pre-refactor behavior, since all three new flags default to `true` and popup.js hasn't been touched yet so no toggle messages are ever sent):
- Paragraph becomes bold + recoloured (dark text, or themed background if a non-`off` HC theme is active) + enlarged
- After a moment, the paragraph gets a themed outline and a "點擊摘要" tag
- Clicking it swaps in the bullet summary and switches to the heavier outline + "點擊還原" tag

- [ ] **Step 8: Commit**

```bash
git add poc/extension/content.js
git commit -m "$(cat <<'EOF'
Gate bold, contrast, and summary independently in triggerL1

Each of the four reading-enhancement effects (bold/enlarge/contrast/
summary) now reads its own storage-backed flag and responds to its own
gaze:*-toggle message, matching the existing l2Enabled pattern. All
three new flags default to true so behavior is unchanged until a user
flips a new popup toggle (added in the next commit).
EOF
)"
```

---

## Task 3: Add the four independent checkboxes to the popup UI

**Files:**
- Modify: `poc/extension/popup.html:41-47` (`.feat-sect` / `.l2-scale-row` CSS)
- Modify: `poc/extension/popup.html:88-95` (閱讀增強 section markup)
- Modify: `poc/extension/popup.js:1-12` (element refs)
- Modify: `poc/extension/popup.js:22-56` (init/load block)
- Modify: `poc/extension/popup.js:90-113` (change listeners)

**Interfaces:**
- Consumes: `gaze:bold-toggle`, `gaze:contrast-toggle`, `gaze:summary-toggle` message types and `aikwau_bold_enabled` / `aikwau_contrast_enabled` / `aikwau_summary_enabled` storage keys from Task 2
- Produces: nothing further downstream — this is the last wiring task

- [ ] **Step 1: Add a disabled-state CSS rule for the L2 scale slider row**

In `poc/extension/popup.html`, replace:

```css
    .l2-scale-row { display: flex; align-items: center; gap: 8px; margin: 6px 0 3px 26px; }
    .l2-scale-row input[type="range"] { flex: 1; }
    .l2-scale-row span { font-size: 13px; color: #555; width: 34px; text-align: right; flex-shrink: 0; }
```

with:

```css
    .l2-scale-row { display: flex; align-items: center; gap: 8px; margin: 6px 0 3px 26px; }
    .l2-scale-row input[type="range"] { flex: 1; }
    .l2-scale-row span { font-size: 13px; color: #555; width: 34px; text-align: right; flex-shrink: 0; }
    .l2-scale-row.disabled { opacity: 0.45; pointer-events: none; }
```

- [ ] **Step 2: Rewrite the 閱讀增強 section markup with four checkboxes**

Replace:

```html
  <div class="feat-sect">
    <div class="sect-lbl">閱讀增強</div>
    <label><input type="checkbox" id="l2Enabled"> L2 字型放大（注視時）</label>
    <div class="l2-scale-row">
      <input type="range" id="l2Scale" min="1" max="3" step="0.1" value="1.2">
      <span id="l2ScaleLabel">1.2×</span>
    </div>
  </div>
```

with:

```html
  <div class="feat-sect">
    <div class="sect-lbl">閱讀增強</div>
    <label><input type="checkbox" id="boldEnabled"> 文字加粗</label>
    <label><input type="checkbox" id="l2Enabled"> 字型放大</label>
    <div class="l2-scale-row" id="l2ScaleRow">
      <input type="range" id="l2Scale" min="1" max="3" step="0.1" value="1.2">
      <span id="l2ScaleLabel">1.2×</span>
    </div>
    <label><input type="checkbox" id="contrastEnabled"> 加強對比</label>
    <label><input type="checkbox" id="summaryEnabled"> 段落摘要</label>
  </div>
```

- [ ] **Step 3: Add element refs for the three new checkboxes and the slider row wrapper**

In `poc/extension/popup.js`, replace:

```js
const l2Enabled       = document.getElementById('l2Enabled');
const l2Scale         = document.getElementById('l2Scale');
const l2ScaleLabel    = document.getElementById('l2ScaleLabel');
```

with:

```js
const boldEnabled     = document.getElementById('boldEnabled');
const l2Enabled       = document.getElementById('l2Enabled');
const l2Scale         = document.getElementById('l2Scale');
const l2ScaleLabel    = document.getElementById('l2ScaleLabel');
const l2ScaleRow      = document.getElementById('l2ScaleRow');
const contrastEnabled = document.getElementById('contrastEnabled');
const summaryEnabled  = document.getElementById('summaryEnabled');
```

- [ ] **Step 4: Add a helper to grey out the slider row, and call it from `setL2ScaleUI`'s call sites**

Replace:

```js
function setL2ScaleUI(scale) {
  l2Scale.value = scale;
  l2ScaleLabel.textContent = `${scale.toFixed(1)}×`;
}
```

with:

```js
function setL2ScaleUI(scale) {
  l2Scale.value = scale;
  l2ScaleLabel.textContent = `${scale.toFixed(1)}×`;
}

function setL2RowDisabled(disabled) {
  l2Scale.disabled = disabled;
  l2ScaleRow.classList.toggle('disabled', disabled);
}
```

- [ ] **Step 5: Load the three new storage keys and initialize checkbox + disabled state**

Replace:

```js
chrome.storage.local.get(
  ['aikwau_gaze_mode', 'aikwau_cal_points',
   'aikwau_webcam_panel_visible', 'aikwau_gaze_ring_visible',
   'aikwau_l2_enabled', 'aikwau_l2_scale', 'aikwau_hc_theme'],
  (data) => {
    const mode  = data.aikwau_gaze_mode ?? 'mouse';
    const pts   = data.aikwau_cal_points ?? 25;
    const scale = data.aikwau_l2_scale ?? 1.2;
    const theme = data.aikwau_hc_theme ?? 'nightsky';
    document.querySelector(`input[value="${mode}"]`).checked = true;
    setWebcamExtras(mode === 'webcam');
    setCalPtsUI(pts);
    panelVisible.checked = data.aikwau_webcam_panel_visible !== false;
    ringVisible.checked  = data.aikwau_gaze_ring_visible   !== false;
    l2Enabled.checked    = data.aikwau_l2_enabled          !== false;
    setL2ScaleUI(scale);
    setThemeUI(theme);
  }
);
```

with:

```js
chrome.storage.local.get(
  ['aikwau_gaze_mode', 'aikwau_cal_points',
   'aikwau_webcam_panel_visible', 'aikwau_gaze_ring_visible',
   'aikwau_l2_enabled', 'aikwau_l2_scale', 'aikwau_hc_theme',
   'aikwau_bold_enabled', 'aikwau_contrast_enabled', 'aikwau_summary_enabled'],
  (data) => {
    const mode  = data.aikwau_gaze_mode ?? 'mouse';
    const pts   = data.aikwau_cal_points ?? 25;
    const scale = data.aikwau_l2_scale ?? 1.2;
    const theme = data.aikwau_hc_theme ?? 'nightsky';
    document.querySelector(`input[value="${mode}"]`).checked = true;
    setWebcamExtras(mode === 'webcam');
    setCalPtsUI(pts);
    panelVisible.checked    = data.aikwau_webcam_panel_visible !== false;
    ringVisible.checked     = data.aikwau_gaze_ring_visible    !== false;
    boldEnabled.checked     = data.aikwau_bold_enabled         !== false;
    l2Enabled.checked       = data.aikwau_l2_enabled           !== false;
    setL2RowDisabled(!l2Enabled.checked);
    setL2ScaleUI(scale);
    contrastEnabled.checked = data.aikwau_contrast_enabled     !== false;
    summaryEnabled.checked  = data.aikwau_summary_enabled      !== false;
    setThemeUI(theme);
  }
);
```

- [ ] **Step 6: Add change listeners for the three new checkboxes, and grey out the slider row on L2 toggle**

Replace:

```js
l2Enabled.addEventListener('change', () => {
  const enabled = l2Enabled.checked;
  chrome.storage.local.set({ aikwau_l2_enabled: enabled });
  sendToTab({ type: 'gaze:l2-toggle', enabled });
});
```

with:

```js
boldEnabled.addEventListener('change', () => {
  const enabled = boldEnabled.checked;
  chrome.storage.local.set({ aikwau_bold_enabled: enabled });
  sendToTab({ type: 'gaze:bold-toggle', enabled });
});

l2Enabled.addEventListener('change', () => {
  const enabled = l2Enabled.checked;
  chrome.storage.local.set({ aikwau_l2_enabled: enabled });
  setL2RowDisabled(!enabled);
  sendToTab({ type: 'gaze:l2-toggle', enabled });
});

contrastEnabled.addEventListener('change', () => {
  const enabled = contrastEnabled.checked;
  chrome.storage.local.set({ aikwau_contrast_enabled: enabled });
  sendToTab({ type: 'gaze:contrast-toggle', enabled });
});

summaryEnabled.addEventListener('change', () => {
  const enabled = summaryEnabled.checked;
  chrome.storage.local.set({ aikwau_summary_enabled: enabled });
  sendToTab({ type: 'gaze:summary-toggle', enabled });
});
```

- [ ] **Step 7: Manually verify the popup UI**

Reload the extension in Edge, open the popup. Expected:
- Four checkboxes appear in order: 文字加粗, 字型放大, 加強對比, 段落摘要 — all checked by default
- Unchecking 字型放大 visibly greys out the slider row beneath it and the slider stops responding to drag; rechecking restores it
- Reopening the popup after closing it preserves all four checkbox states (persisted via storage)

- [ ] **Step 8: Commit**

```bash
git add poc/extension/popup.html poc/extension/popup.js
git commit -m "$(cat <<'EOF'
Add independent checkboxes for bold/enlarge/contrast/summary in popup

Replaces the single L2-only reading-enhancement control with four
checkboxes (文字加粗/字型放大/加強對比/段落摘要), each writing its own
storage key and sending its own gaze:*-toggle message to content.js.
The enlarge scale slider greys out when 字型放大 is unchecked.
EOF
)"
```

---

## Task 4: End-to-end manual verification across all four toggles

**Files:** none (verification only, per the spec's Testing Plan section)

**Interfaces:**
- Consumes: the fully wired extension from Tasks 1–3
- Produces: nothing — this task's output is a pass/fail confirmation of the scenarios below

- [ ] **Step 1: Baseline — all four toggles on (default)**

Reload the extension, open a test article in mouse mode with all four popup checkboxes checked (default state). Hover a paragraph 2 seconds.

Expected: identical to pre-refactor `main` branch behavior — paragraph goes bold + recoloured (per active HC theme) + enlarged, then gets a themed outline + "點擊摘要" tag; clicking swaps in the summary.

- [ ] **Step 2: 文字加粗 off only**

In the popup, uncheck 文字加粗 only. Hover a **new** paragraph (not one already triggered).

Expected: paragraph enlarges, recolours, and gets a summary outline/tag — but stays normal font-weight (not bold).

- [ ] **Step 3: 加強對比 off only**

Re-check 文字加粗, uncheck 加強對比 only. Hover a new paragraph.

Expected: paragraph goes bold + enlarges + gets a summary outline/tag, but keeps the page's original background/text colour (no recolour). Switch HC theme buttons in the popup — confirm the summary outline colour still changes live even though Contrast is off (theme picker stays global).

- [ ] **Step 4: 段落摘要 off only**

Re-check 加強對比, uncheck 段落摘要 only. Hover a new paragraph.

Expected: paragraph goes bold + recoloured + enlarged, but never gets an outline, a "點擊摘要" tag, or becomes clickable.

- [ ] **Step 5: 字型放大 off — slider disabled**

Re-check 段落摘要, uncheck 字型放大. Confirm the scale slider row is visibly greyed out and unresponsive. Hover a new paragraph.

Expected: paragraph goes bold + recoloured + gets a summary outline/tag, but does not enlarge.

- [ ] **Step 6: No retroactive effect on already-triggered paragraphs**

With all four toggles back on, hover a paragraph so it's fully triggered (bold/recoloured/enlarged/summarized). Without navigating away, open the popup and uncheck 加強對比. Look at the already-triggered paragraph on the page.

Expected: the already-triggered paragraph is unchanged (still recoloured) — only a newly-gazed paragraph after this point would skip the contrast effect. Confirm by hovering a different, not-yet-triggered paragraph and seeing it come up without recolour.

- [ ] **Step 7: Confirm no regressions in unrelated features**

Quickly re-check: SPA navigation still clears all summary state and highlight state (navigate within a test SPA page if available, or skip if none is set up); blind-spot highlight/hint colours still follow the HC theme; webcam mode still loads without console errors (switch mode in popup, reload page, confirm calibration UI appears).

- [ ] **Step 8: Record verification result**

No commit needed for this task (verification only). If any scenario fails, return to the relevant task (1–3), fix, and re-run Steps 1–7 of this task before considering the feature done.
