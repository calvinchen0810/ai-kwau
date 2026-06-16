/**
 * AI Kwau — GazeTracker
 *
 * Two modes, toggled via chrome.storage.local { aikwau_gaze_mode: 'mouse' | 'webcam' }:
 *   mouse   — dwell detection via mouseover/mouseout (PoC default, no hardware needed)
 *   webcam  — dwell detection via WebGazer.js (real eye-tracking, requires webcam)
 *
 * WebGazer setup: download webgazer.js from https://github.com/brownhci/WebGazer
 * and place it alongside this file in poc/extension/. Then add "webgazer.js" before
 * "gaze_tracker.js" in manifest.json content_scripts.js array.
 *
 * Emits CustomEvents on document: 'gazefocus' and 'gazeblur'
 *   gazefocus: { detail: { el: HTMLElement } } — dwell threshold reached
 *   gazeblur:  { detail: { el: HTMLElement } } — gaze left element
 */

const DWELL_MS = 2000;
const SELECTORS = 'p, h1, h2, h3, h4, li, blockquote, td, figcaption';
const MIN_TEXT_LEN = 40;

class GazeTracker extends EventTarget {
  constructor() {
    super();
    this.mode = 'mouse';
    this._timer = null;
    this._current = null;
  }

  async init() {
    const { aikwau_gaze_mode } = await chrome.storage.local.get('aikwau_gaze_mode');
    this.mode = aikwau_gaze_mode ?? 'mouse';

    if (this.mode === 'webcam') {
      await this._startWebcam();
    } else {
      this._startMouse();
    }
  }

  // ── Mouse simulation (default PoC mode) ──────────────────────────────
  _startMouse() {
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest(SELECTORS);
      if (!el || el === this._current) return;
      this._dwell(el);
    });

    document.addEventListener('mouseout', (e) => {
      if (e.relatedTarget && this._current?.contains(e.relatedTarget)) return;
      this._cancel();
    });
  }

  // ── WebGazer real eye-tracking ────────────────────────────────────────
  async _startWebcam() {
    if (typeof webgazer === 'undefined') {
      console.warn('[AI Kwau] webgazer.js not found — falling back to mouse mode.');
      this.mode = 'mouse';
      this._startMouse();
      return;
    }

    await webgazer
      .setGazeListener((data) => { if (data) this._onGazePoint(data.x, data.y); })
      .begin();

    webgazer.showPredictionPoints(false);
    webgazer.showVideo(true);
    webgazer.showFaceOverlay(false);
    webgazer.showFaceFeedbackBox(false);

    console.info('[AI Kwau] WebGazer initialized — eye tracking active.');
  }

  _onGazePoint(x, y) {
    const hit = document.elementFromPoint(x, y);
    const el = hit?.closest(SELECTORS);

    if (!el || (el.innerText?.trim().length ?? 0) < MIN_TEXT_LEN) {
      if (this._current) this._cancel();
      return;
    }
    if (el !== this._current) this._dwell(el);
  }

  // ── Shared dwell logic ────────────────────────────────────────────────
  _dwell(el) {
    clearTimeout(this._timer);
    if (this._current) {
      this.dispatchEvent(new CustomEvent('gazeblur', { detail: { el: this._current } }));
    }
    this._current = el;
    this._timer = setTimeout(() => {
      this.dispatchEvent(new CustomEvent('gazefocus', { detail: { el } }));
    }, DWELL_MS);
  }

  _cancel() {
    clearTimeout(this._timer);
    if (this._current) {
      this.dispatchEvent(new CustomEvent('gazeblur', { detail: { el: this._current } }));
      this._current = null;
    }
  }

  // ── Mode switch (requires page reload to take effect) ────────────────
  async setMode(mode) {
    this.mode = mode;
    await chrome.storage.local.set({ aikwau_gaze_mode: mode });
  }
}

window.__aikwauTracker = new GazeTracker();
