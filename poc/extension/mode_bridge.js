// Isolated world: read chrome.storage, expose mode to MAIN world via DOM attribute.
document.documentElement.setAttribute('data-aikwau-mode', 'mouse');
chrome.storage.local.get('aikwau_gaze_mode', ({ aikwau_gaze_mode }) => {
  const mode = aikwau_gaze_mode ?? 'mouse';
  document.documentElement.setAttribute('data-aikwau-mode', mode);
  document.dispatchEvent(new CustomEvent('aikwau:mode-ready', { detail: { mode } }));
});
