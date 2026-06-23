'use strict';
/**
 * AI Kwau — Gaze Tracker Window
 *
 * Runs in a small chrome.windows.create popup (visible window → camera
 * permission dialog works, no page CSP restriction).
 *
 * Communication:
 *   ← chrome.runtime.onMessage  {type:'gaze:calibrate',  screenX, screenY}
 *   ← chrome.runtime.onMessage  {type:'gaze:resetCalibration'}
 *   → chrome.runtime.sendMessage {type:'gaze:point',  screenX, screenY}
 *   → chrome.runtime.sendMessage {type:'gaze:ready'}
 *   → chrome.runtime.sendMessage {type:'gaze:error', message}
 */

const video  = document.getElementById('cam');
const dot    = document.getElementById('dot');
const statusEl = document.getElementById('status');

// ── Gaze state ────────────────────────────────────────────────────────────────
let latestIris = null;
const calPoints = [];
let lastSent = 0;
let processing = false;
let sendErrShown = false;

// ── IDW gaze regression ───────────────────────────────────────────────────────
function estimateGaze(ix, iy) {
  if (calPoints.length < 3) return null;
  let wx = 0, wy = 0, w = 0;
  for (const p of calPoints) {
    const d2 = (ix - p.irisX) ** 2 + (iy - p.irisY) ** 2;
    const weight = d2 < 1e-10 ? 1e10 : 1 / d2;
    wx += weight * p.screenX;
    wy += weight * p.screenY;
    w  += weight;
  }
  return { x: Math.round(wx / w), y: Math.round(wy / w) };
}

// ── MediaPipe FaceMesh ────────────────────────────────────────────────────────
function initFaceMesh() {
  const fm = new FaceMesh({
    locateFile: (file) => chrome.runtime.getURL(`mediapipe/${file}`)
  });
  fm.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  fm.onResults((results) => {
    if (!results.multiFaceLandmarks?.length) {
      latestIris = null;
      dot.style.display = 'none';
      if (calPoints.length === 0) statusEl.textContent = '未偵測到臉部';
      return;
    }
    const lm = results.multiFaceLandmarks[0];
    // Average both iris centres, normalised relative to nose tip
    const ix = (lm[468].x + lm[473].x) / 2 - lm[1].x;
    const iy = (lm[468].y + lm[473].y) / 2 - lm[1].y;
    latestIris = { x: ix, y: iy };

    // Show raw iris position on camera preview (mirrored, so flip x)
    const previewX = (1 - ((lm[468].x + lm[473].x) / 2)) * 240;
    const previewY = ((lm[468].y + lm[473].y) / 2) * 160;
    dot.style.left = `${previewX}px`;
    dot.style.top  = `${previewY}px`;
    dot.style.display = 'block';
    statusEl.textContent = `追蹤中 (${calPoints.length} 校準點)`;

    if (calPoints.length < 3) return;
    const now = Date.now();
    if (now - lastSent < 100) return; // 10 fps cap
    lastSent = now;
    const gaze = estimateGaze(ix, iy);
    if (gaze) chrome.runtime.sendMessage({ type: 'gaze:point', screenX: gaze.x, screenY: gaze.y });
  });
  return fm;
}

// ── Webcam loop ───────────────────────────────────────────────────────────────
async function startWebcam() {
  // Attach button listener FIRST (before any code that can throw)
  await new Promise(resolve => {
    document.getElementById('grantbtn').addEventListener('click', resolve, { once: true });
  });
  document.getElementById('startbtn').style.display = 'none';
  document.getElementById('cam').style.display = 'block';
  statusEl.textContent = '正在載入 MediaPipe...';

  const fm = initFaceMesh();
  statusEl.textContent = '正在請求相機權限...';

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' }
  });
  video.srcObject = stream;
  await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));

  statusEl.textContent = `追蹤中 (${calPoints.length} 校準點)`;

  setInterval(async () => {
    if (video.readyState < 2 || processing) return;
    processing = true;
    try {
      await fm.send({ image: video });
    } catch (e) {
      if (!sendErrShown) {
        sendErrShown = true;
        statusEl.textContent = `FaceMesh 錯誤: ${e.message}`;
        console.error('[AI Kwau] fm.send error:', e);
      }
    } finally {
      processing = false;
    }
  }, 33);

  chrome.runtime.sendMessage({ type: 'gaze:ready' });
}

// ── Messages from background (calibration data) ───────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'gaze:calibrate' && latestIris) {
    calPoints.push({
      irisX: latestIris.x, irisY: latestIris.y,
      screenX: msg.screenX, screenY: msg.screenY,
    });
    statusEl.textContent = `追蹤中 (${calPoints.length} 校準點)`;
  } else if (msg.type === 'gaze:resetCalibration') {
    calPoints.length = 0;
    statusEl.textContent = '校準已重置';
  }
});

startWebcam().catch(err => {
  const detail = `${err.name}: ${err.message}`;
  console.error('[AI Kwau gazetracker] Error:', detail);
  // Show error on the overlay (which may still be visible)
  const overlay = document.getElementById('startbtn');
  overlay.style.display = 'flex';
  overlay.innerHTML = `<p style="color:#f66;padding:12px;text-align:center;font-size:12px">錯誤:<br>${detail}</p>`;
  statusEl.textContent = `錯誤: ${err.name}`;
  chrome.runtime.sendMessage({ type: 'gaze:error', message: detail });
});
