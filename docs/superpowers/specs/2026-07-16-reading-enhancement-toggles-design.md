# Reading Enhancement Toggles — Design

Date: 2026-07-16
Status: Approved by user, pending implementation

## Goal

Currently the "閱讀增強" (reading enhancement) popup section only exposes one
independent toggle (放大/L2 font enlargement). Bold text, contrast
recolouring, and summary fetching are either always-on or bundled together
inside a single `triggerL1()` call and a single `.aikwau-l1` CSS class. This
design splits all four effects into fully independent, user-toggleable
features:

1. **文字加粗** (Bold) — font-weight only
2. **字型放大** (Enlarge) — existing L2, unchanged behavior
3. **加強對比** (Contrast) — background/text recolouring, themed
4. **段落摘要** (Summary) — AI summary fetch + click-to-toggle UI

Each toggle can be enabled/disabled independently of the others. All four
default to `true` (on) so existing behavior is unchanged until a user
explicitly turns something off.

## Non-goals

- The High Contrast theme picker (off/aquatic/desert/dusk/nightsky) is
  **not** gated by the Contrast toggle. It remains a global palette setting
  that also colours the summary outline/tag and blind-spot hint regardless
  of whether Contrast is on. Turning Contrast off only stops the
  background/text recolour from being applied to newly-triggered
  paragraphs; the theme selector itself stays fully interactive.
- Toggling any of the four switches does **not** retroactively strip or
  reapply effects on paragraphs already marked by a prior gaze trigger —
  it only changes behavior for elements triggered from that point forward.
  This mirrors the existing `l2Enabled` behavior.
- No new "trigger" mechanism — all four effects continue to be evaluated
  inside the existing `triggerL1(el, text)` gaze-focus handler.

## Storage keys

| Key | Feature | Default when absent |
|---|---|---|
| `aikwau_bold_enabled` | 文字加粗 | `true` |
| `aikwau_l2_enabled` | 字型放大 (existing key, unchanged) | `true` |
| `aikwau_contrast_enabled` | 加強對比 | `true` |
| `aikwau_summary_enabled` | 段落摘要 | `true` |

All read with the existing `data.aikwau_x_enabled !== false` pattern (so a
missing key means "on").

## `content.css` changes

Split `.aikwau-l1` into two independent classes:

```css
/* 文字加粗：只管字重，不改顏色 */
.aikwau-bold {
  font-weight: 700 !important;
  letter-spacing: 0.15px;
  transition: font-weight 0.3s ease, font-size 0.25s ease;
}

/* 加強對比：只管背景/文字色（含 HC 主題 override）*/
.aikwau-contrast {
  color: #080808 !important;
  transition: color 0.3s ease, background-color 0.3s ease;
}
.aikwau-contrast a,
.aikwau-contrast a:visited {
  color: #ffee00 !important;
  text-decoration: underline !important;
}
```

In the five `[data-aikwau-hc-theme="..."]` theme blocks, every selector that
currently targets `.aikwau-l1` (background-color/color override) and
`.aikwau-l1 a` / `.aikwau-l1 a:visited` (link colour override) is renamed to
target `.aikwau-contrast` / `.aikwau-contrast a` / `.aikwau-contrast a:visited`
instead. The `.aikwau-summary-ready`, `.aikwau-summary-shown`,
`.aikwau-summary-label`, `.aikwau-highlight`, `.aikwau-hint-icon` theme rules
are untouched (still theme-global, independent of Contrast).

`.aikwau-l2` is unchanged.

## `content.js` changes

- New module state, initialized from storage at startup (same block that
  currently reads `aikwau_l2_enabled`):
  ```js
  let boldEnabled     = true;
  let contrastEnabled = true;
  let summaryEnabled  = true;
  ```
- New runtime message handlers (mirroring the existing `gaze:l2-toggle`):
  ```js
  if (msg.type === 'gaze:bold-toggle')     { boldEnabled = msg.enabled; }
  if (msg.type === 'gaze:contrast-toggle') { contrastEnabled = msg.enabled; }
  if (msg.type === 'gaze:summary-toggle')  { summaryEnabled = msg.enabled; }
  ```
- `triggerL1(el, text)` body updated to gate each effect independently:
  ```js
  function triggerL1(el, text) {
    if (el === activeEl) return;
    cleanup();
    activeEl = el;

    if (boldEnabled) el.classList.add('aikwau-bold');
    if (contrastEnabled) el.classList.add('aikwau-contrast');

    if (l2Enabled) {
      // ...existing L2 sizing logic, unchanged...
    }

    if (!summaryEnabled) return;

    // ...existing summary cache-check + chrome.runtime.sendMessage logic, unchanged...
  }
  ```
  When `summaryEnabled` is `false`, the function returns right after
  bold/contrast/enlarge are applied — no summary fetch, no
  `.aikwau-summary-ready` outline, no tag label, no click handler.
- `clearAllSummaryEls()` (SPA-navigation cleanup): the
  `el.classList.remove('aikwau-summary-ready', 'aikwau-summary-shown', 'aikwau-l1', 'aikwau-l2')`
  call updates its class list to remove `'aikwau-bold'` and
  `'aikwau-contrast'` in place of `'aikwau-l1'`.

## `popup.html` / `popup.js` changes

The "閱讀增強" section becomes four independent rows, in this order:

```
閱讀增強
☑ 文字加粗
☑ 字型放大
   [====slider====] 1.2×      (greyed out / disabled when 字型放大 is off)
☑ 加強對比
☑ 段落摘要

High Contrast 主題              (unchanged, unmoved)
[關閉] [水域] [沙漠] [黃昏] [夜空]
```

- Three new checkboxes (`#boldEnabled`, `#contrastEnabled`,
  `#summaryEnabled`) added to `popup.html`, styled with the existing
  `.feat-sect label` rules — no new CSS needed beyond what already styles
  the L2 checkbox.
- `popup.js`: each new checkbox reads its storage key on load, and on
  `change` writes storage + calls `sendToTab({ type: 'gaze:<name>-toggle', enabled })`,
  exactly mirroring the existing `l2Enabled` listener.
- **Slider disable behavior (new)**: the `#l2Scale` range input and its
  `#l2ScaleLabel` row get a `disabled` state toggled alongside
  `l2Enabled`'s checkbox state — both on initial load (`setL2ScaleUI`/init
  block) and inside the `l2Enabled` change listener. Disabling uses the
  native `disabled` attribute on the `<input type="range">` plus a CSS rule
  (`.l2-scale-row.disabled { opacity: 0.45; pointer-events: none; }`) applied
  to the row wrapper so the numeric label greys out too, not just the
  slider track.

## Edge cases

- All four toggles off: gazing at a paragraph does nothing visible at all
  (no bold, no colour change, no enlarge, no summary). This is intentional
  — full decoupling means "nothing enabled" is a valid, if unusual, state.
- A paragraph already showing a summary when the user turns Summary off:
  stays exactly as-is (still clickable, still toggleable) until SPA
  navigation clears it — per the "no retroactive effect" rule.
- Contrast off + a non-"off" HC theme selected: paragraphs get bold (if
  enabled) and enlarge (if enabled) but keep the page's original
  background/text colour; the summary outline/tag and blind-spot hints
  still render in the selected theme's colours, since those are unaffected
  by the Contrast toggle.

## Testing plan

Manual verification in Edge (per CLAUDE.md's existing mouse-mode flow):

1. All four toggles on (default) — confirm behavior identical to current
   `main` branch (bold + dark/themed background + enlarge + clickable
   summary all appear together on gaze).
2. Turn off 文字加粗 only — gazed paragraph enlarges/recolours/summarizes
   but stays normal weight.
3. Turn off 加強對比 only — paragraph goes bold + enlarges + summarizes but
   keeps original page colours; HC theme buttons still visibly change
   summary outline colour.
4. Turn off 段落摘要 only — paragraph goes bold/recoloured/enlarged but no
   outline, no tag, no click-to-reveal.
5. Turn off 字型放大 — confirm slider row visibly greys out and stops
   responding to drag.
6. Toggle any switch mid-session with an already-triggered paragraph on
   screen — confirm that paragraph's existing effects do **not** change
   until a different paragraph is gazed.
