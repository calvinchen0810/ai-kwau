'use strict';
/**
 * AI Kwau — Webcam Gaze Tracker v3  (host page MAIN world, dynamically injected)
 *
 * Gaze estimation pipeline:
 *   1. MediaPipe FaceMesh (478 landmarks, refineLandmarks=true)
 *   2. Eye-corner normalised iris features  [ix, iy]
 *        ix = average( (iris.x − eye_centre.x) / eye_width  )  over both eyes
 *        iy = average( (iris.y − eye_centre.y) / eye_height )  over both eyes
 *        → invariant to head translation and camera distance
 *   3. Head pose estimation  [yaw, pitch]
 *        yaw   = (right_face_half_width − left_face_half_width) / total_face_width
 *        pitch = (nose_tip.y − eye_level.y) / face_height − neutral_ratio
 *        → both expressed as dimensionless ratios ≈ 0 when head is neutral
 *   4. 2nd-order polynomial least-squares regression
 *        feature vector φ = [1, ix, iy, ix², iy², ix·iy, yaw, pitch]  (D=8)
 *        screen_x ≈ φ · c_x ,  screen_y ≈ φ · c_y
 *        solved via Gauss-Jordan on Φᵀ Φ + λI = Φᵀ Y  (ridge λ=1e-4)
 *        → regression automatically learns head-pose coupling weights;
 *          no hard-coded geometry constants needed
 *
 * Landmark reference (MediaPipe FaceMesh, refineLandmarks=true):
 *   Left  eye : outer=33,  inner=133, top=159, bot=145, iris=468
 *   Right eye : outer=263, inner=362, top=386, bot=374, iris=473
 *   Face edges: left=234,  right=454
 *   Nose tip  : 1     Eye level: avg(159,386)     Chin: 152
 */
(function () {
  if (window.__aikwau_webcam_active) return;
  window.__aikwau_webcam_active = true;

  const D       = 8;   // feature dimension
  const MIN_CAL = 12;  // minimum calibration points before regression activates
  const MAP_W   = 240;
  const MAP_H   = 135; // 16:9 minimap

  // ── Floating camera panel ─────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = '__aikwau_cam_panel';
  panel.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
    'width:242px;background:#111;border-radius:8px;' +
    'box-shadow:0 2px 16px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;overflow:hidden';
  panel.innerHTML =
    '<div id="__ap_drag" style="padding:5px 8px;background:#1a1a2e;cursor:grab;' +
    'user-select:none;font-size:10px;color:#445;text-align:center;letter-spacing:1px;">' +
    '⠿ AI Kwau</div>' +
    '<div id="__ap_start" style="display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;padding:20px 10px;gap:10px;">' +
    '<button id="__ap_btn" style="padding:8px 18px;font-size:13px;background:#0088ff;' +
    'color:#fff;border:none;border-radius:6px;cursor:pointer;">開啟相機</button>' +
    '<p style="font-size:11px;color:#888;margin:0;text-align:center;">' +
    'AI Kwau 眼球追蹤<br>點擊以授權相機存取</p></div>' +
    '<div id="__ap_vidwrap" style="display:none;position:relative;width:240px;height:160px;">' +
    '<video id="__ap_video" autoplay playsinline style="display:none;"></video>' +
    '<canvas id="__ap_display" width="240" height="160" ' +
    'style="display:block;width:240px;height:160px;"></canvas></div>' +
    '<div id="__ap_iris" style="padding:4px 6px;background:#0a0f1a;border-top:1px solid #1e2030;' +
    'font-size:10px;color:#7af;font-family:monospace;white-space:pre;display:none;line-height:1.5">' +
    '</div>' +
    `<canvas id="__ap_map" width="${MAP_W}" height="${MAP_H}" ` +
    'style="display:none;border-top:1px solid #1e1e2e;"></canvas>' +
    '<button id="__ap_verify" style="display:none;width:100%;padding:5px 0;' +
    'background:#0d2040;border:none;border-top:1px solid #1e3060;' +
    'color:#4af;font-size:11px;cursor:pointer;">驗證模式</button>' +
    '<div id="__ap_status" style="padding:3px 6px;background:rgba(0,0,0,0.75);' +
    'font-size:11px;color:#aaa;text-align:center;border-radius:0 0 8px 8px;">正在啟動相機...</div>';
  document.body.appendChild(panel);

  // ── Drag to reposition ────────────────────────────────────────────────────
  const dragHandle = panel.querySelector('#__ap_drag');
  let dragging = false, dragOffX = 0, dragOffY = 0;

  dragHandle.addEventListener('mousedown', e => {
    dragging = true;
    dragHandle.style.cursor = 'grabbing';
    // Convert right/bottom anchor to left/top on first drag
    if (!panel.style.left) {
      const r = panel.getBoundingClientRect();
      panel.style.left   = `${r.left}px`;
      panel.style.top    = `${r.top}px`;
      panel.style.right  = '';
      panel.style.bottom = '';
    }
    dragOffX = e.clientX - panel.getBoundingClientRect().left;
    dragOffY = e.clientY - panel.getBoundingClientRect().top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const nx = Math.max(0, Math.min(e.clientX - dragOffX, window.innerWidth  - 242));
    const ny = Math.max(0, Math.min(e.clientY - dragOffY, window.innerHeight - panel.offsetHeight));
    panel.style.left = `${nx}px`;
    panel.style.top  = `${ny}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    dragHandle.style.cursor = 'grab';
  });

  const video      = panel.querySelector('#__ap_video');
  const statusEl   = panel.querySelector('#__ap_status');
  const mapCanvas  = panel.querySelector('#__ap_map');
  const ctx        = mapCanvas.getContext('2d');
  const displayCanvas = panel.querySelector('#__ap_display');
  const displayCtx    = displayCanvas.getContext('2d');
  const irisInfoEl    = panel.querySelector('#__ap_iris');
  const verifyBtn  = panel.querySelector('#__ap_verify');

  // ── State ─────────────────────────────────────────────────────────────────
  let latestIris     = null;  // {x, y, yaw, pitch}
  const calPoints    = [];    // {irisX,irisY,headYaw,headPitch,screenX,screenY}
  let polyCoeffs     = null;  // {cx[D], cy[D]}
  let lastGazeScreen = null;
  let lastSent       = 0;
  let processing     = false;
  let sendErrShown   = false;
  let faceWasHere    = false;
  let firstFace      = true;
  let verifyOverlay  = null;  // {canvas, draw, close}
  let gazeLogTimer   = 0;

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Eye-corner normalised iris features
  // ══════════════════════════════════════════════════════════════════════════
  function extractIrisFeatures(lm) {
    // Left eye
    const lW  = Math.abs(lm[33].x  - lm[133].x) || 1e-4;
    const lH  = Math.abs(lm[159].y - lm[145].y) || 1e-4;
    const lCX = (lm[33].x  + lm[133].x) / 2;
    const lCY = (lm[159].y + lm[145].y) / 2;
    // Right eye
    const rW  = Math.abs(lm[263].x - lm[362].x) || 1e-4;
    const rH  = Math.abs(lm[386].y - lm[374].y) || 1e-4;
    const rCX = (lm[263].x + lm[362].x) / 2;
    const rCY = (lm[386].y + lm[374].y) / 2;

    const x = ((lm[468].x - lCX) / lW + (lm[473].x - rCX) / rW) / 2;
    const y = ((lm[468].y - lCY) / lH + (lm[473].y - rCY) / rH) / 2;
    return { x, y };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Head pose estimation
  // ══════════════════════════════════════════════════════════════════════════
  function estimateHeadPose(lm) {
    // YAW: face width asymmetry around nose tip (lm[234]=left edge, lm[454]=right edge)
    const leftW  = Math.max(0, lm[1].x  - lm[234].x);
    const rightW = Math.max(0, lm[454].x - lm[1].x);
    const totalW = leftW + rightW;
    // > 0: head turned user-LEFT  (camera sees more right face → rightW > leftW)
    // < 0: head turned user-RIGHT (camera sees more left face  → leftW  > rightW)
    const yaw = totalW > 1e-4 ? (rightW - leftW) / totalW : 0;

    // PITCH: nose tip position between eye level and chin
    const eyeY  = (lm[159].y + lm[386].y) / 2;
    const chinY = lm[152].y;
    const span  = (chinY - eyeY) || 1e-4;
    // > 0: head tilted down,  < 0: head tilted up,  ≈0: neutral
    const pitch = (lm[1].y - eyeY) / span - 0.46;

    return { yaw, pitch };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — 2nd-order polynomial regression with head pose features
  // φ = [1, ix, iy, ix², iy², ix·iy, yaw, pitch]
  // ══════════════════════════════════════════════════════════════════════════
  function makeFeatures(ix, iy, yaw, pitch) {
    return [1, ix, iy, ix * ix, iy * iy, ix * iy, yaw, pitch];
  }

  // Gauss-Jordan elimination with partial pivoting; returns x s.t. Ax = b
  function solveLinear(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
      }
      [M[col], M[maxRow]] = [M[maxRow], M[col]];
      if (Math.abs(M[col][col]) < 1e-12) continue;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
      }
    }
    return M.map((row, i) => row[n] / (row[i] || 1e-12));
  }

  function fitPolynomial() {
    if (calPoints.length < MIN_CAL) { polyCoeffs = null; return; }
    const Phi = calPoints.map(p =>
      makeFeatures(p.irisX, p.irisY, p.headYaw, p.headPitch));

    // ΦᵀΦ + λI  (ridge regularisation λ=1e-4)
    const PhiTPhi = Array.from({length: D}, (_, i) =>
      Array.from({length: D}, (_, j) =>
        Phi.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? 1e-4 : 0)
      )
    );
    const mkRhs = key =>
      Array.from({length: D}, (_, i) =>
        Phi.reduce((s, r, k) => s + r[i] * calPoints[k][key], 0)
      );
    polyCoeffs = {
      cx: solveLinear(PhiTPhi.map(r => [...r]), mkRhs('screenX')),
      cy: solveLinear(PhiTPhi.map(r => [...r]), mkRhs('screenY')),
    };
    console.log(`[aikwau/webcam] Polynomial refit n=${calPoints.length}` +
      ` RMSE=${computeRMSE()?.toFixed(0)}px`);
  }

  function estimateGaze(ix, iy, yaw, pitch) {
    if (!polyCoeffs) return null;
    const phi = makeFeatures(ix, iy, yaw, pitch);
    return {
      x: Math.round(phi.reduce((s, v, i) => s + v * polyCoeffs.cx[i], 0)),
      y: Math.round(phi.reduce((s, v, i) => s + v * polyCoeffs.cy[i], 0)),
    };
  }

  function computeRMSE() {
    if (!polyCoeffs || !calPoints.length) return null;
    const sum = calPoints.reduce((s, p) => {
      const g = estimateGaze(p.irisX, p.irisY, p.headYaw, p.headPitch);
      return s + (g.x - p.screenX) ** 2 + (g.y - p.screenY) ** 2;
    }, 0);
    return Math.sqrt(sum / calPoints.length);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MINIMAP — calibration coverage, gaze crosshair, head pose indicator
  // ══════════════════════════════════════════════════════════════════════════
  function drawMinimap() {
    const W = MAP_W, H = MAP_H;
    // Map is relative to the current viewport, not the virtual desktop.
    // screen→viewport: subtract window offset + browser chrome height.
    const vw = window.innerWidth  || 1;
    const vh = window.innerHeight || 1;
    const titleBarH = window.outerHeight - window.innerHeight;

    const toMap = (sx, sy) => {
      const vx = sx - window.screenX;
      const vy = sy - window.screenY - titleBarH;
      return {
        x: Math.max(4, Math.min(W - 4, (vx / vw) * W)),
        y: Math.max(4, Math.min(H - 4, (vy / vh) * H)),
      };
    };

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // Grid at thirds
    ctx.strokeStyle = '#1e2030'; ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(W * i / 3, 0); ctx.lineTo(W * i / 3, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H * i / 3); ctx.lineTo(W, H * i / 3); ctx.stroke();
    }
    ctx.strokeStyle = '#2a2a40'; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Calibration points (yellow)
    for (const p of calPoints) {
      const m = toMap(p.screenX, p.screenY);
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath(); ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // Gaze crosshair (blue=in-bounds, red=out-of-bounds)
    if (lastGazeScreen) {
      const m = toMap(lastGazeScreen.x, lastGazeScreen.y);
      const inBounds = m.x > 4 && m.x < W - 4 && m.y > 4 && m.y < H - 4;
      const S = 8;
      ctx.strokeStyle = inBounds ? '#0088ff' : '#ff4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(m.x - S, m.y); ctx.lineTo(m.x + S, m.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m.x, m.y - S); ctx.lineTo(m.x, m.y + S); ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.stroke();
    }

    // Head pose indicator (top-right): dot moves with head rotation
    // Green = neutral, orange = significant rotation (>10%)
    if (latestIris) {
      const { yaw, pitch } = latestIris;
      const cx = W - 22, cy = 18, scale = 14;
      const significant = Math.abs(yaw) > 0.1 || Math.abs(pitch) > 0.1;
      const colour = significant ? '#ffaa00' : '#00cc66';
      ctx.strokeStyle = '#2a2a40'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - scale, cy); ctx.lineTo(cx + scale, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - scale); ctx.lineTo(cx, cy + scale); ctx.stroke();
      ctx.fillStyle = colour;
      ctx.beginPath();
      // yaw > 0 = head left → dot moves left in camera image
      ctx.arc(cx - yaw * scale * 1.5, cy + pitch * scale * 1.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '8px system-ui'; ctx.fillStyle = '#444';
      ctx.textAlign = 'right';
      ctx.fillText(`y${(yaw*100).toFixed(0)} p${(pitch*100).toFixed(0)}`, W - 4, H - 14);
      ctx.textAlign = 'left';
    }

    // Bottom info bar
    ctx.font = '9px system-ui'; ctx.fillStyle = '#555'; ctx.textAlign = 'left';
    const rmse = computeRMSE();
    ctx.fillText(
      `${calPoints.length} 校準點` + (rmse != null ? `  誤差 ${rmse.toFixed(0)}px` : ''),
      4, H - 4
    );
    if (lastGazeScreen) {
      // Show viewport coords (screen minus window offset) for easier verification
      const vx = Math.round(lastGazeScreen.x - window.screenX);
      const vy = Math.round(lastGazeScreen.y - window.screenY - titleBarH);
      ctx.fillStyle = '#334'; ctx.textAlign = 'right';
      ctx.fillText(`vp ${vx}, ${vy}`, W - 4, H - 4);
      ctx.textAlign = 'left';
    }
  }

  // ── Calibration overlay events ────────────────────────────────────────────
  document.addEventListener('aikwau:calstart', () => {
    panel.style.display = 'none';
    console.log('[aikwau/webcam] Panel hidden for calibration');
  });
  document.addEventListener('aikwau:calend', () => {
    panel.style.display = '';
    verifyBtn.style.display = 'block';
    drawMinimap();
    console.log('[aikwau/webcam] Panel restored; polyCoeffs ready:', !!polyCoeffs);
  });

  // ── Calibration bridge (isolated → MAIN world) ────────────────────────────
  document.addEventListener('aikwau:calibrate', (e) => {
    if (!latestIris) {
      console.warn('[aikwau/webcam] calibrate ignored — no face data');
      return;
    }
    const p = {
      irisX:     latestIris.x,
      irisY:     latestIris.y,
      headYaw:   latestIris.yaw,
      headPitch: latestIris.pitch,
      screenX:   e.detail.screenX,
      screenY:   e.detail.screenY,
    };
    calPoints.push(p);
    fitPolynomial();
    drawMinimap();
    const n = calPoints.length;
    statusEl.textContent = n < MIN_CAL
      ? `校準中 (${n}/${MIN_CAL} 點)`
      : `追蹤中 (${n} 校準點)`;
    console.log(`[aikwau/webcam] Cal point ${n}:`,
      `iris=(${p.irisX.toFixed(3)},${p.irisY.toFixed(3)})`,
      `yaw=${p.headYaw.toFixed(3)} pitch=${p.headPitch.toFixed(3)}`,
      `screen=(${p.screenX},${p.screenY})`);
  });

  document.addEventListener('aikwau:resetCalibration', () => {
    calPoints.length = 0; polyCoeffs = null; lastGazeScreen = null;
    if (verifyOverlay) { verifyOverlay.close(); }
    verifyBtn.style.display = 'none';
    drawMinimap();
    statusEl.textContent = '校準已重置';
    console.log('[aikwau/webcam] Calibration reset');
  });

  // ── Verification overlay ─────────────────────────────────────────────────
  function showVerificationOverlay() {
    if (verifyOverlay) { verifyOverlay.close(); return; }

    const titleBarH = window.outerHeight - window.innerHeight;
    const vpPts = calPoints.map(p => ({
      x: p.screenX - window.screenX,
      y: p.screenY - window.screenY - titleBarH,
    }));

    // Full-screen canvas (non-interactive, sits below gaze ring)
    const vc = document.createElement('canvas');
    vc.width  = window.innerWidth;
    vc.height = window.innerHeight;
    Object.assign(vc.style, {
      position: 'fixed', inset: '0',
      zIndex: '2147483640', pointerEvents: 'none',
    });
    document.body.appendChild(vc);
    const vctx = vc.getContext('2d');

    // HUD bar (top-centre)
    const hud = document.createElement('div');
    hud.style.cssText =
      'position:fixed;top:10px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483641;pointer-events:none;' +
      'padding:5px 14px;background:rgba(0,0,0,0.75);' +
      'color:#adf;font-size:12px;font-family:system-ui;border-radius:6px;' +
      'border:1px solid #2244aa;white-space:nowrap;';
    hud.textContent = '驗證模式：注視黃圈，觀察藍圈是否對齊';
    document.body.appendChild(hud);

    function draw(vx, vy) {
      vctx.clearRect(0, 0, vc.width, vc.height);

      // Find nearest calibration point
      let nearest = null, minDist = Infinity;
      for (const p of vpPts) {
        const d = Math.hypot(vx - p.x, vy - p.y);
        if (d < minDist) { minDist = d; nearest = p; }
      }

      // Draw all calibration dots
      for (const p of vpPts) {
        const isNear = p === nearest;
        vctx.beginPath(); vctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        vctx.fillStyle   = isNear ? 'rgba(255,200,0,0.18)' : 'rgba(255,200,0,0.07)';
        vctx.fill();
        vctx.strokeStyle = isNear ? '#ffcc00' : 'rgba(255,200,0,0.35)';
        vctx.lineWidth   = isNear ? 2.5 : 1;
        vctx.stroke();
      }

      if (vx == null || !nearest) return;

      // Dashed error line: nearest dot → current gaze
      vctx.beginPath(); vctx.moveTo(nearest.x, nearest.y); vctx.lineTo(vx, vy);
      vctx.strokeStyle = 'rgba(255,80,80,0.55)';
      vctx.lineWidth   = 1.5;
      vctx.setLineDash([5, 4]); vctx.stroke(); vctx.setLineDash([]);

      // Error distance label
      const dist = Math.round(minDist);
      const colour = dist < 50 ? '#55ff55' : dist < 100 ? '#ffdd44' : '#ff6666';
      vctx.font = 'bold 13px system-ui'; vctx.textAlign = 'center';
      vctx.fillStyle = 'rgba(0,0,0,0.6)';
      vctx.fillText(`${dist}px`, vx + 1, vy - 21);
      vctx.fillStyle = colour;
      vctx.fillText(`${dist}px`, vx, vy - 22);

      // Update HUD with current error
      hud.textContent = `驗證模式：最近校準點偏差 ${dist}px`;
      hud.style.color = colour;
    }

    draw(null, null);

    const closeAll = () => {
      vc.remove(); hud.remove();
      verifyOverlay = null;
      verifyBtn.textContent = '驗證模式';
      verifyBtn.style.color = '#4af';
    };

    verifyBtn.textContent = '✕ 結束驗證';
    verifyBtn.style.color = '#f88';
    verifyOverlay = { draw, close: closeAll };
  }

  verifyBtn.addEventListener('click', showVerificationOverlay);

  // ── Zoomed eye canvas ────────────────────────────────────────────────────
  function drawZoomedEye(lm) {
    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;
    const DW = 240, DH = 160;
    const dc = displayCtx;

    // Bounding box of all eye-relevant landmarks in video pixels
    const EYE_LMS = [33, 133, 159, 145, 263, 362, 386, 374, 468, 473];
    const exs = EYE_LMS.map(i => lm[i].x * vw);
    const eys = EYE_LMS.map(i => lm[i].y * vh);
    const bx1 = Math.min(...exs), bx2 = Math.max(...exs);
    const by1 = Math.min(...eys), by2 = Math.max(...eys);

    // Padding: tight horizontal, extra vertical to show brows
    const pw = (bx2 - bx1) * 0.45;
    const ph = (by2 - by1) * 0.9;
    const cx = Math.max(0,    bx1 - pw);
    const cy = Math.max(0,    by1 - ph);
    const cw = Math.min(vw - cx, bx2 + pw - cx);
    const ch = Math.min(vh - cy, by2 + ph - cy);

    // Draw mirrored crop of eye region onto display canvas
    dc.clearRect(0, 0, DW, DH);
    dc.save();
    dc.translate(DW, 0); dc.scale(-1, 1);
    dc.drawImage(video, cx, cy, cw, ch, 0, 0, DW, DH);
    dc.restore();

    // Map a landmark index to display canvas coords (mirrored)
    const toDisp = i => ({
      x: DW - (lm[i].x * vw - cx) / cw * DW,
      y:      (lm[i].y * vh - cy) / ch * DH,
    });

    // Eye corner bounding boxes (green)
    const drawBox = (outer, inner, top, bot) => {
      const pts = [outer, inner, top, bot].map(toDisp);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      dc.strokeStyle = 'rgba(0,230,100,0.9)'; dc.lineWidth = 2;
      dc.strokeRect(Math.min(...xs), Math.min(...ys),
                    Math.max(...xs) - Math.min(...xs),
                    Math.max(...ys) - Math.min(...ys));
      pts.forEach(p => {
        dc.fillStyle = '#00e864';
        dc.beginPath(); dc.arc(p.x, p.y, 3.5, 0, Math.PI * 2); dc.fill();
      });
    };
    drawBox(33,  133, 159, 145);   // left  eye
    drawBox(263, 362, 386, 374);   // right eye

    // Iris centres — cyan (left) / magenta (right), white outline
    [[468, '#00ddff'], [473, '#ff44cc']].forEach(([idx, col]) => {
      const p = toDisp(idx);
      dc.beginPath(); dc.arc(p.x, p.y, 8, 0, Math.PI * 2);
      dc.fillStyle = col; dc.fill();
      dc.strokeStyle = '#ffffff'; dc.lineWidth = 2; dc.stroke();
    });
  }

  // ── MediaPipe FaceMesh ────────────────────────────────────────────────────
  function initFaceMesh() {
    const base = window.__aikwau_mediapipe_base ?? '';
    const fm   = new FaceMesh({ locateFile: f => `${base}${f}` });
    fm.setOptions({
      maxNumFaces: 1, refineLandmarks: true,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    });

    fm.onResults(results => {
      if (!results.multiFaceLandmarks?.length) {
        latestIris = null;
        // Show full mirrored video when no face detected
        displayCtx.save();
        displayCtx.translate(240, 0); displayCtx.scale(-1, 1);
        if (video.readyState >= 2) displayCtx.drawImage(video, 0, 0, 240, 160);
        displayCtx.restore();
        displayCtx.fillStyle = 'rgba(0,0,0,0.55)';
        displayCtx.fillRect(0, 60, 240, 40);
        displayCtx.fillStyle = '#f88'; displayCtx.font = '13px system-ui';
        displayCtx.textAlign = 'center';
        displayCtx.fillText('未偵測到臉部', 120, 85);
        displayCtx.textAlign = 'left';
        irisInfoEl.textContent = '— 未偵測到臉部 —';
        if (!calPoints.length) statusEl.textContent = '未偵測到臉部';
        if (faceWasHere) { faceWasHere = false; document.dispatchEvent(new CustomEvent('aikwau:gazeblur')); }
        return;
      }

      if (firstFace) {
        firstFace = false;
        console.log('[aikwau/webcam] First face detected, landmarks:',
          results.multiFaceLandmarks[0].length, '(expect 478)');
      }
      faceWasHere = true;

      const lm   = results.multiFaceLandmarks[0];
      const iris = extractIrisFeatures(lm);
      const pose = estimateHeadPose(lm);
      latestIris = { x: iris.x, y: iris.y, yaw: pose.yaw, pitch: pose.pitch };

      // ── Zoomed eye view with landmark overlay ───────────────────────────
      drawZoomedEye(lm);

      // ── Iris info text panel ─────────────────────────────────────────────
      const s = n => (n >= 0 ? ' ' : '') + n.toFixed(3);
      irisInfoEl.textContent =
        `ix ${s(iris.x)}   iy ${s(iris.y)}\n` +
        `yaw ${s(pose.yaw)}  pitch ${s(pose.pitch)}\n` +
        `L468 (${lm[468].x.toFixed(3)}, ${lm[468].y.toFixed(3)})` +
        `  R473 (${lm[473].x.toFixed(3)}, ${lm[473].y.toFixed(3)})`;

      const n = calPoints.length;
      statusEl.textContent = n < MIN_CAL
        ? `校準中 (${n}/${MIN_CAL} 點)`
        : `追蹤中 (${n} 校準點)  頭偏 yaw=${(pose.yaw*100).toFixed(0)}`;

      if (!polyCoeffs) return;

      const now = Date.now();
      if (now - lastSent < 100) return;
      lastSent = now;

      const gaze = estimateGaze(iris.x, iris.y, pose.yaw, pose.pitch);
      if (!gaze) return;
      lastGazeScreen = gaze;
      drawMinimap();

      if (now - gazeLogTimer > 2000) {
        gazeLogTimer = now;
        console.log('[aikwau/webcam] gaze=', gaze,
          `iris=(${iris.x.toFixed(3)},${iris.y.toFixed(3)})`,
          `yaw=${pose.yaw.toFixed(3)} pitch=${pose.pitch.toFixed(3)}`);
      }

      const titleBarH = window.outerHeight - window.innerHeight;
      const vx = gaze.x - window.screenX;
      const vy = gaze.y - window.screenY - titleBarH;
      if (verifyOverlay) verifyOverlay.draw(vx, vy);
      document.dispatchEvent(new CustomEvent('aikwau:gazefocus', { detail: { x: vx, y: vy } }));

    });
    return fm;
  }

  // ── Webcam startup ────────────────────────────────────────────────────────
  async function startWebcam() {
    await new Promise(resolve =>
      panel.querySelector('#__ap_btn').addEventListener('click', resolve, { once: true })
    );
    panel.querySelector('#__ap_start').style.display   = 'none';
    panel.querySelector('#__ap_vidwrap').style.display = 'block';
    irisInfoEl.style.display = 'block';
    mapCanvas.style.display  = 'block';
    drawMinimap();
    statusEl.textContent = '正在載入 MediaPipe...';

    const fm = initFaceMesh();
    statusEl.textContent = '正在請求相機權限...';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    video.srcObject = stream;
    await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
    statusEl.textContent = `校準中 (0/${MIN_CAL} 點)`;

    setInterval(async () => {
      if (video.readyState < 2 || processing) return;
      processing = true;
      try { await fm.send({ image: video }); }
      catch (e) {
        if (!sendErrShown) {
          sendErrShown = true;
          statusEl.textContent = `FaceMesh 錯誤: ${e.message}`;
          console.error('[aikwau/webcam] fm.send error:', e);
        }
      } finally { processing = false; }
    }, 33);

    const calCount = calPoints.length;
    console.log('[aikwau/webcam] Ready; dispatching aikwau:gazeready (calPoints=' + calCount + ')');
    document.dispatchEvent(new CustomEvent('aikwau:gazeready', { detail: { calCount } }));
  }

  startWebcam().catch(err => {
    const detail = `${err.name}: ${err.message}`;
    console.error('[aikwau/webcam] startWebcam error:', detail);
    const s = panel.querySelector('#__ap_start');
    s.style.display = 'flex';
    s.innerHTML = `<p style="color:#f66;padding:12px;text-align:center;font-size:12px">錯誤:<br>${detail}</p>`;
    statusEl.textContent = `錯誤: ${err.name}`;
    document.dispatchEvent(new CustomEvent('aikwau:gazeerror', { detail: { message: detail } }));
  });
})();
