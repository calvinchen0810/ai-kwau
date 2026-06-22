/**
 * AI Kwau — GazeTracker (MAIN world)
 *
 * Runs in the page's MAIN world so webgazer (which uses new Function() for
 * WebGL shaders) is not blocked by the extension's isolated-world CSP.
 *
 * Mode is read from a DOM attribute set by mode_bridge.js (isolated world).
 * Gaze events are dispatched on `document` so the isolated-world content.js
 * can receive them (DOM events are shared between worlds).
 *
 * Events emitted on document:
 *   aikwau:gazefocus  { detail: { el: HTMLElement } }
 *   aikwau:gazeblur   { detail: { el: HTMLElement } }
 */
(() => {
  const DWELL_MS = 2000;
  const SELECTORS = 'p, h1, h2, h3, h4, li, blockquote, td, figcaption';
  const MIN_GAZE_TEXT_LEN = 40;

  let timer = null;
  let current = null;
  let smoothX = null;
  let smoothY = null;
  const SMOOTH_ALPHA = 0.05; // lower = smoother but more lag (0.05–0.15)

  // ── Wait for isolated world to expose mode via DOM attribute ─────────────
  function getMode() {
    return new Promise(resolve => {
      const existing = document.documentElement.getAttribute('data-aikwau-mode');
      if (existing) { resolve(existing); return; }
      document.addEventListener('aikwau:mode-ready', (e) => resolve(e.detail.mode), { once: true });
    });
  }

  async function init() {
    const mode = await getMode();
    console.info('[AI Kwau] GazeTracker (MAIN) mode =', mode, '| webgazer =', typeof webgazer);
    if (mode === 'webcam') {
      await startWebcam();
    } else {
      startMouse();
    }
  }

  // ── Mouse simulation ──────────────────────────────────────────────────────
  function startMouse() {
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest(SELECTORS);
      if (!el || el === current) return;
      dwell(el);
    });
    document.addEventListener('mouseout', (e) => {
      if (e.relatedTarget && current?.contains(e.relatedTarget)) return;
      cancel();
    });
  }

  // ── WebGazer eye tracking ─────────────────────────────────────────────────
  async function startWebcam() {
    if (typeof webgazer === 'undefined') {
      console.warn('[AI Kwau] webgazer not found — falling back to mouse mode.');
      startMouse();
      return;
    }
    try {
      await webgazer
        .setGazeListener((data) => { if (data) onGazePoint(data.x, data.y); })
        .begin();
      webgazer.showPredictionPoints(false);
      webgazer.showVideo(true);
      webgazer.showFaceOverlay(false);
      webgazer.showFaceFeedbackBox(false);
      createGazeRing();
      await runCalibration();
      console.info('[AI Kwau] WebGazer initialized — eye tracking active.');
    } catch (err) {
      console.error('[AI Kwau] webgazer.begin() failed:', err);
    }
  }

  // ── 9-point calibration UI ────────────────────────────────────────────────
  function runCalibration() {
    return new Promise(resolve => {
      const POINTS = [
        [10, 10], [50, 10], [90, 10],
        [10, 50], [50, 50], [90, 50],
        [10, 90], [50, 90], [90, 90],
      ];

      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0',
        background: 'rgba(0,0,0,0.88)',
        zIndex: '2147483646',
        fontFamily: 'system-ui, sans-serif',
        color: '#fff',
        userSelect: 'none',
      });

      const header = document.createElement('div');
      Object.assign(header.style, {
        position: 'absolute', top: '20px', width: '100%',
        textAlign: 'center',
      });
      header.innerHTML = `
        <div style="font-size:18px;font-weight:600;margin-bottom:6px">眼球追蹤校準</div>
        <div style="font-size:13px;color:#aaa;margin-bottom:12px">依序點擊每個藍色圓點，完成後自動開始追蹤</div>
        <div id="__aikwau_cal_progress" style="font-size:13px;color:#4af">0 / 9 完成</div>
      `;
      overlay.appendChild(header);

      const skipBtn = document.createElement('button');
      skipBtn.textContent = '跳過校準';
      Object.assign(skipBtn.style, {
        position: 'absolute', bottom: '24px', right: '24px',
        padding: '8px 20px', background: 'transparent',
        border: '1px solid #555', color: '#999',
        borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
      });
      skipBtn.onclick = () => { overlay.remove(); resolve(); };
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
        label.style.cssText = 'font-size:11px;color:#666;font-family:system-ui';
        dot.appendChild(label);
        overlay.appendChild(dot);
        return dot;
      });

      function activate(idx) {
        dots.forEach((d, i) => {
          if (i === idx) {
            Object.assign(d.style, {
              background: '#0088ff', border: '2px solid #fff',
              transform: 'scale(1.6)', boxShadow: '0 0 16px rgba(0,136,255,0.9)',
              cursor: 'pointer',
            });
            d.querySelector('span').style.color = '#fff';
          } else if (i < idx) {
            Object.assign(d.style, {
              background: '#003366', border: '2px solid #0055aa',
              transform: 'scale(1)', boxShadow: 'none', cursor: 'default',
            });
            d.querySelector('span').style.color = '#0055aa';
          }
        });
      }

      dots.forEach((dot, i) => {
        dot.addEventListener('click', () => {
          if (i !== currentIdx) return;
          const rect = dot.getBoundingClientRect();
          webgazer.recordScreenPosition(rect.left + rect.width / 2, rect.top + rect.height / 2, 'click');
          currentIdx++;
          overlay.querySelector('#__aikwau_cal_progress').textContent = `${currentIdx} / 9 完成`;
          if (currentIdx >= POINTS.length) {
            overlay.remove();
            resolve();
          } else {
            activate(currentIdx);
          }
        });
      });

      document.body.appendChild(overlay);
      activate(0);
    });
  }

  // ── Gaze ring visual indicator ────────────────────────────────────────────
  function createGazeRing() {
    const ring = document.createElement('div');
    ring.id = '__aikwau_gaze_ring';
    Object.assign(ring.style, {
      position: 'fixed',
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: '3px solid rgba(0, 120, 255, 0.8)',
      boxShadow: '0 0 8px rgba(0,120,255,0.5)',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transform: 'translate(-50%, -50%)',
      transition: 'left 0.12s ease-out, top 0.12s ease-out',
      display: 'none',
    });
    document.body.appendChild(ring);
    window.__aikwauGazeRing = ring;
  }

  function moveGazeRing(x, y) {
    const ring = window.__aikwauGazeRing;
    if (!ring) return;
    ring.style.display = 'block';
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
  }

  function onGazePoint(x, y) {
    // EMA smoothing — reduces jitter while keeping reasonable responsiveness
    smoothX = smoothX === null ? x : SMOOTH_ALPHA * x + (1 - SMOOTH_ALPHA) * smoothX;
    smoothY = smoothY === null ? y : SMOOTH_ALPHA * y + (1 - SMOOTH_ALPHA) * smoothY;

    moveGazeRing(smoothX, smoothY);

    const hit = document.elementFromPoint(smoothX, smoothY);
    const el = hit?.closest(SELECTORS);
    if (!el || (el.innerText?.trim().length ?? 0) < MIN_GAZE_TEXT_LEN) {
      if (current) cancel();
      return;
    }
    if (el !== current) dwell(el);
  }

  // ── Shared dwell logic ────────────────────────────────────────────────────
  // Pass viewport coords (primitives cross MAIN↔isolated boundary).
  // Isolated world does its own elementFromPoint to get the actual element.
  function dwell(el) {
    clearTimeout(timer);
    if (current) document.dispatchEvent(new CustomEvent('aikwau:gazeblur'));
    current = el;
    timer = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      document.dispatchEvent(new CustomEvent('aikwau:gazefocus', { detail: { x, y } }));
    }, DWELL_MS);
  }

  function cancel() {
    clearTimeout(timer);
    if (current) {
      document.dispatchEvent(new CustomEvent('aikwau:gazeblur'));
      current = null;
    }
  }

  init();
})();
