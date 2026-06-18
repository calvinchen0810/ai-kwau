/**
 * AI Kwau Content Script
 * Gaze-hold triggered text enhancement + on-device AI summarization.
 * Dwell detection is handled by GazeTracker (gaze_tracker.js).
 */

// Guard against double-injection (hash navigation, SPA, extension reload)
if (window.__aikwauContentLoaded) {
  // Already loaded, skip
  throw new Error('content.js skipped (already loaded)');
}
window.__aikwauContentLoaded = true;

// Wrap entire script in IIFE to prevent duplicate const declarations
(() => {
  const MIN_TEXT_LEN = 40;
  const SUMMARY_MAX_CHARS = 72;

  let activeEl = null;
  let activeBadge = null;

  (async () => {
    const tracker = window.__aikwauTracker;
    if (!tracker) return;

    await tracker.init();

    tracker.addEventListener('gazefocus', (e) => {
      const el = e.detail.el;
      const text = el.innerText?.trim() ?? '';
      if (text.length < MIN_TEXT_LEN) return;
      triggerL1(el, text);
    });

    tracker.addEventListener('gazeblur', () => cleanup());
  })();

  // ── L1 visual enhancement + summarize request ─────────────────────────
  function triggerL1(el, text) {
    el.classList.add('aikwau-l1');
    activeEl = el;
    showBadge(el, loadingText(), 'loading');

    chrome.runtime.sendMessage(
      { type: 'summarize', text, lang: detectLang() },
      (resp) => {
        if (!resp) { updateBadge(errorText('no_response'), 'error'); return; }
        if (resp.status === 'ok') {
          updateBadge(compactSummary(resp.summary), 'ready');
        } else {
          updateBadge(errorText(resp.message), 'error');
        }
      }
    );
  }

  // ── Badge UI ──────────────────────────────────────────────────────────
  function showBadge(anchor, text, state) {
    cleanup(false);
    const badge = document.createElement('div');
    badge.className = `aikwau-badge aikwau-badge--${state}`;
    badge.textContent = text;
    const rect = anchor.getBoundingClientRect();
    badge.style.maxWidth = `${Math.max(rect.width, 260)}px`;
    document.body.appendChild(badge);
    positionBadgeOutsideParagraph(badge, rect);
    activeBadge = badge;
    if (state === 'ready') setTimeout(cleanup, 12000);
  }

  function updateBadge(text, state) {
    if (!activeBadge) return;
    activeBadge.textContent = text;
    activeBadge.className = `aikwau-badge aikwau-badge--${state}`;
    if (state === 'ready') setTimeout(cleanup, 12000);
  }

  function cleanup(resetEl = true) {
    activeBadge?.remove();
    activeBadge = null;
    if (resetEl) {
      activeEl?.classList.remove('aikwau-l1');
      activeEl = null;
    }
  }

  function detectLang() {
    return (document.documentElement.lang ?? '').startsWith('zh') ? 'zh' : 'en';
  }

  function loadingText() {
    return detectLang() === 'zh' ? '摘要中...' : 'Summarizing...';
  }

  function errorText(message) {
    const lang = detectLang();
    if (!message || message === 'no_response') {
      return lang === 'zh' ? '無回應' : 'No response';
    }
    const prefix = lang === 'zh' ? '錯誤: ' : 'Error: ';
    return compactSummary(`${prefix}${message}`);
  }

  function compactSummary(rawText) {
    const text = (rawText ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return detectLang() === 'zh' ? '無摘要內容' : 'No summary';
    if (text.length <= SUMMARY_MAX_CHARS) return text;
    return `${text.slice(0, SUMMARY_MAX_CHARS - 1)}...`;
  }

  function positionBadgeOutsideParagraph(badge, anchorRect) {
    const GAP = 10;
    const PAD = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const badgeRect = badge.getBoundingClientRect();

    // Clamp horizontally to viewport while following the paragraph edge.
    const idealLeft = anchorRect.left;
    const minLeft = PAD;
    const maxLeft = Math.max(PAD, viewportWidth - badgeRect.width - PAD);
    const left = Math.min(Math.max(idealLeft, minLeft), maxLeft);

    // Keep the badge outside paragraph area: prefer above, fallback to below.
    const aboveTop = anchorRect.top - badgeRect.height - GAP;
    const belowTop = anchorRect.bottom + GAP;
    const top = aboveTop >= PAD
      ? aboveTop
      : Math.min(belowTop, Math.max(PAD, viewportHeight - badgeRect.height - PAD));

    badge.style.left = `${window.scrollX + left}px`;
    badge.style.top = `${window.scrollY + top}px`;
  }
})();
