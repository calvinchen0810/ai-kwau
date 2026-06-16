/* AI Kwau Content Script
 * Simulates gaze hold with mouse hover (2 s threshold).
 * On hold: applies L1 visual effect + requests on-device summary.
 */

const HOLD_MS = 2000;
const SELECTORS = "p, h1, h2, h3, h4, li, blockquote, td, figcaption";
const MIN_TEXT_LEN = 40;

let hoverTimer = null;
let activeEl = null;
let activeBadge = null;

// ── Hover detection ──────────────────────────────────────────────────
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest(SELECTORS);
  if (!el || el === activeEl) return;

  clearTimeout(hoverTimer);
  cleanup();
  activeEl = el;

  hoverTimer = setTimeout(() => triggerL1(el), HOLD_MS);
});

document.addEventListener("mouseout", (e) => {
  if (e.relatedTarget && activeEl?.contains(e.relatedTarget)) return;
  clearTimeout(hoverTimer);
});

// ── L1 trigger ───────────────────────────────────────────────────────
function triggerL1(el) {
  const text = el.innerText?.trim() ?? "";
  if (text.length < MIN_TEXT_LEN) return;

  el.classList.add("aikwau-l1");
  showBadge(el, "💡 Summarising…", "loading");

  const lang = detectLang();
  chrome.runtime.sendMessage({ type: "summarize", text, lang }, (resp) => {
    if (!resp) {
      updateBadge("⚠️ No response from host", "error");
      return;
    }
    if (resp.status === "ok") {
      updateBadge(`💡 ${resp.summary}`, "ready");
    } else {
      updateBadge(`⚠️ ${resp.message ?? "Error"}`, "error");
    }
  });
}

// ── Badge helpers ─────────────────────────────────────────────────────
function showBadge(anchor, text, state) {
  cleanup(false); // keep activeEl

  const badge = document.createElement("div");
  badge.className = `aikwau-badge aikwau-badge--${state}`;
  badge.textContent = text;

  const rect = anchor.getBoundingClientRect();
  badge.style.top = `${window.scrollY + rect.top - 8}px`;
  badge.style.left = `${window.scrollX + rect.left}px`;
  badge.style.maxWidth = `${Math.max(rect.width, 260)}px`;

  document.body.appendChild(badge);
  activeBadge = badge;

  if (state === "ready") setTimeout(cleanup, 12000);
}

function updateBadge(text, state) {
  if (!activeBadge) return;
  activeBadge.textContent = text;
  activeBadge.className = `aikwau-badge aikwau-badge--${state}`;
  if (state === "ready") setTimeout(cleanup, 12000);
}

function cleanup(resetEl = true) {
  activeBadge?.remove();
  activeBadge = null;
  if (resetEl) {
    activeEl?.classList.remove("aikwau-l1");
    activeEl = null;
  }
}

function detectLang() {
  const lang = document.documentElement.lang ?? "";
  return lang.startsWith("zh") ? "zh" : "en";
}
