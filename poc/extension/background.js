/**
 * AI Kwau — Service Worker (background.js)
 *
 * 1. Native Messaging → LLM inference
 * 2. Webcam mode: inject MediaPipe + gaze_webcam.js into host page MAIN world
 *    (host page CSP applies → eval() allowed; extension page CSP never applies)
 */

// ── Native host (LLM summarization) ──────────────────────────────────────────
const HOST_NAME = 'com.hp.aikwau.summarizer';
let port = null;
const pending = new Map();
let reqCounter = 0;

function connect() {
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener((msg) => {
    const cb = pending.get(msg.reqId);
    if (cb) { pending.delete(msg.reqId); cb(msg); }
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message ?? 'disconnected';
    console.warn('[AI Kwau] Native host disconnected:', err);
    pending.forEach((cb) => cb({ status: 'error', message: err }));
    pending.clear();
    port = null;
  });
  port.postMessage({ action: 'ping', reqId: 0 });
}

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {

  // ── LLM summarization ──────────────────────────────────────────────────────
  if (msg.type === 'summarize') {
    if (!port) connect();
    const id = ++reqCounter;
    pending.set(id, (resp) => reply(resp));
    port.postMessage({ action: 'summarize', text: msg.text, lang: msg.lang ?? 'en', reqId: id });
    return true; // keep reply channel open
  }

  // ── Webcam mode: inject MediaPipe into host page MAIN world ────────────────
  // content.js (isolated) sends gaze:start when webcam mode is detected.
  // We inject face_mesh.js then gaze_webcam.js into the host page's MAIN world.
  // Host page CSP applies there → eval() is allowed (unlike extension pages).
  if (msg.type === 'gaze:start' && sender.tab) {
    const tabId = sender.tab.id;
    const mediapipeBase = chrome.runtime.getURL('mediapipe/');
    console.log('[aikwau/bg] gaze:start from tab', tabId, '— injecting MediaPipe, base:', mediapipeBase);

    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (url) => { window.__aikwau_mediapipe_base = url; },
      args: [mediapipeBase],
    })
    .then(() => {
      console.log('[aikwau/bg] Step 1 done — __aikwau_mediapipe_base set');
      return chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['mediapipe/face_mesh.js'],
      });
    })
    .then(() => {
      console.log('[aikwau/bg] Step 2 done — face_mesh.js injected');
      return chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['gaze_webcam.js'],
      });
    })
    .then(() => {
      console.log('[aikwau/bg] Step 3 done — gaze_webcam.js injected');
    })
    .catch(err => {
      console.error('[aikwau/bg] Script injection failed:', err);
      chrome.tabs.sendMessage(tabId, { type: 'gaze:error', message: err.message }).catch(() => {});
    });

    return false;
  }

  return false;
});
