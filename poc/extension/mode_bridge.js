// Isolated world: read chrome.storage, expose mode + HC theme to MAIN world via DOM attributes.
document.documentElement.setAttribute('data-aikwau-mode', 'mouse');
document.documentElement.setAttribute('data-aikwau-hc-theme', 'nightsky');

chrome.storage.local.get(['aikwau_gaze_mode', 'aikwau_hc_theme'], ({ aikwau_gaze_mode, aikwau_hc_theme }) => {
  const mode  = aikwau_gaze_mode ?? 'mouse';
  const theme = aikwau_hc_theme ?? 'nightsky';
  document.documentElement.setAttribute('data-aikwau-mode', mode);
  document.documentElement.setAttribute('data-aikwau-hc-theme', theme);
  document.dispatchEvent(new CustomEvent('aikwau:mode-ready', { detail: { mode, theme } }));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.aikwau_hc_theme) {
    document.documentElement.setAttribute('data-aikwau-hc-theme', changes.aikwau_hc_theme.newValue ?? 'nightsky');
  }
});
