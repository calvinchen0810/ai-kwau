const masterEnabled     = document.getElementById('masterEnabled');
const restBody          = document.getElementById('restBody');
const modeRadios      = document.querySelectorAll('input[name="mode"]');
const calPtsRadios    = document.querySelectorAll('input[name="calpts"]');
const recalibrate     = document.getElementById('recalibrate');
const calPointsOpts   = document.getElementById('calPointsOpts');
const webcamToggles   = document.getElementById('webcamToggles');
const panelVisible    = document.getElementById('panelVisible');
const ringVisible     = document.getElementById('ringVisible');
const boldEnabled     = document.getElementById('boldEnabled');
const l2Enabled       = document.getElementById('l2Enabled');
const l2Scale         = document.getElementById('l2Scale');
const l2ScaleLabel    = document.getElementById('l2ScaleLabel');
const l2ScaleRow      = document.getElementById('l2ScaleRow');
const contrastEnabled = document.getElementById('contrastEnabled');
const summaryEnabled  = document.getElementById('summaryEnabled');
const cursorRingEnabled = document.getElementById('cursorRingEnabled');
const blindSpotVisible = document.getElementById('blindSpotVisible');
const themeButtons    = document.querySelectorAll('.theme-btn');
const status          = document.getElementById('status');
const langToggleBtn   = document.getElementById('langToggle');

// ── i18n ────────────────────────────────────────────────────────────────────
let uiLang = 'zh';
function t(key, vars) { return AIKWAU_I18N.t(key, uiLang, vars); }

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  langToggleBtn.textContent = uiLang === 'zh' ? 'EN' : '中文';
  setMasterUI(masterOn);
}

langToggleBtn.addEventListener('click', () => {
  uiLang = uiLang === 'zh' ? 'en' : 'zh';
  chrome.storage.local.set({ aikwau_ui_lang: uiLang });
  applyI18n();
  sendToTab({ type: 'gaze:ui-lang-toggle', lang: uiLang });
});

// ── Cal-points segmented control ─────────────────────────────────────────────
function setCalPtsUI(pts) {
  const val = String(pts);
  calPtsRadios.forEach(r => { r.checked = r.value === val; });
  document.getElementById('segOpt9').classList.toggle('selected',  val === '9');
  document.getElementById('segOpt25').classList.toggle('selected', val === '25');
}

function setWebcamExtras(show) {
  calPointsOpts.style.display  = show ? 'block' : 'none';
  webcamToggles.style.display  = show ? 'block' : 'none';
  recalibrate.style.display    = show ? 'block' : 'none';
}

// ── Load saved preferences ────────────────────────────────────────────────────
function setThemeUI(theme) {
  themeButtons.forEach(btn => btn.classList.toggle('selected', btn.dataset.theme === theme));
}

function setL2ScaleUI(scale) {
  l2Scale.value = scale;
  l2ScaleLabel.textContent = `${scale.toFixed(1)}×`;
}

function setL2RowDisabled(disabled) {
  l2Scale.disabled = disabled;
  l2ScaleRow.classList.toggle('disabled', disabled);
}

let masterOn = true;
function setMasterUI(enabled) {
  masterOn = enabled;
  masterEnabled.classList.toggle('on', enabled);
  masterEnabled.setAttribute('aria-pressed', String(enabled));
  masterEnabled.title = t(enabled ? 'masterOn' : 'masterOff');
  restBody.classList.toggle('disabled', !enabled);
}

chrome.storage.local.get(
  ['aikwau_gaze_mode', 'aikwau_cal_points',
   'aikwau_webcam_panel_visible', 'aikwau_gaze_ring_visible',
   'aikwau_l2_enabled', 'aikwau_l2_scale', 'aikwau_hc_theme',
   'aikwau_bold_enabled', 'aikwau_contrast_enabled', 'aikwau_summary_enabled',
   'aikwau_master_enabled', 'aikwau_cursor_ring_enabled', 'aikwau_ui_lang'],
  (data) => {
    const mode  = data.aikwau_gaze_mode ?? 'mouse';
    const pts   = data.aikwau_cal_points ?? 25;
    const scale = data.aikwau_l2_scale ?? 1.2;
    const theme = data.aikwau_hc_theme ?? 'nightsky';
    uiLang = data.aikwau_ui_lang ?? 'zh';
    document.querySelector(`input[value="${mode}"]`).checked = true;
    setWebcamExtras(mode === 'webcam');
    setCalPtsUI(pts);
    panelVisible.checked    = data.aikwau_webcam_panel_visible !== false;
    ringVisible.checked     = data.aikwau_gaze_ring_visible    !== false;
    boldEnabled.checked     = data.aikwau_bold_enabled         !== false;
    l2Enabled.checked       = data.aikwau_l2_enabled           !== false;
    setL2RowDisabled(!l2Enabled.checked);
    setL2ScaleUI(scale);
    contrastEnabled.checked = data.aikwau_contrast_enabled     !== false;
    summaryEnabled.checked  = data.aikwau_summary_enabled      !== false;
    setThemeUI(theme);
    setMasterUI(data.aikwau_master_enabled !== false);
    cursorRingEnabled.checked = data.aikwau_cursor_ring_enabled === true;
    applyI18n();
  }
);

// ── Mode change ───────────────────────────────────────────────────────────────
modeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const mode = radio.value;
    chrome.storage.local.set({ aikwau_gaze_mode: mode }, () => {
      setWebcamExtras(mode === 'webcam');
      status.textContent = t('savedReload');
      setTimeout(() => { status.textContent = ''; }, 2500);
    });
  });
});

// ── Cal-points change ─────────────────────────────────────────────────────────
calPtsRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const pts = Number(radio.value);
    chrome.storage.local.set({ aikwau_cal_points: pts }, () => {
      setCalPtsUI(pts);
      status.textContent = t('switchedCalPts', { n: pts });
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});

// ── Webcam visual toggles ─────────────────────────────────────────────────────
function sendToTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
  });
}

panelVisible.addEventListener('change', () => {
  const vis = panelVisible.checked;
  chrome.storage.local.set({ aikwau_webcam_panel_visible: vis });
  sendToTab({ type: 'gaze:panel-toggle', visible: vis });
});

ringVisible.addEventListener('change', () => {
  const vis = ringVisible.checked;
  chrome.storage.local.set({ aikwau_gaze_ring_visible: vis });
  sendToTab({ type: 'gaze:ring-toggle', visible: vis });
});

cursorRingEnabled.addEventListener('change', () => {
  const enabled = cursorRingEnabled.checked;
  chrome.storage.local.set({ aikwau_cursor_ring_enabled: enabled });
  sendToTab({ type: 'gaze:cursor-ring-toggle', enabled });
});

masterEnabled.addEventListener('click', () => {
  const enabled = !masterOn;
  chrome.storage.local.set({ aikwau_master_enabled: enabled });
  setMasterUI(enabled);
  sendToTab({ type: 'gaze:master-toggle', enabled });
});

boldEnabled.addEventListener('change', () => {
  const enabled = boldEnabled.checked;
  chrome.storage.local.set({ aikwau_bold_enabled: enabled });
  sendToTab({ type: 'gaze:bold-toggle', enabled });
});

l2Enabled.addEventListener('change', () => {
  const enabled = l2Enabled.checked;
  chrome.storage.local.set({ aikwau_l2_enabled: enabled });
  setL2RowDisabled(!enabled);
  sendToTab({ type: 'gaze:l2-toggle', enabled });
});

contrastEnabled.addEventListener('change', () => {
  const enabled = contrastEnabled.checked;
  chrome.storage.local.set({ aikwau_contrast_enabled: enabled });
  sendToTab({ type: 'gaze:contrast-toggle', enabled });
});

summaryEnabled.addEventListener('change', () => {
  const enabled = summaryEnabled.checked;
  chrome.storage.local.set({ aikwau_summary_enabled: enabled });
  sendToTab({ type: 'gaze:summary-toggle', enabled });
});

l2Scale.addEventListener('input', () => {
  const scale = parseFloat(l2Scale.value);
  l2ScaleLabel.textContent = `${scale.toFixed(1)}×`;
  chrome.storage.local.set({ aikwau_l2_scale: scale });
  sendToTab({ type: 'gaze:l2-scale', scale });
});

themeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    chrome.storage.local.set({ aikwau_hc_theme: theme }, () => {
      setThemeUI(theme);
      status.textContent = t('switchedTheme', { name: btn.textContent });
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});

// ── Recalibrate ───────────────────────────────────────────────────────────────
recalibrate.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'gaze:recalibrate' }, () => {
      status.textContent = chrome.runtime.lastError ? t('reloadFirst') : t('calUIOpened');
      if (!chrome.runtime.lastError) window.close();
      setTimeout(() => { status.textContent = ''; }, 2500);
    });
  });
});

chrome.storage.local.get('aikwau_blindspot_visible', ({ aikwau_blindspot_visible }) => {
  blindSpotVisible.checked = aikwau_blindspot_visible !== false;
});

blindSpotVisible.addEventListener('change', () => {
  const visible = blindSpotVisible.checked;
  chrome.storage.local.set({ aikwau_blindspot_visible: visible });
  sendToTab({ type: 'gaze:blindspot-toggle', visible });
});
