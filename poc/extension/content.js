/**
 * AI Kwau Content Script
 * Gaze-hold triggered text enhancement + on-device AI summarization.
 * Dwell detection is handled by GazeTracker (gaze_tracker.js).
 */

const MIN_TEXT_LEN = 40;

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
  showBadge(el, '💡 Summarising…', 'loading');

  chrome.runtime.sendMessage(
    { type: 'summarize', text, lang: detectLang() },
    (resp) => {
      if (!resp) { updateBadge('⚠️ No response from host', 'error'); return; }
      if (resp.status === 'ok') {
        updateBadge(`💡 ${resp.summary}`, 'ready');
      } else {
        updateBadge(`⚠️ ${resp.message ?? 'Error'}`, 'error');
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
  badge.style.top = `${window.scrollY + rect.top - 8}px`;
  badge.style.left = `${window.scrollX + rect.left}px`;
  badge.style.maxWidth = `${Math.max(rect.width, 260)}px`;
  document.body.appendChild(badge);
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
