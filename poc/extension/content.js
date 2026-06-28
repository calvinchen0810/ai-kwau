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
  let l2Enabled         = true;   // L2 font enlargement
  let badgeTimer        = null;
  const summaryCache    = new Map(); // text-key → cached summary string
  // summaryReadyEls: el → { summary, origText, handler, shown }
  // Persists across gaze events — cleared only on SPA navigation
  const summaryReadyEls = new Map();
  let isWebcamMode = false;
  let colorReady        = '#ffee00';
  let colorShown        = '#00cc77';
  let colorStyleEl      = null;
  document.addEventListener('mousemove', e => { lastMouseX = e.clientX; lastMouseY = e.clientY; }, { passive: true });

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
  }

  window.addEventListener('beforeunload', hmSave);

  // ── Blind-area button scanner ─────────────────────────────────────────────
  const INTERACTIVE_SEL = [
    'button:not([disabled])',
    'a[href]',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]',
    '[role="link"]',
  ].join(', ');

  const MIN_HM_POINTS = 50;   // need this many gaze samples before scanning
  const MAX_BEACONS   = 4;    // max beacons on screen at once

  let beaconTargets = [];     // [{el, beaconEl}]

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

  function elLabel(el) {
    const t = (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.innerText ||
      el.value ||
      el.getAttribute('placeholder') ||
      el.tagName.toLowerCase()
    ).trim();
    return t.slice(0, 22) || el.tagName.toLowerCase();
  }

  function scanBlindButtons() {
    const total = hmCells.reduce((a, b) => a + b, 0);
    if (total < MIN_HM_POINTS) { updateBeacons([]); return; }

    const cold = coldCells();
    if (cold.size === 0) { updateBeacons([]); return; }

    const vw = window.innerWidth, vh = window.innerHeight;
    const found = [];

    for (const el of document.querySelectorAll(INTERACTIVE_SEL)) {
      // Skip extension-injected elements
      if (el.id?.startsWith('__aikwau') || el.id?.startsWith('__ap')) continue;
      if (el.closest('[id^="__aikwau"]') || el.closest('[id^="__ap"]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) continue;

      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      const col = Math.floor(cx / vw * HM_W);
      const row = Math.floor(cy / vh * HM_H);
      if (col < 0 || col >= HM_W || row < 0 || row >= HM_H) continue;

      if (cold.has(row * HM_W + col)) {
        found.push({ el, cx, cy, label: elLabel(el),
                     dist: Math.hypot(cx - vw / 2, cy - vh / 2) });
      }
    }

    // Keep the ones furthest from viewport center (most likely to be missed)
    found.sort((a, b) => b.dist - a.dist);
    const top = found.slice(0, MAX_BEACONS);
    updateBeacons(top);

    // Inform demo page how many were found
    document.dispatchEvent(new CustomEvent('aikwau:demo-ready', { detail: { count: top.length } }));
  }

  function updateBeacons(list) {
    const keep = new Set(list.map(i => i.el));
    for (const { el, beaconEl } of beaconTargets) {
      if (!keep.has(el)) beaconEl.remove();
    }
    beaconTargets = beaconTargets.filter(b => keep.has(b.el));

    const existingEls = new Set(beaconTargets.map(b => b.el));
    const vw = window.innerWidth, vh = window.innerHeight;
    const PAD = 10;
    const edgeCount = { left: 0, right: 0, top: 0, bottom: 0 };

    for (const item of list) {
      const { cx, cy, el, label } = item;

      // Nearest viewport edge
      const nearest = { left: cx, right: vw - cx, top: cy, bottom: vh - cy };
      const side = Object.keys(nearest).reduce((a, b) => nearest[a] < nearest[b] ? a : b);
      const idx  = edgeCount[side]++;

      if (existingEls.has(el)) continue;  // beacon already rendered

      const beaconEl = document.createElement('div');
      beaconEl.className = 'aikwau-beacon';
      beaconEl.dataset.side = side;
      const arrow   = { left: '◀', right: '▶', top: '▲', bottom: '▼' }[side];
      const tagType = el.tagName === 'A' ? '連結' : '按鈕';
      beaconEl.innerHTML =
        `<span class="aikwau-beacon-arrow">${arrow}</span>` +
        `<span class="aikwau-beacon-label">${tagType}：${label}</span>`;

      // Position: stack beacons along the edge at the element's cross-axis coordinate
      if (side === 'left' || side === 'right') {
        const top = Math.max(PAD, Math.min(vh - 36, cy - 14)) + idx * 48;
        beaconEl.style.cssText = `${side}:${PAD}px; top:${top}px;`;
      } else {
        const left = Math.max(PAD, Math.min(vw - 200, cx - 80)) + idx * 210;
        beaconEl.style.cssText = `${side}:${PAD}px; left:${left}px;`;
      }

      beaconEl.addEventListener('click', () => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('aikwau-l1');
        setTimeout(() => el.classList.remove('aikwau-l1'), 1800);
      });

      document.body.appendChild(beaconEl);
      beaconTargets.push({ el, beaconEl });
    }
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
    updateBeacons([]);
  });

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

  // ── SPA navigation: clear summaries on pushState / popstate ─────────────
  const _clearOnNavigate = () => {
    clearAllSummaryEls();
    cleanup();
  };
  window.addEventListener('popstate', _clearOnNavigate);
  ['pushState', 'replaceState'].forEach(m => {
    const orig = history[m].bind(history);
    history[m] = function(...args) { orig(...args); _clearOnNavigate(); };
  });

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

  // ── Gaze events from MAIN world (mouse mode: immediate; webcam mode: via dwell) ──
  document.addEventListener('aikwau:gazefocus', (e) => {
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
          msg.textContent = `相機錯誤：${e.detail?.message} — 請允許此網站存取相機再重新整理`;
          msg.style.color = '#f66';
        }
      }
    }, { once: true });
  }

  // ── Zone-based paragraph finder (works in isolated world) ─────────────────
  function findGazeTarget(gazeY) {
    const vh = window.innerHeight;
    let best = null, bestDist = Infinity;
    for (const el of document.querySelectorAll(SELECTORS)) {
      if ((el.innerText?.trim().length ?? 0) < MIN_TEXT_LEN) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || r.height === 0) continue;
      const dist = Math.abs((r.top + r.height / 2) - gazeY);
      if (dist < bestDist) { bestDist = dist; best = el; }
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

    const el = findGazeTarget(medianY);
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
      <div style="font-size:20px;font-weight:600;margin-bottom:12px">AI Kwau 眼球追蹤</div>
      <div id="__aikwau_load_msg" style="font-size:14px;color:#aaa">正在啟動相機與 MediaPipe 模型...</div>
      <div style="margin-top:20px;width:40px;height:40px;border:3px solid #333;border-top-color:#0088ff;border-radius:50%;animation:__aikwau_spin 0.8s linear infinite"></div>
      <style>@keyframes __aikwau_spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(loadingOverlay);
  }

  // ── Calibration overlay (9-point 3×3 or 25-point 5×5) ───────────────────
  function showCalibrationUI(numPoints) {
    numPoints = numPoints === 9 ? 9 : 25;
    if (loadingOverlay) { loadingOverlay.remove(); loadingOverlay = null; }
    document.dispatchEvent(new CustomEvent('aikwau:calstart'));

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
        <div style="font-size:18px;font-weight:600;margin-bottom:6px">眼球追蹤校準 (MediaPipe)</div>
        <div style="font-size:13px;color:#aaa;margin-bottom:10px">注視每個藍色圓點，然後點擊它。請確保臉部在鏡頭中央。</div>
        <div id="__aikwau_cal_prog" style="font-size:13px;color:#4af">0 / ${numPoints} 完成</div>
      </div>
    `;

    const skipBtn = document.createElement('button');
    skipBtn.textContent = `跳過校準（需至少 ${SKIP_MIN} 點）`;
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
      if (currentIdx < SKIP_MIN) { alert(`請至少完成 ${SKIP_MIN} 個校準點。`); return; }
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
        overlay.querySelector('#__aikwau_cal_prog').textContent = `${currentIdx} / ${numPoints} 完成`;
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
          el.textContent = `注入錯誤：${msg.message}`;
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
    if (msg.type === 'gaze:l2-toggle') { l2Enabled = msg.enabled; }
    if (msg.type === 'gaze:highlight-colors') {
      if (msg.colorReady) colorReady = msg.colorReady;
      if (msg.colorShown) colorShown = msg.colorShown;
      applyHighlightColors();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED: L1 effect + summarization badge
  // ══════════════════════════════════════════════════════════════════════════

  // Install a persistent click handler on el that toggles between original/summary.
  // The handler stays until SPA navigation (_clearOnNavigate) removes it.
  function markSummaryReady(el, summary) {
    if (summaryReadyEls.has(el)) return; // already installed
    el.classList.add('aikwau-summary-ready');
    const entry = { summary, origText: null, shown: false, handler: null };
    entry.handler = (e) => {
      if (!el.classList.contains('aikwau-summary-ready') &&
          !el.classList.contains('aikwau-summary-shown')) return;
      e.stopPropagation();
      if (!entry.shown) {
        entry.origText = el.textContent;
        el.textContent = summary;
        el.classList.remove('aikwau-summary-ready');
        el.classList.add('aikwau-summary-shown');
        entry.shown = true;
      } else {
        el.textContent = entry.origText;
        el.classList.remove('aikwau-summary-shown');
        el.classList.add('aikwau-summary-ready');
        entry.shown = false;
      }
      activeBadge?.remove(); activeBadge = null;
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
                          'aikwau-l1', 'aikwau-l2');
      el.style.removeProperty('font-size');
      delete el.dataset.aikwauBase;
    });
    summaryReadyEls.clear();
  }

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
      if (!isNaN(base)) el.style.setProperty('font-size', `${(base * 1.2).toFixed(1)}px`, 'important');
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
