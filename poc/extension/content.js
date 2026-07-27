/**
 * AI Kwau — Content Script (isolated world)
 *
 * Handles both modes:
 *  Mouse mode — listens to aikwau:gazefocus / aikwau:gazeblur from MAIN world
 *  Webcam mode — starts offscreen MediaPipe tracker, runs calibration UI,
 *                receives gaze:point messages from background.js
 */

if (window.__aikwauContentLoaded) throw new Error('content.js skipped (already loaded)');
window.__aikwauContentLoaded = true;

(() => {
  const MIN_TEXT_LEN = 40;
  const SUMMARY_MAX_CHARS = 220;
  const SELECTORS = 'p, h1, h2, h3, h4, li, blockquote, td, figcaption';

  let activeEl          = null;
  let activeBadge       = null;
  let lastMouseX        = 0, lastMouseY = 0;
  let masterEnabled     = true;   // Global kill switch for the whole feature
  let boldEnabled       = true;   // Bold font-weight
  let contrastEnabled   = true;   // Background/text colour recolour
  let l2Enabled         = true;   // L2 font enlargement
  let l2Scale           = 1.2;    // L2 enlargement multiplier (popup slider)
  let summaryEnabled    = true;   // Summary fetch + click-to-toggle
  let cursorRingEnabled = false;  // Mode-independent real-mouse-pointer ring
  let cursorRing        = null;
  let blindSpotVisible  = true;   // Display-only: scanBlindButtons() keeps running when false
  let uiLang            = 'zh';   // On-page dynamic UI language, mirrors the popup's toggle
  function t(key, vars) { return AIKWAU_I18N.t(key, uiLang, vars); }
  let badgeTimer        = null;
  const summaryCache    = new Map(); // text-key → cached summary string
  // summaryReadyEls: el → { summary, origText, handler, shown, labelEl }
  // Persists across gaze events — cleared only on SPA navigation
  const summaryReadyEls = new Map();
  let isWebcamMode = false;
  document.addEventListener('mousemove', e => {
    lastMouseX = e.clientX; lastMouseY = e.clientY;
    moveCursorRing(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('mouseleave', () => { if (cursorRing) cursorRing.style.display = 'none'; });

  // ── Gaze heatmap accumulator ──────────────────────────────────────────────
  const HM_W = 24, HM_H = 14;
  let hmCells     = new Array(HM_W * HM_H).fill(0);
  let hmDirty     = false;
  let hmSaveTimer = null;
  let lastHmTime  = 0;

  chrome.storage.local.get('aikwau_heatmap', ({ aikwau_heatmap: d }) => {
    if (Array.isArray(d?.cells) && d.cells.length === HM_W * HM_H) {
      hmCells = d.cells.slice();
    }
  });

  function hmAccumulate(vx, vy) {
    const now = Date.now();
    if (now - lastHmTime < 200) return;
    lastHmTime = now;
    const col = Math.floor(vx / window.innerWidth  * HM_W);
    const row = Math.floor(vy / window.innerHeight * HM_H);
    if (col < 0 || col >= HM_W || row < 0 || row >= HM_H) return;
    hmCells[row * HM_W + col] += 1;
    hmDirty = true;
    if (!hmSaveTimer) hmSaveTimer = setTimeout(hmSave, 5000);
  }

  function hmSave() {
    hmSaveTimer = null;
    if (!hmDirty) return;
    hmDirty = false;
    chrome.storage.local.set({
      aikwau_heatmap: {
        cells:       hmCells.slice(),
        totalPoints: hmCells.reduce((a, b) => a + b, 0),
        lastUpdated: Date.now(),
      }
    });
    scanBlindButtons();
    dispatchHeatmapData();
  }

  // Bridges hmCells to gaze_webcam.js (MAIN world, no chrome.storage access —
  // same reason calibration data is bridged via aikwau:requestCalibration).
  // Pushed on every hmSave() (~5s cadence) and once on request, so the panel
  // gets an immediate snapshot even before the next accumulation cycle.
  function dispatchHeatmapData() {
    document.dispatchEvent(new CustomEvent('aikwau:heatmapData', {
      detail: {
        cells:       hmCells.slice(),
        totalPoints: hmCells.reduce((a, b) => a + b, 0),
        lastUpdated: Date.now(),
      },
    }));
  }
  document.addEventListener('aikwau:requestHeatmap', dispatchHeatmapData);

  window.addEventListener('beforeunload', hmSave);
  window.addEventListener('scroll', repositionAllHints, { passive: true });
  window.addEventListener('resize', repositionAllHints, { passive: true });
  window.addEventListener('resize', repositionAllSummaryLabels, { passive: true });

  // ── Blind-area button scanner ─────────────────────────────────────────────
  // DEMO SCOPE (temporary, 2026-07-27): hyperlink text ('a[href]', '[role="link"]')
  // is excluded from blind-spot reminders for demo video recording — buttons only.
  // Re-add those two selectors to restore link reminders.
  const INTERACTIVE_SEL = [
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]',
  ].join(', ');

  const MIN_HM_POINTS  = 50;  // need this many gaze samples before scanning
  const MAX_HIGHLIGHTS = 4;   // max highlighted elements at once

  let highlightTargets = [];  // [{el, hintEl}]

  function coldCells() {
    const total = hmCells.reduce((a, b) => a + b, 0);
    if (total < MIN_HM_POINTS) return new Set();
    const cold = new Set();
    for (let r = 0; r < HM_H; r++) {
      for (let c = 0; c < HM_W; c++) {
        if (hmCells[r * HM_W + c] > 0) continue;   // has data → not cold
        // Only flag if surrounded by ≥3 active cells (avoids flagging unscrolled regions)
        let nbActive = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < HM_H && nc >= 0 && nc < HM_W && hmCells[nr * HM_W + nc] > 0) nbActive++;
          }
        }
        if (nbActive >= 3) cold.add(r * HM_W + c);
      }
    }
    return cold;
  }

  function scanBlindButtons() {
    const total = hmCells.reduce((a, b) => a + b, 0);
    if (total < MIN_HM_POINTS) return;

    const cold = coldCells();
    if (cold.size === 0) return;

    // Already at cap — nothing to add
    if (highlightTargets.length >= MAX_HIGHLIGHTS) return;

    const vw = window.innerWidth, vh = window.innerHeight;
    const alreadyHighlighted = new Set(highlightTargets.map(h => h.el));
    const found = [];

    for (const rawEl of document.querySelectorAll(INTERACTIVE_SEL)) {
      let el = rawEl;
      let rect = el.getBoundingClientRect();
      if (isVisuallyHidden(el) || rect.width === 0 || rect.height === 0) {
        // Common "checkbox/radio hack" fake-button pattern (e.g. Wikipedia's
        // table-of-contents toggle): the real form control matching
        // INTERACTIVE_SEL is invisible and a <label for="..."> renders the
        // visible fake button the user actually sees — redirect there instead
        // of dropping the candidate.
        const lbl = visibleLabelFor(el);
        if (!lbl) continue;
        el = lbl;
        rect = el.getBoundingClientRect();
        if (isVisuallyHidden(el) || rect.width === 0 || rect.height === 0) continue;
      }
      if (alreadyHighlighted.has(el)) continue;
      if (el.id?.startsWith('__aikwau') || el.id?.startsWith('__ap')) continue;
      if (el.closest('[id^="__aikwau"]') || el.closest('[id^="__ap"]')) continue;
      if (isL1Emphasized(el)) continue;
      if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) continue;

      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      const col = Math.floor(cx / vw * HM_W);
      const row = Math.floor(cy / vh * HM_H);
      if (col < 0 || col >= HM_W || row < 0 || row >= HM_H) continue;

      if (cold.has(row * HM_W + col)) {
        found.push({ el, cx, cy, dist: Math.hypot(cx - vw / 2, cy - vh / 2) });
      }
    }

    found.sort((a, b) => b.dist - a.dist);
    updateHighlights(found.slice(0, MAX_HIGHLIGHTS - highlightTargets.length));

    document.dispatchEvent(new CustomEvent('aikwau:demo-ready',
      { detail: { count: highlightTargets.length } }));
  }

  // Returns fractional heatmap grid coords for the weighted gaze centroid.
  function gazeCenter() {
    const total = hmCells.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    let wx = 0, wy = 0;
    for (let r = 0; r < HM_H; r++)
      for (let c = 0; c < HM_W; c++) {
        const v = hmCells[r * HM_W + c];
        wx += c * v; wy += r * v;
      }
    return { col: wx / total, row: wy / total };
  }

  // Place hintEl adjacent to rect on the given side, clamped to viewport.
  function positionHint(hintEl, rect, side) {
    const PAD = 6;
    const vw = window.innerWidth, vh = window.innerHeight;
    const hw = hintEl.offsetWidth  || 180;
    const hh = hintEl.offsetHeight || 32;
    let top, left;
    switch (side) {
      case 'left':   left = rect.left - hw - PAD;               top = rect.top + rect.height / 2 - hh / 2; break;
      case 'right':  left = rect.right + PAD;                   top = rect.top + rect.height / 2 - hh / 2; break;
      case 'top':    left = rect.left + rect.width / 2 - hw / 2; top = rect.top - hh - PAD;                break;
      case 'bottom': left = rect.left + rect.width / 2 - hw / 2; top = rect.bottom + PAD;                  break;
    }
    hintEl.style.left = `${Math.max(PAD, Math.min(vw - hw - PAD, left))}px`;
    hintEl.style.top  = `${Math.max(PAD, Math.min(vh - hh - PAD, top))}px`;
  }

  // Reposition all hint tooltips after scroll / resize; hide hints for off-screen elements.
  function repositionAllHints() {
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const { el, hintEl } of highlightTargets) {
      const rect = el.getBoundingClientRect();
      const inView = rect.width > 0 && rect.height > 0 &&
                     rect.bottom > 0 && rect.top < vh &&
                     rect.right > 0 && rect.left < vw;
      if (inView) {
        hintEl.style.display = '';
        positionHint(hintEl, rect, hintEl.dataset.side);
      } else {
        hintEl.style.display = 'none';
      }
    }
  }

  // Add gold border + floating hint tooltip to each newly discovered cold-zone element.
  // Existing highlights are never removed by the scanner — only by clearAllHighlights().
  function updateHighlights(list) {
    const existingEls = new Set(highlightTargets.map(h => h.el));
    const gc = gazeCenter();
    const vw = window.innerWidth, vh = window.innerHeight;

    for (const { el, cx, cy } of list) {
      if (existingEls.has(el)) continue;

      el.classList.add('aikwau-highlight');

      // Determine which side of the element faces the gaze centroid (hot zone).
      // The hint appears on that side so the user encounters it naturally.
      let side = 'top';
      if (gc) {
        const gazePxX = (gc.col + 0.5) / HM_W * vw;
        const gazePxY = (gc.row + 0.5) / HM_H * vh;
        const dx = gazePxX - cx, dy = gazePxY - cy;
        side = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'bottom' : 'top');
      }

      // Arrow on hint points toward the element (opposite of hint side).
      const towardEl = { left: '▶', right: '◀', top: '▼', bottom: '▲' }[side];

      const hintEl = document.createElement('div');
      hintEl.className = 'aikwau-hint';
      hintEl.dataset.side = side;
      hintEl.innerHTML =
        `<span class="aikwau-hint-icon">!</span>` +
        `<span class="aikwau-hint-arrow">${towardEl}</span>`;

      document.body.appendChild(hintEl);
      positionHint(hintEl, el.getBoundingClientRect(), side);

      hintEl.addEventListener('click', () => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus?.();
      });

      highlightTargets.push({ el, hintEl });
    }
  }

  // Remove all highlight borders and hint tooltips. Called on manual clear or SPA nav.
  function clearAllHighlights() {
    for (const { el, hintEl } of highlightTargets) {
      el.classList.remove('aikwau-highlight');
      hintEl.remove();
    }
    highlightTargets = [];
  }

  // True if el (or an ancestor) already carries L1 text emphasis. Blind-spot
  // highlighting is skipped/withdrawn for these elements — L1 emphasis persists
  // once gaze-triggered, so a link inside it shouldn't also carry the separate
  // blind-spot outline + hint (the two signals stacked look like visual noise).
  function isL1Emphasized(el) {
    return !!el.closest('.aikwau-bold, .aikwau-contrast');
  }

  // True if el is genuinely invisible to the user — display:none, visibility:hidden,
  // or opacity:0, whether set on el itself or an ancestor (e.g. a closed mobile-nav
  // panel). getBoundingClientRect()'s width/height===0 check only catches display:none;
  // visibility/opacity-hidden elements still occupy layout space with a non-zero rect,
  // so without this they'd still get flagged as blind-spot targets a user can't see.
  // checkVisibility() is Chromium 105+ (Edge, our only target); the getComputedStyle
  // fallback only sees el's own style, not an ancestor's.
  function isVisuallyHidden(el) {
    if (typeof el.checkVisibility === 'function') {
      return !el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    const cs = getComputedStyle(el);
    return cs.visibility === 'hidden' || cs.opacity === '0';
  }

  // Returns the <label for="el.id">, if any — the visible half of the
  // "checkbox/radio hack" fake-button pattern where el itself (an <input>
  // matching INTERACTIVE_SEL) is the invisible/zero-size real control.
  function visibleLabelFor(el) {
    return el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  }

  // Withdraw blind-spot highlight/hint for any tracked target now inside (or
  // equal to) root. Called right after L1 emphasis is applied to root, since
  // L1 never gets removed on its own — without this, a target flagged before
  // its paragraph was gazed would keep the highlight indefinitely.
  function removeHighlightsWithin(root) {
    highlightTargets = highlightTargets.filter(({ el, hintEl }) => {
      if (root === el || root.contains(el)) {
        el.classList.remove('aikwau-highlight');
        hintEl.remove();
        return false;
      }
      return true;
    });
  }

  // Display-only toggle: scanBlindButtons()/updateHighlights() keep tracking
  // targets in highlightTargets regardless — this just hides the rendering.
  function applyBlindSpotVisibility() {
    document.body.classList.toggle('aikwau-blindspot-hidden', !blindSpotVisible);
  }

  // ── Demo page bridge ──────────────────────────────────────────────────────
  document.addEventListener('aikwau:demo-populate', () => {
    // Gaussian gaze centered on reading area (roughly top-center of main content)
    const rCx = HM_W * 0.45, rCy = HM_H * 0.45;
    for (let r = 0; r < HM_H; r++) {
      for (let c = 0; c < HM_W; c++) {
        const d2 = (c - rCx) ** 2 / 12 + (r - rCy) ** 2 / 6;
        hmCells[r * HM_W + c] = Math.max(0, Math.round(280 * Math.exp(-d2)));
      }
    }
    hmDirty = true;
    hmSave();
  });

  document.addEventListener('aikwau:demo-clear', () => {
    hmCells.fill(0);
    hmDirty = false;
    chrome.storage.local.remove('aikwau_heatmap');
    clearAllHighlights();
  });

  // ── SPA navigation: clear summaries on pushState / popstate ─────────────
  const _clearOnNavigate = () => {
    clearAllSummaryEls();
    clearAllHighlights();
    cleanup();
  };
  window.addEventListener('popstate', _clearOnNavigate);
  ['pushState', 'replaceState'].forEach(m => {
    const orig = history[m].bind(history);
    history[m] = function(...args) { orig(...args); _clearOnNavigate(); };
  });

  // ── Mode + feature-flag init ──────────────────────────────────────────────
  chrome.storage.local.get(
    ['aikwau_gaze_mode', 'aikwau_l2_enabled', 'aikwau_l2_scale',
     'aikwau_bold_enabled', 'aikwau_contrast_enabled', 'aikwau_summary_enabled',
     'aikwau_master_enabled', 'aikwau_cursor_ring_enabled', 'aikwau_blindspot_visible',
     'aikwau_ui_lang'],
    (data) => {
      masterEnabled     = data.aikwau_master_enabled !== false;
      l2Enabled         = data.aikwau_l2_enabled !== false;
      l2Scale           = data.aikwau_l2_scale ?? 1.2;
      boldEnabled       = data.aikwau_bold_enabled !== false;
      contrastEnabled   = data.aikwau_contrast_enabled !== false;
      summaryEnabled    = data.aikwau_summary_enabled !== false;
      cursorRingEnabled = data.aikwau_cursor_ring_enabled === true;
      blindSpotVisible  = data.aikwau_blindspot_visible !== false;
      applyBlindSpotVisibility();
      uiLang            = data.aikwau_ui_lang ?? 'zh';
      isWebcamMode      = (data.aikwau_gaze_mode ?? 'mouse') === 'webcam';
      if (isWebcamMode) initWebcam();
    }
  );

  // Re-applies the current l2Scale to every element already showing .aikwau-l2,
  // so dragging the popup slider resizes on-page text live, no re-gaze needed.
  function reapplyL2Scale() {
    document.querySelectorAll('.aikwau-l2').forEach(el => {
      const base = +el.dataset.aikwauBase;
      if (!isNaN(base)) el.style.setProperty('font-size', `${(base * l2Scale).toFixed(1)}px`, 'important');
    });
  }

  // ── Gaze events from MAIN world (mouse mode: immediate; webcam mode: via dwell) ──
  document.addEventListener('aikwau:gazefocus', (e) => {
    if (!masterEnabled) return;
    const { x, y } = e.detail ?? {};
    if (x == null) return;
    hmAccumulate(x, y);
    if (calDone) {
      // Webcam: raw frames at ~10 fps — route through EMA+dwell+median logic
      onWebcamGazePoint(x, y);
    } else {
      // Mouse: 2s dwell already elapsed in gaze_tracker.js — trigger immediately
      const el = document.elementFromPoint(x, y)?.closest(SELECTORS);
      if (!el) return;
      const text = el.innerText?.trim() ?? '';
      if (text.length < MIN_TEXT_LEN) return;
      triggerL1(el, text);
    }
  });

  document.addEventListener('aikwau:gazeblur', () => cleanup());

  // ══════════════════════════════════════════════════════════════════════════
  // WEBCAM MODE
  // ══════════════════════════════════════════════════════════════════════════

  // ── Gaze state for webcam mode ────────────────────────────────────────────
  const DWELL_MS = 1500;
  const SMOOTH_ALPHA = 0.25;   // responsive EMA — mouse cursor is the reference speed
  const DEAD_ZONE = 15;        // px — absorb small noise without freezing real movement
  const HISTORY_FRAMES = 20;

  let gazeTimer = null;
  let gazeCurrentEl = null;
  let smoothX = null, smoothY = null;
  let ringX = null, ringY = null;  // last committed ring position (dead-zone gated)
  let ringVisible = true;          // controlled by popup toggle
  const gazeYHistory = [];
  let calDone = false;
  let gazeRing = null;

  function initWebcam() {
    console.log('[aikwau/content] initWebcam — sending gaze:start to background');
    chrome.runtime.sendMessage({ type: 'gaze:start' });
    showLoadingOverlay();
    // gaze_webcam.js (MAIN world) dispatches aikwau:gazeready when camera+FaceMesh are up.
    // event.detail.calCount = how many calibration points gaze_webcam.js currently has.
    // On fresh injection this is always 0, so we always show the calibration UI.
    // Bridge: save calibration to storage when gaze_webcam.js has new data
    document.addEventListener('aikwau:saveCalibration', (e) => {
      chrome.storage.local.set({ aikwau_cal_data: e.detail });
    });
    // Bridge: respond to calibration load request from gaze_webcam.js
    document.addEventListener('aikwau:requestCalibration', () => {
      chrome.storage.local.get('aikwau_cal_data', ({ aikwau_cal_data }) => {
        document.dispatchEvent(new CustomEvent('aikwau:loadCalibration',
          { detail: aikwau_cal_data ?? null }));
      });
    });

    document.addEventListener('aikwau:gazeready', (e) => {
      const calCount    = e.detail?.calCount ?? 0;
      const polyReady   = e.detail?.polyCoeffsReady ?? false;
      console.log('[aikwau/content] aikwau:gazeready received, calCount =', calCount, 'polyReady =', polyReady);
      if (polyReady) {
        // Calibration restored from storage — skip calibration UI
        calDone = true;
        if (loadingOverlay) { loadingOverlay.remove(); loadingOverlay = null; }
        ensureGazeRing();
        console.log('[aikwau/content] Calibration restored from storage, skipping UI');
      } else {
        console.log('[aikwau/content] Showing calibration UI');
        chrome.storage.local.get('aikwau_cal_points', ({ aikwau_cal_points }) => {
          const pts    = Number(aikwau_cal_points) || 25;
          const minCal = pts === 9 ? 6 : 12;
          document.dispatchEvent(new CustomEvent('aikwau:setcalpoints', { detail: { minCal } }));
          showCalibrationUI(pts);
        });
      }
      // Apply saved panel + ring visibility preferences
      chrome.storage.local.get(
        ['aikwau_webcam_panel_visible', 'aikwau_gaze_ring_visible'],
        ({ aikwau_webcam_panel_visible, aikwau_gaze_ring_visible }) => {
          document.dispatchEvent(new CustomEvent('aikwau:panel-toggle',
            { detail: { visible: aikwau_webcam_panel_visible !== false } }));
          ringVisible = aikwau_gaze_ring_visible !== false;
        }
      );
    }, { once: true });
    document.addEventListener('aikwau:gazeerror', (e) => {
      console.error('[aikwau/content] aikwau:gazeerror received', e.detail);
      if (loadingOverlay) {
        const msg = loadingOverlay.querySelector('#__aikwau_load_msg');
        if (msg) {
          msg.textContent = t('cameraError', { msg: e.detail?.message });
          msg.style.color = '#f66';
        }
      }
    }, { once: true });
  }

  // ── Zone-based paragraph finder (works in isolated world) ─────────────────
  // Hysteresis: a new candidate must beat the current dwell target by more
  // than this margin before we switch. Without it, noisy webcam gaze near a
  // paragraph boundary — especially next to an already-enlarged (taller)
  // neighbour — flips the target almost every frame, and each flip resets
  // dwellGaze()'s 1.5s timer, so the target in the middle never dwells long
  // enough to fire (root cause of paragraphs never getting enhanced when
  // sandwiched between two already-processed ones).
  const TARGET_HYSTERESIS_PX = 20;
  function findGazeTarget(gazeY, currentEl) {
    const vh = window.innerHeight;
    let best = null, bestDist = Infinity;
    let currentDist = Infinity;
    for (const el of document.querySelectorAll(SELECTORS)) {
      if ((el.innerText?.trim().length ?? 0) < MIN_TEXT_LEN) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || r.height === 0) continue;
      const dist = Math.abs((r.top + r.height / 2) - gazeY);
      if (dist < bestDist) { bestDist = dist; best = el; }
      if (el === currentEl) currentDist = dist;
    }
    if (currentEl && best !== currentEl && currentDist <= bestDist + TARGET_HYSTERESIS_PX) {
      return currentEl;
    }
    return best;
  }

  function onWebcamGazePoint(vx, vy) {
    // EMA smoothing (always update — tracks true signal continuously)
    smoothX = smoothX == null ? vx : SMOOTH_ALPHA * vx + (1 - SMOOTH_ALPHA) * smoothX;
    smoothY = smoothY == null ? vy : SMOOTH_ALPHA * vy + (1 - SMOOTH_ALPHA) * smoothY;

    // Dead zone: only move ring when EMA has drifted far enough from last committed position
    const dist = ringX == null ? Infinity : Math.hypot(smoothX - ringX, smoothY - ringY);
    if (dist >= DEAD_ZONE) { ringX = smoothX; ringY = smoothY; }
    moveGazeRing(ringX, ringY);

    // Rolling median Y for paragraph selection (uses EMA, not dead-zone position)
    gazeYHistory.push(smoothY);
    if (gazeYHistory.length > HISTORY_FRAMES) gazeYHistory.shift();
    const sorted = [...gazeYHistory].sort((a, b) => a - b);
    const medianY = sorted[Math.floor(sorted.length / 2)];

    const el = findGazeTarget(medianY, gazeCurrentEl);
    if (!el) { if (gazeCurrentEl) cancelGaze(); return; }
    if (el !== gazeCurrentEl) dwellGaze(el);
  }

  function dwellGaze(el) {
    clearTimeout(gazeTimer);
    if (gazeCurrentEl) cleanup();
    gazeCurrentEl = el;
    gazeTimer = setTimeout(() => {
      const text = el.innerText?.trim() ?? '';
      if (text.length >= MIN_TEXT_LEN) triggerL1(el, text);
    }, DWELL_MS);
  }

  function cancelGaze() {
    clearTimeout(gazeTimer);
    cleanup();
    gazeCurrentEl = null;
  }

  // ── Gaze ring ─────────────────────────────────────────────────────────────
  function ensureGazeRing() {
    if (gazeRing) return;
    gazeRing = document.createElement('div');
    gazeRing.id = '__aikwau_gaze_ring';
    Object.assign(gazeRing.style, {
      position: 'fixed',
      width: '40px', height: '40px', borderRadius: '50%',
      border: '3px solid rgba(0,136,255,0.8)',
      boxShadow: '0 0 10px rgba(0,136,255,0.5)',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transform: 'translate(-50%, -50%)',
      transition: 'left 0.08s ease-out, top 0.08s ease-out',
      display: 'none',
    });
    document.body.appendChild(gazeRing);
  }

  function moveGazeRing(x, y) {
    if (!ringVisible) { if (gazeRing) gazeRing.style.display = 'none'; return; }
    ensureGazeRing();
    gazeRing.style.display = 'block';
    gazeRing.style.left = `${x}px`;
    gazeRing.style.top = `${y}px`;
  }

  // ── Cursor ring: enhances the real mouse pointer, mode-independent ────────
  function ensureCursorRing() {
    if (cursorRing) return;
    cursorRing = document.createElement('div');
    cursorRing.id = '__aikwau_cursor_ring';
    cursorRing.className = 'aikwau-cursor-ring';
    document.body.appendChild(cursorRing);
  }

  function moveCursorRing(x, y) {
    if (!cursorRingEnabled) { if (cursorRing) cursorRing.style.display = 'none'; return; }
    ensureCursorRing();
    cursorRing.style.display = 'block';
    cursorRing.style.left = `${x}px`;
    cursorRing.style.top = `${y}px`;
  }

  // ── Loading overlay ───────────────────────────────────────────────────────
  let loadingOverlay = null;

  function showLoadingOverlay() {
    loadingOverlay = document.createElement('div');
    Object.assign(loadingOverlay.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.85)',
      zIndex: '2147483646',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', color: '#fff',
    });
    loadingOverlay.innerHTML = `
      <div style="font-size:20px;font-weight:600;margin-bottom:12px">${t('webcamTitle')}</div>
      <div id="__aikwau_load_msg" style="font-size:14px;color:#aaa">${t('startingCamera')}</div>
      <div style="margin-top:20px;width:40px;height:40px;border:3px solid #333;border-top-color:#0088ff;border-radius:50%;animation:__aikwau_spin 0.8s linear infinite"></div>
      <style>@keyframes __aikwau_spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(loadingOverlay);
  }

  // ── Calibration overlay (9-point 3×3 or 25-point 5×5) ───────────────────
  function showCalibrationUI(numPoints) {
    numPoints = numPoints === 9 ? 9 : 25;
    if (loadingOverlay) { loadingOverlay.remove(); loadingOverlay = null; }
    document.dispatchEvent(new CustomEvent('aikwau:calstart', { detail: { numPoints } }));

    const POINTS = numPoints === 9
      ? [[10,10],[50,10],[90,10],
         [10,50],[50,50],[90,50],
         [10,90],[50,90],[90,90]]
      : [[10,10],[30,10],[50,10],[70,10],[90,10],
         [10,30],[30,30],[50,30],[70,30],[90,30],
         [10,50],[30,50],[50,50],[70,50],[90,50],
         [10,70],[30,70],[50,70],[70,70],[90,70],
         [10,90],[30,90],[50,90],[70,90],[90,90]];
    const SKIP_MIN = numPoints === 9 ? 6 : 12;

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.88)',
      zIndex: '2147483646',
      fontFamily: 'system-ui, sans-serif', color: '#fff', userSelect: 'none',
    });

    overlay.innerHTML = `
      <div style="position:absolute;top:20px;width:100%;text-align:center">
        <div style="font-size:18px;font-weight:600;margin-bottom:6px">${t('calTitle')}</div>
        <div style="font-size:13px;color:#aaa;margin-bottom:10px">${t('calInstruction')}</div>
        <div id="__aikwau_cal_prog" style="font-size:13px;color:#4af">${t('calProgress', { done: 0, total: numPoints })}</div>
      </div>
    `;

    const skipBtn = document.createElement('button');
    skipBtn.textContent = t('skipCalibration', { min: SKIP_MIN });
    Object.assign(skipBtn.style, {
      position: 'absolute', bottom: '24px', right: '24px',
      padding: '8px 20px', background: 'transparent',
      border: '1px solid #555', color: '#999',
      borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
    });
    overlay.appendChild(skipBtn);

    let currentIdx = 0;

    const dots = POINTS.map(([xPct, yPct], i) => {
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        position: 'fixed',
        width: '28px', height: '28px', borderRadius: '50%',
        background: '#333', border: '2px solid #555',
        left: `calc(${xPct}% - 14px)`, top: `calc(${yPct}% - 14px)`,
        cursor: 'pointer', zIndex: '2147483647',
        transition: 'transform 0.15s, background 0.15s, box-shadow 0.15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      });
      const label = document.createElement('span');
      label.textContent = i + 1;
      label.style.cssText = 'font-size:9px;color:#666;font-family:system-ui';
      dot.appendChild(label);
      overlay.appendChild(dot);
      return { el: dot, xPct, yPct };
    });

    function activate(idx) {
      const active = dots[idx];
      if (active) {
        document.dispatchEvent(new CustomEvent('aikwau:calpointactive', {
          detail: { xPct: active.xPct, yPct: active.yPct, idx },
        }));
      }
      dots.forEach(({ el, label }, i) => {
        if (i === idx) {
          Object.assign(el.style, {
            background: '#0088ff', border: '2px solid #fff',
            transform: 'scale(1.6)', boxShadow: '0 0 16px rgba(0,136,255,0.9)',
          });
          el.querySelector('span').style.color = '#fff';
        } else if (i < idx) {
          Object.assign(el.style, {
            background: '#003366', border: '2px solid #0055aa',
            transform: 'scale(1)', boxShadow: 'none',
          });
          el.querySelector('span').style.color = '#0055aa';
        }
      });
    }

    const finish = () => {
      calDone = true;
      overlay.remove();
      document.dispatchEvent(new CustomEvent('aikwau:calend'));
      ensureGazeRing();
      console.log('[aikwau/content] Calibration finished — calDone = true');
    };

    skipBtn.onclick = () => {
      if (currentIdx < SKIP_MIN) { alert(t('skipAlert', { min: SKIP_MIN })); return; }
      finish();
    };

    dots.forEach(({ el }, i) => {
      el.addEventListener('click', () => {
        if (i !== currentIdx) return;
        const rect = el.getBoundingClientRect();
        // Convert viewport centre of dot → screen coordinates
        const dotCX = rect.left + rect.width / 2;
        const dotCY = rect.top + rect.height / 2;
        const titleBarH = window.outerHeight - window.innerHeight;
        const screenX = Math.round(dotCX + window.screenX);
        const screenY = Math.round(dotCY + window.screenY + titleBarH);
        // Bridge calibration point to gaze_webcam.js (isolated → MAIN world via CustomEvent)
        console.log(`[aikwau/content] Cal dot ${i+1} clicked — dispatching aikwau:calibrate`,
          { screenX, screenY });
        document.dispatchEvent(new CustomEvent('aikwau:calibrate', { detail: { screenX, screenY } }));

        currentIdx++;
        overlay.querySelector('#__aikwau_cal_prog').textContent = t('calProgress', { done: currentIdx, total: numPoints });
        if (currentIdx >= POINTS.length) {
          finish();
        } else {
          activate(currentIdx);
        }
      });
    });

    document.body.appendChild(overlay);
    activate(0);
  }

  // ── Chrome runtime messages (from background.js) ──────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    // Injection failure reported by background.js
    if (msg.type === 'gaze:error') {
      if (loadingOverlay) {
        const el = loadingOverlay.querySelector('#__aikwau_load_msg');
        if (el) {
          el.textContent = t('injectionError', { msg: msg.message });
          el.style.color = '#f66';
        }
      }
      return;
    }
    if (msg.type === 'gaze:recalibrate') {
      calDone = false;
      chrome.storage.local.remove('aikwau_cal_data');
      document.dispatchEvent(new CustomEvent('aikwau:resetCalibration'));
      chrome.storage.local.get('aikwau_cal_points', ({ aikwau_cal_points }) => {
        const pts    = Number(aikwau_cal_points) || 25;
        const minCal = pts === 9 ? 6 : 12;
        document.dispatchEvent(new CustomEvent('aikwau:setcalpoints', { detail: { minCal } }));
        showCalibrationUI(pts);
      });
    }
    if (msg.type === 'gaze:panel-toggle') {
      document.dispatchEvent(new CustomEvent('aikwau:panel-toggle', { detail: { visible: msg.visible } }));
    }
    if (msg.type === 'gaze:ring-toggle') {
      ringVisible = msg.visible;
      if (gazeRing) gazeRing.style.display = ringVisible ? 'block' : 'none';
    }
    if (msg.type === 'gaze:cursor-ring-toggle') {
      cursorRingEnabled = msg.enabled;
      if (!cursorRingEnabled && cursorRing) cursorRing.style.display = 'none';
    }
    if (msg.type === 'gaze:blindspot-toggle') {
      blindSpotVisible = msg.visible;
      applyBlindSpotVisibility();
    }
    if (msg.type === 'gaze:ui-lang-toggle') { uiLang = msg.lang; }
    if (msg.type === 'gaze:master-toggle') {
      masterEnabled = msg.enabled;
      if (!masterEnabled) restoreAllEffects();
    }
    if (msg.type === 'gaze:bold-toggle') { boldEnabled = msg.enabled; }
    if (msg.type === 'gaze:contrast-toggle') { contrastEnabled = msg.enabled; }
    if (msg.type === 'gaze:l2-toggle') { l2Enabled = msg.enabled; }
    if (msg.type === 'gaze:l2-scale') { l2Scale = msg.scale; reapplyL2Scale(); }
    if (msg.type === 'gaze:summary-toggle') { summaryEnabled = msg.enabled; }
    if (msg.type === 'clearHighlights') {
      clearHeatmapState();
    }
  });

  // Resets in-memory heatmap + highlights. Shared by the popup's clearHighlights
  // message and the webcam panel's aikwau:clearHeatmap event — also cancels any
  // pending hmSaveTimer so it doesn't re-write stale data back to storage after
  // the caller clears it.
  function clearHeatmapState() {
    clearAllHighlights();
    hmCells.fill(0);
    hmDirty = false;
    if (hmSaveTimer) { clearTimeout(hmSaveTimer); hmSaveTimer = null; }
  }

  // Webcam panel (MAIN world) has no chrome.storage access, so its "清除熱圖"
  // button asks content.js to do the actual clearing, then pushes the now-empty
  // state back so the panel's mini heatmap re-renders immediately.
  document.addEventListener('aikwau:clearHeatmap', () => {
    chrome.storage.local.remove('aikwau_heatmap');
    clearHeatmapState();
    dispatchHeatmapData();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED: L1 effect + summarization badge
  // ══════════════════════════════════════════════════════════════════════════

  // Positions a summary-state label at el's top-right corner. Uses document
  // coordinates (scrollX/scrollY), not viewport ones, so it scrolls with the
  // page naturally — no scroll listener needed, unlike the fixed-position
  // blind-spot hints. Reads labelEl.offsetWidth, so its text must already be
  // set and it must already be attached to the DOM before calling this.
  function positionSummaryLabel(labelEl, el) {
    const rect = el.getBoundingClientRect();
    labelEl.style.left = `${rect.right + window.scrollX - labelEl.offsetWidth - 8}px`;
    labelEl.style.top  = `${rect.top + window.scrollY - labelEl.offsetHeight / 2}px`;
  }

  // Re-anchors every active summary label. Needed after anything that can
  // reflow the page (a window resize, or another paragraph's own toggle
  // changing its height and shifting elements below it).
  function repositionAllSummaryLabels() {
    summaryReadyEls.forEach((entry, el) => {
      if (entry.labelEl) positionSummaryLabel(entry.labelEl, el);
    });
  }

  // Renders each bullet ("• ..." line) as its own .aikwau-summary-line div, so
  // CSS hanging-indent (content.css) can align a wrapped bullet's second line
  // after "• " independently per bullet — a single text node with \n can only
  // hang its very first line (text-indent applies once per block). Uses
  // textContent per line, never innerHTML, so model-generated text is never
  // parsed as markup.
  function renderSummaryLines(el, summary) {
    el.textContent = '';
    summary.split('\n').forEach(line => {
      const div = document.createElement('div');
      div.className = 'aikwau-summary-line';
      div.textContent = line;
      el.appendChild(div);
    });
  }

  // Install a persistent click handler on el that toggles between original/summary.
  // The handler stays until SPA navigation (_clearOnNavigate) removes it.
  function markSummaryReady(el, summary) {
    if (summaryReadyEls.has(el)) return; // already installed
    el.classList.add('aikwau-summary-ready');

    const labelEl = document.createElement('div');
    labelEl.className = 'aikwau-summary-label';
    labelEl.textContent = t('clickSummary');
    document.body.appendChild(labelEl);
    positionSummaryLabel(labelEl, el);

    const entry = { summary, origText: null, shown: false, handler: null, labelEl };
    entry.handler = (e) => {
      if (!el.classList.contains('aikwau-summary-ready') &&
          !el.classList.contains('aikwau-summary-shown')) return;
      e.stopPropagation();
      if (!entry.shown) {
        entry.origText = el.textContent;
        renderSummaryLines(el, summary);
        el.classList.remove('aikwau-summary-ready');
        el.classList.add('aikwau-summary-shown');
        entry.labelEl.textContent = t('clickRestore');
        entry.labelEl.classList.add('aikwau-summary-label--shown');
        entry.shown = true;
      } else {
        el.textContent = entry.origText;
        el.classList.remove('aikwau-summary-shown');
        el.classList.add('aikwau-summary-ready');
        entry.labelEl.textContent = t('clickSummary');
        entry.labelEl.classList.remove('aikwau-summary-label--shown');
        entry.shown = false;
      }
      activeBadge?.remove(); activeBadge = null;
      repositionAllSummaryLabels();
    };
    el.addEventListener('click', entry.handler);
    summaryReadyEls.set(el, entry);
  }

  // Remove all persistent summary handlers and restore text if needed.
  function clearAllSummaryEls() {
    summaryReadyEls.forEach((entry, el) => {
      el.removeEventListener('click', entry.handler);
      if (entry.shown && entry.origText !== null) el.textContent = entry.origText;
      el.classList.remove('aikwau-summary-ready', 'aikwau-summary-shown',
                          'aikwau-bold', 'aikwau-contrast', 'aikwau-l2');
      el.style.removeProperty('font-size');
      delete el.dataset.aikwauBase;
      entry.labelEl?.remove();
    });
    summaryReadyEls.clear();
  }

  // Restores the page to its pre-AI-Kwau state when the master switch turns off.
  // clearAllSummaryEls() only knows about elements tracked in summaryReadyEls (i.e.
  // elements that got a summary); the querySelectorAll sweep below also catches
  // elements that only received bold/contrast/enlarge (e.g. because 段落摘要 was
  // off, or the summary fetch failed) and would otherwise be left highlighted.
  function restoreAllEffects() {
    clearAllSummaryEls();
    document.querySelectorAll('.aikwau-bold, .aikwau-contrast, .aikwau-l2').forEach(el => {
      el.classList.remove('aikwau-bold', 'aikwau-contrast', 'aikwau-l2');
      el.style.removeProperty('font-size');
      delete el.dataset.aikwauBase;
    });
    clearAllHighlights();
    cleanup();
  }

  function triggerL1(el, text) {
    if (el === activeEl) return;
    cleanup();
    activeEl = el;

    if (boldEnabled) el.classList.add('aikwau-bold');
    if (contrastEnabled) el.classList.add('aikwau-contrast');
    if (boldEnabled || contrastEnabled) removeHighlightsWithin(el);

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

  function showBadge(_anchor, text, state) {
    cleanup(false);
    const badge = document.createElement('div');
    badge.className = `aikwau-badge aikwau-badge--${state}`;
    badge.textContent = text;
    badge.style.maxWidth = `${Math.min(380, document.documentElement.clientWidth - 32)}px`;
    document.body.appendChild(badge);
    if (isWebcamMode) positionBadgeRight(badge); else positionBadgeAtCursor(badge);
    activeBadge = badge;
    if (state === 'ready') badgeTimer = setTimeout(cleanup, 16000);
  }

  function updateBadge(text, state) {
    if (!activeBadge) return;
    activeBadge.textContent = text;
    activeBadge.className = `aikwau-badge aikwau-badge--${state}`;
    if (state === 'ready') badgeTimer = setTimeout(cleanup, 12000);
  }

  // Clears badge and active-element tracking. L1/L2 styling intentionally persists.
  // Click handlers (summary toggle) are NOT removed here — they persist until navigation.
  function cleanup() {
    clearTimeout(badgeTimer); badgeTimer = null;
    activeBadge?.remove(); activeBadge = null;
    activeEl = null;
  }

  function detectLang() {
    return (document.documentElement.lang ?? '').startsWith('zh') ? 'zh' : 'en';
  }

  function detectTextLang(text) {
    // Count CJK characters; if > 8% of text → treat as Chinese
    const cjk = (text.match(/[　-鿿豈-﫿]/g) || []).length;
    return cjk / text.length > 0.08 ? 'zh' : 'en';
  }

  function loadingText() {
    return detectLang() === 'zh' ? '摘要中...' : 'Summarizing...';
  }

  function errorText(msg) {
    const zh = detectLang() === 'zh';
    if (!msg || msg === 'no_response') return zh ? '無回應' : 'No response';
    return compactSummary((zh ? '錯誤: ' : 'Error: ') + msg);
  }

  function compactSummary(raw) {
    // Preserve newlines so bullet points render correctly with white-space:pre-line
    const t = (raw ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!t) return detectLang() === 'zh' ? '無摘要內容' : 'No summary';
    if (t.length <= SUMMARY_MAX_CHARS) return t;
    const cut = t.slice(0, SUMMARY_MAX_CHARS);
    const lastEnd = Math.max(
      cut.lastIndexOf('。'), cut.lastIndexOf('.'),
      cut.lastIndexOf('！'), cut.lastIndexOf('!'),
      cut.lastIndexOf('？'), cut.lastIndexOf('?'),
      cut.lastIndexOf('\n'),
    );
    return lastEnd > SUMMARY_MAX_CHARS * 0.4 ? t.slice(0, lastEnd + 1) : cut;
  }

  function positionBadgeRight(badge) {
    const PAD = 20;
    const vw  = document.documentElement.clientWidth;
    const vh  = document.documentElement.clientHeight;
    const br  = badge.getBoundingClientRect();
    const left = Math.max(PAD, vw - br.width - PAD);
    const top  = Math.round(vh * 0.18);
    badge.style.left = `${window.scrollX + left}px`;
    badge.style.top  = `${window.scrollY + top}px`;
  }

  function positionBadgeAtCursor(badge) {
    const GAP = 18, PAD = 8;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const br = badge.getBoundingClientRect();
    // Prefer right of cursor; flip left if not enough room
    let left = lastMouseX + GAP;
    if (left + br.width > vw - PAD) left = lastMouseX - br.width - GAP;
    left = Math.max(PAD, left);
    // Vertically centred on cursor
    let top = lastMouseY - Math.round(br.height / 2);
    top = Math.max(PAD, Math.min(top, vh - br.height - PAD));
    badge.style.left = `${window.scrollX + left}px`;
    badge.style.top  = `${window.scrollY + top}px`;
  }

})();
