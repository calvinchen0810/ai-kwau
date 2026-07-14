# High Contrast Theme — Design Spec

## Goal

Add a High Contrast (HC) visual mode to the AI Kwau Edge extension so the L1
gaze-attention effect, the summary ready/shown states, and the blind-spot
highlight system all use one of four high-contrast colour palettes instead of
the current subdued/translucent styling. Replaces the existing user-customizable
colour pickers with a fixed set of themed presets.

## Background

Current L1 effect is bold + darkened text only. Summary ready/shown states use
a semi-transparent background (yellow/green), user-customizable via colour
pickers in the popup. This spec adds an HC layer on top of/replacing those
defaults, selectable per-theme from the popup, with themed colours also
applied to the existing blind-spot highlight (`.aikwau-highlight` /
`.aikwau-hint`) system.

## Storage / Data Model

- **New key**: `aikwau_hc_theme` — one of `'off' | 'aquatic' | 'desert' | 'dusk' | 'nightsky'`.
  - Unset (fresh install) is treated as `'nightsky'` (default theme, not `'off'`).
- **Removed keys**: `aikwau_color_ready`, `aikwau_color_shown` (old picker
  colours) — no longer needed since colours become fixed per-theme presets.

## Theme Palette Table

`off` is treated as a fifth "theme" — it keeps today's L1 look (bold + darkened
text, no background) but switches the summary states from translucent
background to outline-only, using the current default gold/green colours.
This keeps a single visual system (outline-based summary states) across all
five theme values instead of maintaining two parallel implementations.

| Theme | L1 background / text | Summary "ready" outline | Summary "shown" outline | Blind-spot accent |
|---|---|---|---|---|
| off (default look) | current bold+dark, no background | 2px `#ffee00` | 3px `#00cc77` + glow | `#ffee00` (gold, unchanged) |
| aquatic | `#003044` bg / `#eaffff` text | 2px `#00c2e0` | 3px `#00e5ff` + glow | `#00e5ff` |
| desert | `#2b1400` bg / `#fff2d9` text | 2px `#d68a2e` | 3px `#ffb020` + glow | `#ffb020` |
| dusk | `#2a0a3d` bg / `#f5e6ff` text | 2px `#d64fc0` | 3px `#ff4fd8` + glow | `#ff4fd8` |
| nightsky (default) | `#05060f` bg / `#f0f4ff` text | 2px `#3a8fd6` | 3px `#4fc3ff` + glow | `#4fc3ff` |

"Ready" vs "shown" within a theme are distinguished by outline weight (2px vs
3px) plus a glow (`box-shadow`) on the "shown" state, so both states remain
distinguishable even though they share the same hue family.

## Architecture Decision

**Static CSS + `data-` attribute**, following the existing `mode_bridge.js` /
`data-aikwau-mode` precedent — not a JS-generated `<style>` injection (the
pattern `applyHighlightColors()` used previously).

- `mode_bridge.js` (isolated world, `document_start`) additionally reads
  `aikwau_hc_theme` from `chrome.storage.local` and sets
  `document.documentElement.setAttribute('data-aikwau-hc-theme', theme || 'off')`.
  It listens for storage changes and updates the attribute live, same as the
  existing gaze-mode attribute.
- `content.css` defines fixed rule blocks per theme, e.g.:
  ```css
  [data-aikwau-hc-theme="aquatic"] .aikwau-l1 { background:#003044; color:#eaffff; }
  [data-aikwau-hc-theme="aquatic"] .aikwau-summary-ready { background:none; border:2px solid #00c2e0; }
  [data-aikwau-hc-theme="aquatic"] .aikwau-summary-shown { background:none; border:3px solid #00e5ff; box-shadow:0 0 6px #00e5ff; }
  [data-aikwau-hc-theme="aquatic"] .aikwau-highlight { outline-color:#00e5ff; }
  [data-aikwau-hc-theme="aquatic"] .aikwau-hint-icon { background:#00e5ff; }
  ```
  Repeated for `desert`, `dusk`, `nightsky`. There is no dedicated
  `[data-aikwau-hc-theme="off"]` block — the base (unattributed)
  `.aikwau-l1` / `.aikwau-summary-ready` / `.aikwau-summary-shown` /
  `.aikwau-highlight` / `.aikwau-hint-icon` rules in `content.css` are
  updated to be the "off" appearance (current bold+dark L1, gold/green
  outline-only summary states). Since attribute selectors only match their
  specific value, an `off` (or missing) attribute simply leaves these base
  rules in effect.

This was chosen over continuing the dynamic `<style>`-injection pattern
because the colour pickers are being removed — palettes are now fixed presets,
so there's no runtime customization to justify generated CSS. It also matches
an existing precedent in the codebase (`data-aikwau-mode`).

## Component Changes

### `mode_bridge.js`
- Read `aikwau_hc_theme` alongside the existing `aikwau_gaze_mode` read.
- Set `data-aikwau-hc-theme` attribute on `document.documentElement`.
- Extend the existing storage-change listener to also react to
  `aikwau_hc_theme` changes.

### `content.css`
- Add the five `[data-aikwau-hc-theme="..."]` rule blocks described above.
- Remove reliance on the injected `<style id="__aikwau_colors">` block —
  summary-ready/shown colours are now fully static, theme-driven.

### `content.js`
- Delete `applyHighlightColors()` and `hexToRgba()`.
- Delete the read of `aikwau_color_ready` / `aikwau_color_shown` at init.
- No change to the class-toggling logic itself
  (`.aikwau-summary-ready` / `.aikwau-summary-shown` / `.aikwau-highlight` /
  `.aikwau-hint`) — only the CSS backing those classes changes.

### `popup.html` / `popup.js`
- Remove the two `<input type="color">` pickers and their swatch previews.
- Add a 5-button theme selector (Aquatic / Desert / Dusk / Night Sky / 關閉),
  writing the chosen value to `aikwau_hc_theme` and visually indicating the
  active selection.

## Removed Functionality

- Popup colour pickers for summary ready/shown colours (and their storage
  keys `aikwau_color_ready` / `aikwau_color_shown`).
- `content.js`: `applyHighlightColors()`, `hexToRgba()`.
- The translucent-background summary style is fully replaced by the
  outline-only style (applies even when HC is `off`).

## Manual Test Plan

(This PoC project has no automated test suite; verification is manual per
existing CLAUDE.md conventions.)

1. In the popup, select each of the 5 theme options (including 關閉) and
   confirm on a live page that L1 background/text, summary ready/shown
   outlines, and blind-spot highlight/hint colours all update immediately to
   match the chosen theme.
2. Clear extension storage (simulate fresh install) and confirm the page
   defaults to the Night Sky theme, not `off`.
3. Trigger an SPA navigation (`pushState`) while a theme is active and confirm
   the theme attribute/styling is unaffected by the existing
   `clearAllSummaryEls()` / `_clearOnNavigate()` cleanup (since colours are no
   longer JS-injected style, only class toggles remain).
4. Confirm the popup no longer references the removed colour-picker elements
   or storage keys (no dead code, no broken UI elements).

## Out of Scope

- L2 (font enlargement) is unaffected — it remains an orthogonal font-size
  toggle independent of HC theme colours.
- No changes to the Native Messaging / summarization pipeline.
