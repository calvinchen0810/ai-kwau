/**
 * AI Kwau — GazeTracker (MAIN world, mouse mode only)
 *
 * Webcam/MediaPipe mode is handled entirely by the offscreen document
 * (offscreen.js) and the isolated-world content script (content.js).
 * This MAIN-world script only runs the mouse-hover simulation.
 */
(() => {
  const DWELL_MS = 1500;
  const SELECTORS = 'p, h1, h2, h3, h4, li, blockquote, td, figcaption';
  const MIN_TEXT_LEN = 40;

  let timer = null;
  let current = null;

  function getMode() {
    return new Promise(resolve => {
      const attr = document.documentElement.getAttribute('data-aikwau-mode');
      if (attr) { resolve(attr); return; }
      document.addEventListener('aikwau:mode-ready', (e) => resolve(e.detail.mode), { once: true });
    });
  }

  async function init() {
    const mode = await getMode();
    if (mode !== 'mouse') return; // webcam handled by offscreen + content.js
    startMouse();
  }

  // ── Mouse hover simulation ────────────────────────────────────────────────
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

  // Pass viewport coords as primitives (HTML elements can't cross world boundary)
  function dwell(el) {
    clearTimeout(timer);
    if (current) document.dispatchEvent(new CustomEvent('aikwau:gazeblur'));
    current = el;
    timer = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      document.dispatchEvent(new CustomEvent('aikwau:gazefocus', {
        detail: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
      }));
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
