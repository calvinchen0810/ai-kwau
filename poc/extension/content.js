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

  let activeEl    = null;
  let activeBadge = null;
  let lastMouseX  = 0, lastMouseY = 0;
  document.addEventListener('mousemove', e => { lastMouseX = e.clientX; lastMouseY = e.clientY; }, { passive: true });

  // ── Mode init ─────────────────────────────────────────────────────────────
  chrome.storage.local.get('aikwau_gaze_mode', ({ aikwau_gaze_mode }) => {
    if ((aikwau_gaze_mode ?? 'mouse') === 'webcam') {
      initWebcam();
    }
    // Mouse mode events come from gaze_tracker.js (MAIN world) via document
  });

  // ── Gaze events from MAIN world (mouse mode: immediate; webcam mode: via dwell) ──
  document.addEventListener('aikwau:gazefocus', (e) => {
    const { x, y } = e.detail ?? {};
    if (x == null) return;
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
  const DWELL_MS = 2000;
  const SMOOTH_ALPHA = 0.25;   // responsive EMA — mouse cursor is the reference speed
  const DEAD_ZONE = 15;        // px — absorb small noise without freezing real movement
  const HISTORY_FRAMES = 20;

  let gazeTimer = null;
  let gazeCurrentEl = null;
  let smoothX = null, smoothY = null;
  let ringX = null, ringY = null;  // last committed ring position (dead-zone gated)
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
    document.addEventListener('aikwau:gazeready', (e) => {
      const calCount = e.detail?.calCount ?? 0;
      console.log('[aikwau/content] aikwau:gazeready received, calCount =', calCount);
      if (calCount >= 12) {
        // gaze_webcam.js already has enough calibration points (re-injection edge case)
        calDone = true;
        if (loadingOverlay) { loadingOverlay.remove(); loadingOverlay = null; }
        ensureGazeRing();
        console.log('[aikwau/content] Skipping calibration — gaze_webcam already has', calCount, 'points');
      } else {
        console.log('[aikwau/content] Showing calibration UI');
        showCalibrationUI();
      }
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

  // ── 25-point calibration overlay (5×5 grid) ──────────────────────────────
  function showCalibrationUI() {
    if (loadingOverlay) { loadingOverlay.remove(); loadingOverlay = null; }
    document.dispatchEvent(new CustomEvent('aikwau:calstart'));

    const POINTS = [
      [10,10],[30,10],[50,10],[70,10],[90,10],
      [10,30],[30,30],[50,30],[70,30],[90,30],
      [10,50],[30,50],[50,50],[70,50],[90,50],
      [10,70],[30,70],[50,70],[70,70],[90,70],
      [10,90],[30,90],[50,90],[70,90],[90,90],
    ];

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
        <div id="__aikwau_cal_prog" style="font-size:13px;color:#4af">0 / 25 完成</div>
      </div>
    `;

    const skipBtn = document.createElement('button');
    skipBtn.textContent = '跳過校準（需至少 12 點）';
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
      if (currentIdx < 12) { alert('請至少完成 12 個校準點。'); return; }
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
        overlay.querySelector('#__aikwau_cal_prog').textContent = `${currentIdx} / 25 完成`;
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
      document.dispatchEvent(new CustomEvent('aikwau:resetCalibration'));
      console.log('[aikwau/content] gaze:recalibrate — showing calibration UI again');
      showCalibrationUI();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED: L1 effect + summarization badge
  // ══════════════════════════════════════════════════════════════════════════

  function triggerL1(el, text) {
    if (el === activeEl) return; // already active
    cleanup(false);
    el.classList.add('aikwau-l1');
    activeEl = el;
    showBadge(el, loadingText(), 'loading');

    chrome.runtime.sendMessage(
      { type: 'summarize', text, lang: detectLang() },
      (resp) => {
        if (!resp) { updateBadge(errorText('no_response'), 'error'); return; }
        if (resp.status === 'ok') updateBadge(compactSummary(resp.summary), 'ready');
        else updateBadge(errorText(resp.message), 'error');
      }
    );
  }

  function showBadge(_anchor, text, state) {
    cleanup(false);
    const badge = document.createElement('div');
    badge.className = `aikwau-badge aikwau-badge--${state}`;
    badge.textContent = text;
    badge.style.maxWidth = `${Math.min(420, document.documentElement.clientWidth - 32)}px`;
    document.body.appendChild(badge);
    positionBadgeAtCursor(badge);
    activeBadge = badge;
    if (state === 'ready') setTimeout(cleanup, 16000);
  }

  function updateBadge(text, state) {
    if (!activeBadge) return;
    activeBadge.textContent = text;
    activeBadge.className = `aikwau-badge aikwau-badge--${state}`;
    if (state === 'ready') setTimeout(cleanup, 12000);
  }

  function cleanup(resetEl = true) {
    activeBadge?.remove(); activeBadge = null;
    if (resetEl) { activeEl?.classList.remove('aikwau-l1'); activeEl = null; }
  }

  function detectLang() {
    return (document.documentElement.lang ?? '').startsWith('zh') ? 'zh' : 'en';
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
    const t = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return detectLang() === 'zh' ? '無摘要內容' : 'No summary';
    if (t.length <= SUMMARY_MAX_CHARS) return t;
    // Trim to last complete sentence within the limit
    const cut = t.slice(0, SUMMARY_MAX_CHARS);
    const lastEnd = Math.max(
      cut.lastIndexOf('。'), cut.lastIndexOf('.'),
      cut.lastIndexOf('！'), cut.lastIndexOf('!'),
      cut.lastIndexOf('？'), cut.lastIndexOf('?'),
    );
    return lastEnd > SUMMARY_MAX_CHARS * 0.4 ? t.slice(0, lastEnd + 1) : cut;
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
