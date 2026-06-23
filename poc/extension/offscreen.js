'use strict';
/**
 * AI Kwau — Offscreen Gaze Tracker
 *
 * Runs inside a chrome.offscreen document (extension page, not injected into
 * any web page). MediaPipe FaceMesh loads from extension web-accessible
 * resources — no page CSP restriction applies here.
 *
 * Protocol (via chrome.runtime.sendMessage):
 *   ← {_to:'offscreen', type:'gaze:calibrate', screenX, screenY}  (from background)
 *   → {type:'gaze:ready'}        when webcam + model are initialised
 *   → {type:'gaze:point', screenX, screenY}   live gaze at ~10 fps
 */

const video = document.getElementById('webcam');

// ── Gaze state ────────────────────────────────────────────────────────────────
let latestIris = null;          // {x, y} nose-anchored iris position
const calPoints = [];           // [{irisX, irisY, screenX, screenY}]
let lastSent = 0;               // throttle timestamp
let processing = false;

// ── IDW (Inverse Distance Weighting) gaze regression ─────────────────────────
// Requires ≥ 3 calibration points. Accuracy improves up to ~9 points.
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
  // FaceMesh is available as a global from mediapipe/face_mesh.js
  const fm = new FaceMesh({
    locateFile: (file) => chrome.runtime.getURL(`mediapipe/${file}`)
  });

  fm.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,      // required for iris landmarks 468–477
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  fm.onResults((results) => {
    if (!results.multiFaceLandmarks?.length) { latestIris = null; return; }

    const lm = results.multiFaceLandmarks[0];
    // Landmark 468 = left iris centre, 473 = right iris centre, 1 = nose tip.
    // Subtracting nose tip normalises for lateral head movement.
    const lx = (lm[468].x + lm[473].x) / 2 - lm[1].x;
    const ly = (lm[468].y + lm[473].y) / 2 - lm[1].y;
    latestIris = { x: lx, y: ly };

    if (calPoints.length < 3) return;
    const now = Date.now();
    if (now - lastSent < 100) return; // 10 fps cap
    lastSent = now;

    const gaze = estimateGaze(lx, ly);
    if (gaze) chrome.runtime.sendMessage({ type: 'gaze:point', screenX: gaze.x, screenY: gaze.y });
  });

  return fm;
}

// ── Webcam capture loop ───────────────────────────────────────────────────────
async function startWebcam() {
  const fm = initFaceMesh();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' }
  });
  video.srcObject = stream;
  await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));

  // setInterval is more reliable than rAF in offscreen documents (no visible viewport)
  setInterval(async () => {
    if (video.readyState < 2 || processing) return;
    processing = true;
    try { await fm.send({ image: video }); } finally { processing = false; }
  }, 33); // ~30 fps input; gaze output is throttled to 10 fps

  chrome.runtime.sendMessage({ type: 'gaze:ready' });
  console.info('[AI Kwau offscreen] MediaPipe FaceMesh active, webcam streaming.');
}

// ── Incoming messages from background.js ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg._to !== 'offscreen') return;
  if (msg.type === 'gaze:calibrate' && latestIris) {
    calPoints.push({
      irisX: latestIris.x,
      irisY: latestIris.y,
      screenX: msg.screenX,
      screenY: msg.screenY,
    });
    console.info(`[AI Kwau offscreen] Calibration point ${calPoints.length}: iris=(${latestIris.x.toFixed(4)}, ${latestIris.y.toFixed(4)}) screen=(${msg.screenX}, ${msg.screenY})`);
  } else if (msg.type === 'gaze:resetCalibration') {
    calPoints.length = 0;
    console.info('[AI Kwau offscreen] Calibration reset.');
  }
});

startWebcam().catch(err => {
  const detail = `${err.name}: ${err.message}`;
  console.error('[AI Kwau offscreen] Startup error:', detail);
  chrome.runtime.sendMessage({ type: 'gaze:error', message: detail });
});
